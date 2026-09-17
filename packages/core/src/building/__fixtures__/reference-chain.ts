import { type AnyNode, type AnyNodeId, BuildingNode, GuideNode, LevelNode } from '../../schema'
import { outlineBatchPrimitiveNodes } from '../reference-primitives'

export function referenceChain() {
  const building = BuildingNode.parse({})
  const levels = [0, 1, 2].map((level) =>
    LevelNode.parse({ parentId: building.id, level, height: 3.2 }),
  )
  const guides = levels.map((level, index) =>
    GuideNode.parse({
      parentId: level.id,
      url: `/floor-${index}.svg`,
      scale: index + 1,
      position: [index * 3 + 10, 0.025 + index * 0.01, index * 2 - 5],
      rotation: [0, index * 0.3, 0],
      scaleReference: {
        start: [0, 0],
        end: [4, 0],
        realLengthMeters: 4,
        measuredLengthUnits: 4,
        metersPerUnit: 1,
        label: 'Measured',
      },
      metadata: { planReference: { width: 100, height: 100, assetId: `plan-${index}` } },
    }),
  )
  for (const index of [1, 2])
    guides[index]!.metadata.planReference = {
      ...(guides[index]!.metadata.planReference as object),
      method: 'matched-span',
      alignment: { anchorGuideId: guides[index - 1]!.id, targetGuideId: guides[index]!.id },
    }
  const shapes = [
    {
      id: 'room',
      points: [
        [10, 10],
        [40, 10],
        [40, 30],
        [10, 30],
      ] as [number, number][],
    },
  ]
  const elements = guides.flatMap((guide, index) =>
    ['walls', 'slab', 'zone', 'balcony'].flatMap((kind) =>
      outlineBatchPrimitiveNodes({
        guide,
        level: levels[index]!,
        shapes,
        kind: kind as 'walls' | 'slab' | 'zone' | 'balcony',
        name: kind,
        height: kind === 'walls' ? 3 : 0.2,
      }),
    ),
  )
  const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
    [building, ...levels, ...guides, ...elements].map((node) => [node.id, node]),
  )
  building.children = levels.map((level) => level.id)
  for (const level of levels)
    level.children = [...guides, ...elements]
      .filter((node) => node.parentId === level.id)
      .map((node) => node.id) as LevelNode['children']
  return { building, levels, guides, elements, nodes }
}
