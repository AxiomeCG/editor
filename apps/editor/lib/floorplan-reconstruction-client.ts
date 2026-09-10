'use client'

import { SlabNode } from '@pascal-app/core'
import {
  type FloorplanImportProvider,
  parseReconstructionNodes,
  reconstructionOptionsSchema,
  rescaleReconstructionNodes,
} from '@pascal-app/editor/floorplan-import'

const source = {
  id: 'replicate-astra-prewarm',
  name: 'Three-bedroom floorplan',
  imageUrl: '/floorplans/replicate-astra.png',
  width: 567,
  height: 916,
  metersPerPixel: 0.017505697105882432,
  sha256: '17fea94f5a57bbfaafa90a189fbac5efbccbb8d4e5ac2137fd0afe081fc5e204',
}

export const floorplanImport: FloorplanImportProvider = {
  source,
  async reconstruct(request, { signal }) {
    const options = reconstructionOptionsSchema.parse(request)
    const response = await fetch('/floorplans/replicate-astra.json', { signal })
    if (!response.ok) throw new Error('The prepared Replicate + Astra sample could not be loaded.')
    const saved = await response.json()
    if (saved.id !== source.id || saved.source?.sha256 !== source.sha256)
      throw new Error('The prepared sample does not match its source drawing.')
    const nodes = rescaleReconstructionNodes(
      parseReconstructionNodes(saved.nodes),
      source.metersPerPixel,
      options,
    )
    const level = nodes[saved.levelId]
    if (level?.type !== 'level') throw new Error('The prepared sample has no native level.')
    for (const zone of Object.values(nodes)) {
      if (zone.type !== 'zone') continue
      const slab = SlabNode.parse({
        name: `${zone.name} floor`,
        parentId: level.id,
        polygon: zone.polygon,
        elevation: 0,
        thickness: 0.05,
        autoFromWalls: false,
        metadata: { floorplanReconstruction: { sourceZoneId: zone.id, approximation: true } },
      })
      nodes[slab.id] = slab
      level.children.push(slab.id)
    }
    const { buildNativePreviewScene } = await import('./floorplan-native-scene')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    signal.throwIfAborted()
    const scene = buildNativePreviewScene({ nodes })
    const values = Object.values(nodes)
    return {
      source: { ...source, metersPerPixel: options.metersPerPixel },
      levelId: level.id,
      wallHeight: options.wallHeight,
      nodes,
      scene,
      counts: {
        walls: values.filter((n) => n.type === 'wall').length,
        openings: values.filter((n) => n.type === 'door' || n.type === 'window').length,
        zones: values.filter((n) => n.type === 'zone').length,
        items: values.filter((n) => n.type === 'block').length,
        dimensions: 0,
        surfaces: values.filter((n) => n.type === 'slab').length,
      },
      warnings: [
        'Prewarmed Replicate extraction and Astra review. No model inference is run or billed.',
        'Wall fits, corner glazing and recovered windows remain approximations. Compare against the source image.',
        'Open-plan zone boundaries and prop blocks are approximate, not exact furnishing models.',
      ],
    }
  },
}
