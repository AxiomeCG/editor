import { z } from 'zod'

export const FLOORPLAN_MAX_IMAGE_SIDE = 1600
export const FLOORPLAN_MAX_REQUEST_BYTES = 12 * 1024 * 1024
export const FLOORPLAN_MAX_CANDIDATE_CHARS = 2 * 1024 * 1024
export const FLOORPLAN_MAX_MASK_DATA_URL_CHARS = 2 * 1024 * 1024
export const FLOORPLAN_MAX_MASKS = 12
export const FLOORPLAN_MODELS = {
  interpreter: 'google/gemini-3.8-flash',
  reviewer: 'google/gemini-3.8-flash',
  segmentation: 'fal-ai/sam-3/image',
} as const

const finite = z.number().finite()
export const planPointSchema = z.tuple([finite, finite])
export type PlanPoint = z.infer<typeof planPointSchema>
const id = z.string().min(1).max(100)
const polygon = z.array(planPointSchema).min(3).max(1000)
const featureIds = z.array(id).max(100)
const issuePathPartSchema = z.union([z.string().min(1).max(200), z.number().int().nonnegative()])

export const calibrationSchema = z
  .object({
    start: planPointSchema,
    end: planPointSchema,
    distanceMeters: finite.positive().max(10000),
  })
  .strict()
export type FloorplanCalibration = z.infer<typeof calibrationSchema>

export const floorplanActionSchema = z.enum(['extract', 'segment', 'interpret', 'review'])
export type FloorplanAction = z.infer<typeof floorplanActionSchema>

export const floorplanFeaturePointSchema = z
  .object({
    id,
    point: planPointSchema,
  })
  .strict()
export const floorplanFeatureLineSchema = z
  .object({
    id,
    startId: id,
    endId: id,
    width: finite.positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
  })
  .strict()
export const floorplanFeatureRegionSchema = z
  .object({
    id,
    pointIds: z.array(id).min(3).max(1000),
    center: planPointSchema,
    width: finite.positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
    depth: finite.positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
    angle: finite,
  })
  .strict()
export const floorplanFeaturesSchema = z
  .object({
    width: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
    height: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
    points: z.array(floorplanFeaturePointSchema).max(8000),
    lines: z.array(floorplanFeatureLineSchema).max(4000),
    regions: z.array(floorplanFeatureRegionSchema).max(1000),
  })
  .strict()
export type FloorplanFeaturePoint = z.infer<typeof floorplanFeaturePointSchema>
export type FloorplanFeatureLine = z.infer<typeof floorplanFeatureLineSchema>
export type FloorplanFeatureRegion = z.infer<typeof floorplanFeatureRegionSchema>
export type FloorplanFeatures = z.infer<typeof floorplanFeaturesSchema>

export const floorplanMaskSchema = z
  .object({
    id,
    label: z.string().min(1).max(200),
    imageDataUrl: z
      .string()
      .max(FLOORPLAN_MAX_MASK_DATA_URL_CHARS)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
    width: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
    height: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
    score: finite.min(0).max(1).nullable(),
    coverage: finite.min(0).max(1),
  })
  .strict()
export type FloorplanMask = z.infer<typeof floorplanMaskSchema>

const catalogEntrySchema = z
  .object({
    id,
    name: z.string().max(200),
    category: z.string().max(200),
    width: finite.positive(),
    depth: finite.positive(),
  })
  .strict()

export const floorplanRequestSchema = z
  .object({
    action: floorplanActionSchema,
    imageDataUrl: z
      .string()
      .max(FLOORPLAN_MAX_REQUEST_BYTES)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
    name: z.string().min(1).max(200),
    page: z.number().int().positive().nullable(),
    calibration: calibrationSchema.nullable(),
    levelHeight: finite.min(0.5).max(100),
    catalog: z.array(catalogEntrySchema).max(1000),
    consent: z.boolean(),
    candidateJson: z.string().max(FLOORPLAN_MAX_CANDIDATE_CHARS).nullable(),
    features: floorplanFeaturesSchema.nullable(),
    masks: z.array(floorplanMaskSchema).max(FLOORPLAN_MAX_MASKS),
  })
  .strict()
  .superRefine((request, context) => {
    const remote = request.action !== 'extract'
    if (remote && !request.consent) {
      context.addIssue({
        code: 'custom',
        path: ['consent'],
        message: 'Consent is required for remote floorplan processing.',
      })
    }
    if (request.action === 'extract' && request.features !== null) {
      context.addIssue({
        code: 'custom',
        path: ['features'],
        message: 'Extraction produces a new feature ledger; features must be null.',
      })
    }
    if (request.action !== 'extract' && request.features === null) {
      context.addIssue({
        code: 'custom',
        path: ['features'],
        message: 'This stage requires a validated feature ledger.',
      })
    }
    if (request.action !== 'review' && request.candidateJson !== null) {
      context.addIssue({
        code: 'custom',
        path: ['candidateJson'],
        message: 'Only the review stage accepts an existing candidate.',
      })
    }
    if (request.action === 'review') {
      if (request.candidateJson === null || request.candidateJson.trim().length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['candidateJson'],
          message: 'Review requires a non-empty retained interpreter candidate.',
        })
      }
    }
  })
export type FloorplanRequest = z.infer<typeof floorplanRequestSchema>

export const importIssueSchema = z
  .object({
    id,
    message: z.string().min(1).max(2000),
    severity: z.enum(['blocking', 'warning']),
    relatedIds: z.array(id).max(100),
    path: z.array(issuePathPartSchema).max(50).optional(),
  })
  .strict()
export type ImportIssue = z.infer<typeof importIssueSchema>

/** All plan geometry is in the decoded source image's pixels, with +Y down.
 * Only native vertical dimensions and printed dimension values are metres.
 * Geometry comes from the feature ledger, never a model-authored world pose. */
export const floorplanDraftSchema = z
  .object({
    version: z.literal(1),
    id,
    source: z
      .object({
        name: z.string().max(200),
        page: z.number().int().positive().nullable(),
        width: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
        height: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE),
        metersPerPixel: finite.positive().nullable(),
        originPx: planPointSchema,
        scaleSource: z.enum(['user', 'drawing', 'unknown']),
      })
      .strict(),
    floor: z.object({ polygon, holes: z.array(polygon).max(100) }).strict(),
    walls: z
      .array(
        z
          .object({
            id,
            start: planPointSchema,
            end: planPointSchema,
            thickness: finite.positive(),
            featureIds,
          })
          .strict(),
      )
      .min(1)
      .max(500),
    openings: z
      .array(
        z
          .object({
            id,
            wallId: id,
            kind: z.enum(['door', 'window', 'opening']),
            offset: finite.nonnegative(),
            width: finite.positive(),
            height: finite.positive(),
            sillHeight: finite.nonnegative(),
            doorType: z.enum(['hinged', 'sliding']),
            hingesSide: z.enum(['left', 'right']),
            swingDirection: z.enum(['inward', 'outward']),
            side: z.enum(['front', 'back']),
            featureIds,
          })
          .strict(),
      )
      .max(500),
    zones: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            roomNumber: z.string().max(32),
            nameSource: z.enum(['drawing', 'generated']),
            polygon,
            enclosed: z.boolean(),
            boundaryWallIds: z.array(id).max(100),
            featureIds,
          })
          .strict(),
      )
      .max(300),
    items: z
      .array(
        z
          .object({
            id,
            label: z.string().min(1).max(200),
            assetId: id.nullable(),
            position: planPointSchema,
            rotation: finite,
            width: finite.positive(),
            depth: finite.positive(),
            featureIds,
          })
          .strict(),
      )
      .max(500),
    dimensions: z
      .array(
        z
          .object({
            id,
            start: z.object({ wallId: id, featureId: z.enum(['wall:start', 'wall:end']) }).strict(),
            end: z.object({ wallId: id, featureId: z.enum(['wall:start', 'wall:end']) }).strict(),
            baseline: z.tuple([planPointSchema, planPointSchema]),
            sourceMeters: finite.positive(),
            sourceText: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(500),
    assumptions: z.array(z.string().min(1).max(1000)).max(100),
    issues: z.array(importIssueSchema).max(500),
  })
  .strict()
export type FloorplanDraft = z.infer<typeof floorplanDraftSchema>

export type FloorplanCatalogEntry = z.infer<typeof catalogEntrySchema>

export const floorplanResponseSchema = z
  .object({
    stage: floorplanActionSchema,
    features: floorplanFeaturesSchema,
    masks: z.array(floorplanMaskSchema).max(FLOORPLAN_MAX_MASKS),
    candidateJson: z.string().max(FLOORPLAN_MAX_CANDIDATE_CHARS).nullable(),
    draft: floorplanDraftSchema.nullable(),
    issues: z.array(importIssueSchema).max(500),
    usage: z
      .object({ cost: finite.nonnegative().nullable(), models: z.array(z.string()).max(4) })
      .strict(),
  })
  .strict()
export type FloorplanResponse = z.infer<typeof floorplanResponseSchema>

export type FloorplanProgress =
  | 'extracting'
  | 'segmenting'
  | 'interpreting'
  | 'reviewing'
  | 'checking'
