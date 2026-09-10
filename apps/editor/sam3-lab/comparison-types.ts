import type { AnyNode } from '@pascal-app/core'
import type { PlanPoint } from '../../../packages/editor/src/lib/floorplan-import/schema'
import type { NativeSceneData } from '../../../packages/editor/src/lib/floorplan-import/curated'

export type StructuralClass = 'wall' | 'door' | 'window'

export interface SemanticDecision {
  id: string
  action: 'keep' | 'relabel' | 'reject' | 'needs_repair'
  correctedClass: StructuralClass | 'background' | 'uncertain'
  confidence: 'high' | 'medium' | 'low'
  evidence: string
}

export interface ComparisonCandidate {
  id: string
  class: StructuralClass
  outer: PlanPoint[]
  holes: PlanPoint[][]
  centerline?: PlanPoint[]
  decision?: SemanticDecision
}

export interface MissingFeatureProposal {
  kind: StructuralClass
  sourceRegion: [number, number, number, number]
  evidence: string
}

export interface ComparisonUsage {
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  durationMs: number | null
  basis: string
}

export interface ComparisonVariant {
  id: string
  label: string
  extractor: 'yytsi' | 'replicate'
  reviewer: string | null
  candidates: ComparisonCandidate[]
  missingFeatures: MissingFeatureProposal[]
  rejectedCandidates?: ComparisonCandidate[]
  issues: string[]
  usage: ComparisonUsage
  overlayUrl: string
}

export interface QualityOption {
  id: string
  label: string
  stages: string
  tradeoff: string
  usage: ComparisonUsage
}
export interface ComparisonAssessmentVariant {
  variantId: string
  doors: string
  verdict: string
}

export interface ComparisonAssessment {
  recommendation: string
  method: string
  variants: ComparisonAssessmentVariant[]
}

export interface ComparisonManifest {
  source: { name: string; width: number; height: number; sha256: string; url: string }
  variants: ComparisonVariant[]
  qualityOptions: QualityOption[]
  caveats: string[]
  assessment?: ComparisonAssessment
}

export interface NativePreviewOptions {
  metersPerPixel: number
  wallHeight: number
  calibration?: { start: PlanPoint; end: PlanPoint; distanceMeters: number }
}

export interface NativeSourceMapping {
  sourceId: string
  nodeIds: string[]
  status: 'converted' | 'approximated' | 'unresolved'
  detail: string
}

export interface NativeMaskPreview {
  nodes: Record<string, AnyNode>
  levelId: string
  counts: {
    walls: number
    doors: number
    windows: number
    slabs: number
    zones: number
    props: number
  }
  mappings: NativeSourceMapping[]
  issues: string[]
  assumptions: string[]
  bounds: { x: number; y: number; width: number; height: number }
}

export interface NativePreviewResponse extends NativeMaskPreview {
  svg: string
  scene: NativeSceneData
}
