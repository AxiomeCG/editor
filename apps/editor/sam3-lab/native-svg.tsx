import {
  type AnyNode,
  type AnyNodeDefinition,
  type FloorplanGeometry,
  type GeometryContext,
} from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloorplanGeometryRenderer } from '../../../packages/editor/src/components/editor-2d/renderers/floorplan-geometry-renderer'
import {
  buildFloorplanContext,
  floorplanLayerRank,
} from '../../../packages/editor/src/lib/floorplan/floorplan-readonly'
import type { NativeMaskPreview } from './comparison-types'

const MIN_PLAN_PADDING_M = 0.25
const PLAN_PADDING_RATIO = 0.04
const SVG_WIDTH_PX = 960
const SVG_HEIGHT_PX = 640

const builtInDefinitions = new Map<string, AnyNodeDefinition>(
  (builtinPlugin.nodes ?? []).map((definition) => [definition.kind, definition] as const),
)

type RenderableNode = {
  node: AnyNode
  definition: AnyNodeDefinition
}

/**
 * Render an isolated SAM3 conversion with Pascal's real registry floor-plan
 * builders. This deliberately reads definitions from the exported built-in
 * plugin rather than loading the plugin into the process-wide editor registry.
 */
export async function renderNativePreviewSvg(preview: NativeMaskPreview): Promise<string> {
  const nodeCount = Object.keys(preview.nodes).length
  if (nodeCount === 0) return renderEmptyPreview(preview)

  const nodes = buildHostedSnapshot(preview.nodes)
  const level = nodes[preview.levelId]
  if (!level) {
    throw new Error(`Native preview level ${JSON.stringify(preview.levelId)} is missing`)
  }
  if (level.type !== 'level') {
    throw new Error(
      `Native preview level ${JSON.stringify(preview.levelId)} has type ${JSON.stringify(level.type)}`,
    )
  }

  const descendants = collectLevelDescendants(level, nodes)
  assertNoDetachedNodes(level, descendants, nodes)

  const renderable = descendants
    .filter((node) => node.id !== level.id)
    .map(resolveRenderableNode)
    .sort((left, right) => floorplanLayerRank(left.node.type) - floorplanLayerRank(right.node.type))

  if (renderable.length === 0) return renderEmptyPreview(preview)

  const levelDataByType = computeFloorplanLevelData(renderable, nodes)
  const geometries = renderable.map(({ node, definition }) => {
    const context = buildFloorplanContext(
      node,
      nodes,
      {
        automaticDimensions: false,
        selected: false,
        unit: 'metric',
        metricNotation: 'meters',
        purpose: 'document',
        highlighted: false,
        hovered: false,
        moving: false,
        palette: undefined,
      },
      levelDataByType.get(node.type),
    )
    const builder = definition.floorplan as (
      nativeNode: AnyNode,
      geometryContext: GeometryContext,
    ) => FloorplanGeometry | null
    const geometry = builder(node, context)
    if (!geometry) {
      throw new Error(
        `Pascal floorplan builder returned no geometry for ${node.type} node ${JSON.stringify(node.id)}`,
      )
    }
    return { id: String(node.id), geometry }
  })

  const viewport = paddedViewport(preview.bounds)
  return renderToStaticMarkup(
    <svg
      aria-label="Pascal native structural preview"
      height={Math.round((SVG_WIDTH_PX * viewport.height) / viewport.width)}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
      width={SVG_WIDTH_PX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Pascal native structural preview</title>
      <desc>
        Native Pascal floorplan geometry. Source positive Y is shown as positive Z downward.
      </desc>
      <rect
        fill="#ffffff"
        height={viewport.height}
        width={viewport.width}
        x={viewport.x}
        y={viewport.y}
      />
      {geometries.map(({ id, geometry }) => (
        <g data-native-node-id={id} key={id}>
          <FloorplanGeometryRenderer geometry={geometry} pointerEventsOverride="none" />
        </g>
      ))}
    </svg>,
  )
}

function resolveRenderableNode(node: AnyNode): RenderableNode {
  const definition = builtInDefinitions.get(node.type)
  if (!definition) {
    throw new Error(
      `No built-in Pascal node definition exists for ${node.type} node ${JSON.stringify(node.id)}`,
    )
  }
  if (!definition.floorplan) {
    throw new Error(
      `Built-in Pascal node ${node.type} has no floorplan builder (${JSON.stringify(node.id)})`,
    )
  }
  return { node, definition }
}

function computeFloorplanLevelData(
  renderable: readonly RenderableNode[],
  nodes: Record<string, AnyNode>,
): Map<string, unknown> {
  const nodesByType = new Map<string, AnyNode[]>()
  const definitionsByType = new Map<string, AnyNodeDefinition>()

  for (const entry of renderable) {
    const siblings = nodesByType.get(entry.node.type)
    if (siblings) siblings.push(entry.node)
    else nodesByType.set(entry.node.type, [entry.node])
    definitionsByType.set(entry.node.type, entry.definition)
  }

  const levelData = new Map<string, unknown>()
  for (const [type, siblings] of nodesByType) {
    const compute = definitionsByType.get(type)?.computeFloorplanLevelData as
      | ((args: { siblings: readonly AnyNode[]; nodes: Record<string, AnyNode> }) => unknown)
      | undefined
    if (compute) levelData.set(type, compute({ siblings, nodes }))
  }
  return levelData
}

/**
 * Parent ids are the semantic source of truth. A local copy completes each
 * parent's child list so wall builders receive every hosted door/window even
 * when the serialized preview omitted a redundant `children` entry.
 */
function buildHostedSnapshot(source: Record<string, AnyNode>): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = {}
  const childIdsByParent = new Map<string, string[]>()

  for (const [key, node] of Object.entries(source)) {
    if (String(node.id) !== key) {
      throw new Error(
        `Native preview node key ${JSON.stringify(key)} does not match id ${JSON.stringify(node.id)}`,
      )
    }
    nodes[key] = { ...node }
    childIdsByParent.set(key, [])
  }

  for (const [parentId, parent] of Object.entries(nodes)) {
    const ordered = childIdsByParent.get(parentId)!
    for (const childId of readChildIds(parent)) {
      if (ordered.includes(childId)) continue
      if (nodes[childId]?.parentId === parentId) ordered.push(childId)
    }
  }

  for (const node of Object.values(nodes)) {
    const parentId = typeof node.parentId === 'string' ? node.parentId : null
    if (!parentId || !nodes[parentId]) continue
    const ordered = childIdsByParent.get(parentId)!
    const childId = String(node.id)
    if (!ordered.includes(childId)) ordered.push(childId)
  }

  for (const [parentId, children] of childIdsByParent) {
    const parent = nodes[parentId]
    if (!parent) continue
    nodes[parentId] = { ...parent, children: [...children] } as AnyNode
  }
  return nodes
}

function collectLevelDescendants(level: AnyNode, nodes: Record<string, AnyNode>): AnyNode[] {
  const ordered: AnyNode[] = []
  const visited = new Set<string>()
  const active = new Set<string>()

  const visit = (node: AnyNode) => {
    const id = String(node.id)
    if (active.has(id)) {
      throw new Error(`Native preview contains a parent/child cycle at ${JSON.stringify(id)}`)
    }
    if (visited.has(id)) return
    active.add(id)
    visited.add(id)
    ordered.push(node)

    for (const childId of readChildIds(node)) {
      const child = nodes[childId]
      if (child) visit(child)
    }
    active.delete(id)
  }

  visit(level)
  return ordered
}

function readChildIds(node: AnyNode): readonly string[] {
  if (!('children' in node) || !Array.isArray(node.children)) return []
  return node.children.filter((childId): childId is string => typeof childId === 'string')
}

function assertNoDetachedNodes(
  level: AnyNode,
  descendants: readonly AnyNode[],
  nodes: Record<string, AnyNode>,
): void {
  const accountedFor = new Set(descendants.map((node) => String(node.id)))
  let ancestor = level
  const ancestorIds = new Set<string>()
  while (typeof ancestor.parentId === 'string') {
    const parent = nodes[ancestor.parentId]
    if (!parent) break
    if (ancestorIds.has(ancestor.parentId)) {
      throw new Error(
        `Native preview contains a parent cycle above level ${JSON.stringify(level.id)}`,
      )
    }
    ancestorIds.add(ancestor.parentId)
    accountedFor.add(ancestor.parentId)
    ancestor = parent
  }

  const detached = Object.keys(nodes).filter((id) => !accountedFor.has(id))
  if (detached.length > 0) {
    throw new Error(
      `Native preview contains nodes outside level ${JSON.stringify(level.id)}: ${detached.join(', ')}`,
    )
  }
}

function paddedViewport(bounds: NativeMaskPreview['bounds']): NativeMaskPreview['bounds'] {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every(Number.isFinite) || bounds.width < 0 || bounds.height < 0) {
    throw new Error('Native preview bounds must contain finite, non-negative metre values')
  }
  const padding = Math.max(
    MIN_PLAN_PADDING_M,
    Math.max(bounds.width, bounds.height) * PLAN_PADDING_RATIO,
  )
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  }
}

function renderEmptyPreview(preview: NativeMaskPreview): string {
  const viewport = paddedViewport(preview.bounds)
  const centerX = viewport.x + viewport.width / 2
  const centerY = viewport.y + viewport.height / 2
  const fontSize = Math.min(viewport.width, viewport.height) * 0.08

  return renderToStaticMarkup(
    <svg
      aria-label="Empty Pascal native structural preview"
      height={SVG_HEIGHT_PX}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
      width={SVG_WIDTH_PX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Empty Pascal native structural preview</title>
      <desc>No native structural nodes were produced from this mask.</desc>
      <rect
        fill="#ffffff"
        height={viewport.height}
        stroke="#cbd5e1"
        strokeWidth={Math.max(viewport.width, viewport.height) * 0.002}
        width={viewport.width}
        x={viewport.x}
        y={viewport.y}
      />
      <text
        dominantBaseline="middle"
        fill="#475569"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={fontSize}
        textAnchor="middle"
        x={centerX}
        y={centerY}
      >
        No native structure produced
      </text>
    </svg>,
  )
}
