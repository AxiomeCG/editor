import { join } from 'node:path'
import { file } from 'bun'
import { z } from 'zod'
import type {
  ComparisonCandidate,
  ComparisonManifest,
  ComparisonUsage,
  ComparisonVariant,
  QualityOption,
} from './comparison-types'
import type { Source } from './sam'

const structuralClass = z.enum(['wall', 'door', 'window'])
const decisionSchema = z.object({
  id: z.string().min(1).max(80),
  action: z.enum(['keep', 'relabel', 'reject', 'needs_repair']),
  correctedClass: z.enum(['wall', 'door', 'window', 'background', 'uncertain']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string().min(1).max(1000),
})
const usageSchema = z.object({
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  basis: z.string(),
})
const assessmentVariantSchema = z.object({
  variantId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),
  doors: z.string().trim().min(1).max(2000),
  verdict: z.string().trim().min(1).max(2000),
})
const assessmentSchema = z.object({
  sourceSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .transform((value) => value.toLowerCase()),
  recommendation: z.string().trim().min(1).max(4000),
  method: z.string().trim().min(1).max(4000),
  variants: z
    .array(assessmentVariantSchema)
    .max(32)
    .refine(
      (variants) => new Set(variants.map((variant) => variant.variantId)).size === variants.length,
      'Assessment variant IDs must be unique',
    ),
})

const sources = {
  yytsi: {
    ledger: 'gemini-correction/candidates.json',
    label: 'Local Yytsi',
    baseline: 'yytsi-native/same-source',
    reviews: {
      gemini: 'gemini-correction/run-02',
      sol: 'openai-correction/sol',
      astra: 'openai-correction/astra',
    },
  },
  replicate: {
    ledger: 'replicate-correction/candidates.json',
    label: 'Replicate floorplan',
    baseline: 'replicate-correction',
    reviews: {
      gemini: 'replicate-correction/gemini',
      sol: 'replicate-correction/sol',
      astra: 'replicate-correction/astra',
    },
  },
} as const
const reviewerNames = { gemini: 'Gemini 3.1 Pro', sol: 'Sol', astra: 'Astra' } as const

async function optionalJson(path: string): Promise<unknown | null> {
  const resource = file(path)
  return (await resource.exists()) ? resource.json() : null
}

export function comparisonOverlayPath(root: string, variantId: string): string | null {
  const match = /^(yytsi|replicate)-(raw|gemini|sol|astra)$/.exec(variantId)
  if (!match) return null
  const source = sources[match[1] as keyof typeof sources]
  return match[2] === 'raw'
    ? join(root, source.baseline, 'processed-overlay.png')
    : join(
        root,
        source.reviews[match[2] as keyof typeof reviewerNames],
        'corrected-with-review-flags.png',
      )
}

function unknownReviewUsage(): ComparisonUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    durationMs: null,
    basis:
      'Blind tool-assisted subagent review. Production API token usage and price were not reported; Unknown does not mean free.',
  }
}

async function reviewUsage(
  root: string,
  directory: string,
  reviewer: string,
): Promise<ComparisonUsage> {
  if (reviewer !== 'gemini') {
    const recorded = await optionalJson(join(root, directory, 'usage.json'))
    return recorded === null ? unknownReviewUsage() : usageSchema.parse(recorded)
  }
  const summary = z
    .object({
      elapsedMs: z.number().nonnegative(),
      usage: z.object({
        prompt_tokens: z.number().nonnegative(),
        completion_tokens: z.number().nonnegative(),
        cost: z.number().nonnegative(),
      }),
    })
    .parse(await optionalJson(join(root, directory, 'summary.json')))
  return {
    inputTokens: summary.usage.prompt_tokens,
    outputTokens: summary.usage.completion_tokens,
    costUsd: summary.usage.cost,
    durationMs: summary.elapsedMs,
    basis:
      'Measured single OpenRouter review request, including reasoning output. Excludes extraction cost; not directly comparable to tool-assisted subagent wall time.',
  }
}

function qualityOptions(variants: ComparisonVariant[]): QualityOption[] {
  const gemini =
    variants.find((variant) => variant.id === 'replicate-gemini') ??
    variants.find((variant) => variant.id === 'yytsi-gemini')
  return [
    {
      id: 'local-extraction',
      label: 'Local extraction',
      stages: 'Local segmentation → deterministic native fitting',
      tradeoff:
        'No LLM tokens or remote inference charge. More semantic errors and manual review; local GPU/download costs still exist.',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: null,
        basis: 'Additional hosted inference charge only, not total compute cost.',
      },
    },
    {
      id: 'hosted-extraction',
      label: 'Hosted extraction',
      stages: 'Replicate floorplan model → deterministic native fitting',
      tradeoff:
        'Better initial door coverage on this drawing. No LLM cleanup; the hosted extraction charge is separate and was not reported in its response.',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        durationMs: null,
        basis: 'No LLM call; Replicate GPU billing is not token billing.',
      },
    },
    {
      id: 'semantic-review',
      label: 'Semantic review',
      stages: 'Extraction → one Gemini review → deterministic native fitting',
      tradeoff:
        'Measured review-token baseline. Removes or relabels some noise, but this experiment exposed harmful high-confidence decisions.',
      usage: gemini?.usage ?? unknownReviewUsage(),
    },
    {
      id: 'source-verified',
      label: 'Source-verified quality',
      stages: 'Extraction → Astra review → source-pixel aperture repair and targeted verification',
      tradeoff:
        'Proposed higher-quality workflow, not a deployed tier. Astra identified material errors better in the inspected cases. Missing-aperture repair is still required; extra review cost must be measured on the production route.',
      usage: unknownReviewUsage(),
    },
  ]
}

export async function loadComparisonManifest(
  root: string,
  source: Source,
): Promise<ComparisonManifest> {
  const x = z.number().finite().min(0).max(source.width)
  const y = z.number().finite().min(0).max(source.height)
  const point = z.tuple([x, y])
  const candidateSchema = z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),
    class: structuralClass,
    outer: z.array(point).min(3).max(10000),
    holes: z.array(z.array(point).min(3).max(10000)).max(100),
    centerline: z.array(point).min(2).max(1000).optional(),
  })
  const geometryComponentSchema = candidateSchema.pick({ outer: true, holes: true })
  const geometrySourceSchema = z.object({
    wall: z.array(geometryComponentSchema).max(256),
    door: z.array(geometryComponentSchema).max(256),
    window: z.array(geometryComponentSchema).max(256),
  })
  const ledgerSchema = z.object({
    sourceSha256: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    candidates: z.array(candidateSchema).max(256),
  })
  const correctionSchema = z.object({
    decisions: z.array(decisionSchema).max(256),
    missingFeatures: z
      .array(
        z.object({
          kind: structuralClass,
          sourceRegion: z
            .tuple([x, y, x, y])
            .refine(
              ([x0, y0, x1, y1]) => x0 < x1 && y0 < y1,
              'Review region must have positive area',
            ),
          evidence: z.string().max(1000),
        }),
      )
      .max(30),
    issues: z.array(z.string().max(1000)).max(100),
  })
  const variants: ComparisonVariant[] = []
  const caveats = [
    'One frozen drawing, not a labeled accuracy benchmark. Candidate counts are not physical opening counts.',
    'Only labels and rejections changed. Missing-feature boxes are not replacement masks and are not inserted into native previews.',
    'Native preview is structure-only, read-only and assumption-based. No scene Apply, inferred floor slab, or inferred room zone occurs.',
    'Astra/Sol used a tool-assisted subagent protocol; Gemini used a single API call. Their durations and token costs are not interchangeable.',
  ]
  for (const extractor of ['yytsi', 'replicate'] as const) {
    const config = sources[extractor]
    const value = await optionalJson(join(root, config.ledger))
    if (value === null) continue
    const ledger = ledgerSchema.parse(value)
    if (
      ledger.sourceSha256 !== source.sha256 ||
      ledger.width !== source.width ||
      ledger.height !== source.height
    ) {
      caveats.push(
        `${config.label}: saved comparison belongs to another source and was not loaded.`,
      )
      continue
    }
    const geometryValue = await optionalJson(join(root, config.baseline, 'geometry-source.json'))
    if (geometryValue === null) throw new Error(`${extractor}: original source geometry is missing`)
    const geometry = geometrySourceSchema.parse(geometryValue)
    for (const kind of ['wall', 'door', 'window'] as const) {
      const classCandidates = ledger.candidates.filter((candidate) => candidate.class === kind)
      if (classCandidates.length !== geometry[kind].length) {
        throw new Error(
          `${extractor}/${kind}: source geometry component count does not match the saved ledger`,
        )
      }
      const ordinals = new Set<number>()
      for (const candidate of classCandidates) {
        const match = /([1-9]\d*)$/.exec(candidate.id)
        const ordinal = match ? Number(match[1]) : 0
        if (ordinal < 1 || ordinal > geometry[kind].length || ordinals.has(ordinal)) {
          throw new Error(
            `${extractor}/${candidate.id}: candidate ID does not identify one source geometry component`,
          )
        }
        ordinals.add(ordinal)
      }
    }
    const sourceCandidates = ledger.candidates.map((candidate) => {
      const ordinal = Number(/([1-9]\d*)$/.exec(candidate.id)![1])
      const original = geometry[candidate.class][ordinal - 1]
      if (!original) throw new Error(`${extractor}/${candidate.id}: missing source geometry`)
      return { ...candidate, outer: original.outer, holes: original.holes }
    })
    const ids = new Set(sourceCandidates.map((candidate) => candidate.id))
    if (ids.size !== sourceCandidates.length)
      throw new Error(`${extractor}: duplicate saved candidate IDs`)
    const rawId = `${extractor}-raw`
    variants.push({
      id: rawId,
      label: `${config.label} · raw`,
      extractor,
      reviewer: null,
      candidates: sourceCandidates,
      missingFeatures: [],
      issues: [
        'Unreviewed model contours; structure may contain missing openings, mixed classes and false positives.',
      ],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: extractor === 'yytsi' ? 0 : null,
        durationMs: null,
        basis:
          extractor === 'yytsi'
            ? 'Local PyTorch inference. No LLM or remote inference charge; excludes local compute.'
            : 'Saved Replicate extraction reused; no new extraction request. Original GPU charge was not reported.',
      },
      overlayUrl: `/api/comparisons/${rawId}/overlay`,
    })
    for (const reviewer of ['gemini', 'sol', 'astra'] as const) {
      const directory = config.reviews[reviewer]
      const correctionValue = await optionalJson(join(root, directory, 'correction.json'))
      if (correctionValue === null) continue
      const correction = correctionSchema.parse(correctionValue)
      const decisions = new Map(correction.decisions.map((decision) => [decision.id, decision]))
      if (
        decisions.size !== ids.size ||
        correction.decisions.length !== ids.size ||
        [...decisions.keys()].some((id) => !ids.has(id))
      ) {
        throw new Error(`${extractor}/${reviewer}: incomplete or duplicate correction IDs`)
      }
      const candidates: ComparisonCandidate[] = []
      const rejectedCandidates: ComparisonCandidate[] = []
      for (const candidate of sourceCandidates) {
        const decision = decisions.get(candidate.id)!
        if (decision.action === 'reject') {
          if (decision.correctedClass !== 'background')
            throw new Error(`${candidate.id}: invalid rejection`)
          rejectedCandidates.push({ ...candidate, decision })
          continue
        }
        if (decision.action === 'keep' && decision.correctedClass !== candidate.class)
          throw new Error(`${candidate.id}: keep changed class`)
        let kind = candidate.class
        if (decision.action === 'relabel') {
          kind = structuralClass.parse(decision.correctedClass)
          if (kind === candidate.class)
            throw new Error(`${candidate.id}: relabel did not change class`)
        }
        candidates.push({ ...candidate, class: kind, decision })
      }
      const id = `${extractor}-${reviewer}`
      variants.push({
        rejectedCandidates,
        id,
        label: `${config.label} + ${reviewerNames[reviewer]}`,
        extractor,
        reviewer: reviewerNames[reviewer],
        candidates,
        missingFeatures: correction.missingFeatures,
        issues: correction.issues,
        usage: await reviewUsage(root, directory, reviewer),
        overlayUrl: `/api/comparisons/${id}/overlay`,
      })
    }
  }
  const assessmentValue = await optionalJson(join(root, 'comparison-assessment.json'))
  const savedAssessment = assessmentValue === null ? null : assessmentSchema.parse(assessmentValue)
  const assessment =
    savedAssessment?.sourceSha256 === source.sha256.toLowerCase()
      ? {
          recommendation: savedAssessment.recommendation,
          method: savedAssessment.method,
          variants: savedAssessment.variants,
        }
      : undefined
  return {
    source: {
      name: source.name,
      width: source.width,
      height: source.height,
      sha256: source.sha256,
      url: '/api/source',
    },
    variants,
    qualityOptions: qualityOptions(variants),
    caveats,
    assessment,
  }
}
