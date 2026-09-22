import { z } from 'zod'
import { FacadeUnitSchema } from './facade-unit'

export const FacadeSurfaceSchema = z.enum(['interior', 'exterior', 'both'])
export type FacadeSurface = z.infer<typeof FacadeSurfaceSchema>

/**
 * A full snapshot of the unit applied to one wall, plus what keeps it live. It
 * never points back at a catalog row, so editing or archiving the source cannot
 * change an applied facade; `sourceItemId` is attribution only.
 */
export const WallFacadeSchema = z.object({
  unit: FacadeUnitSchema,
  sourceItemId: z.string().optional(),
  surface: FacadeSurfaceSchema.optional(),
  /** The wall face the runs are measured on and balconies project from. */
  face: z.enum(['front', 'back']).optional(),
  /** Digest of the inputs the last fill resolved against; drift triggers a refill. */
  layoutFrame: z.string().optional(),
  /** Wall slot refs the facade replaced, restored on removal. */
  previousSlots: z.record(z.string(), z.string().nullable()).optional(),
  appliedSlots: z.record(z.string(), z.string()).optional(),
  detached: z.boolean().optional(),
  detachedReason: z.string().optional(),
})
export type WallFacade = z.infer<typeof WallFacadeSchema>

export function readWallFacade(metadata: Record<string, unknown>): WallFacade | undefined {
  const parsed = WallFacadeSchema.safeParse(metadata.proceduralFacade)
  return parsed.success ? parsed.data : undefined
}

/** A facade the resize sync still regenerates. */
export function readLiveWallFacade(metadata: Record<string, unknown>): WallFacade | undefined {
  const facade = readWallFacade(metadata)
  return facade && !facade.detached ? facade : undefined
}
