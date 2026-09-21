import {
  type AnyNode,
  type AnyNodeId,
  type FenceNode,
  getStoredLevelHeight,
  runAsSingleSceneHistoryStep,
  type SlabNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  type BalconyEdge,
  type BalconyOptions,
  balconyGuard,
  DEFAULT_BALCONY,
  exposedBalconyEdges,
} from '@pascal-app/core/building'

type BalconyMetadata = {
  id: string
  role: string
  options?: BalconyOptions
  guardBoundaryIndices?: number[]
  hiddenByStyle?: boolean
}
const association = (node: AnyNode | undefined) =>
  node?.metadata.balcony as BalconyMetadata | undefined
export type EditableBalcony = { slab: SlabNode; guards: FenceNode[] }
export type BalconyStylePatch = Partial<
  Pick<BalconyOptions, 'railing' | 'railingHeight' | 'thickness'>
>

export function selectedBalconies(
  nodes: Record<string, AnyNode>,
  ids: readonly string[],
): EditableBalcony[] {
  const decks = new Set<string>()
  for (const id of ids) {
    const node = nodes[id],
      meta = association(node)
    if (!meta || (node?.type !== 'slab' && node?.type !== 'fence')) continue
    if (node.type === 'slab' ? meta.id !== node.id : node.supportSlabId !== meta.id) continue
    const slab = nodes[meta.id]
    if (slab?.type === 'slab' && association(slab)?.id === slab.id) decks.add(slab.id)
  }
  return [...decks].map((id) => ({
    slab: nodes[id] as SlabNode,
    guards: Object.values(nodes).filter(
      (n): n is FenceNode =>
        n.type === 'fence' &&
        n.parentId === nodes[id]!.parentId &&
        n.supportSlabId === id &&
        association(n)?.id === id,
    ),
  }))
}

export function balconyRailingStyle(guard: FenceNode): BalconyOptions['railing'] {
  if (association(guard)?.hiddenByStyle) return 'none'
  return guard.slots?.infill === 'library:preset-glass'
    ? 'glass'
    : guard.style === 'rail'
      ? 'rail'
      : 'slat'
}

/** Style changes retain the native geometry, IDs, hosting and any manually edited paths. */
export function planBalconyStyle(
  nodes: Record<string, AnyNode>,
  ids: readonly string[],
  patch: BalconyStylePatch,
) {
  const balconies = selectedBalconies(nodes, ids)
  if (!balconies.length) throw Error('Select a balcony slab or railing.')
  const update: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  const create: FenceNode[] = []
  for (const { slab, guards } of balconies) {
    const level = slab.parentId ? nodes[slab.parentId] : undefined
    if (
      level?.type !== 'level' ||
      level.metadata.placeholderSource ||
      [slab, ...guards].some((n) => n.metadata.linkedArray || n.metadata.facadeOwner)
    )
      throw Error('Make linked copies real or edit this balcony through its facade settings.')
    if (
      patch.thickness !== undefined &&
      (!Number.isFinite(patch.thickness) || patch.thickness < 0.02 || patch.thickness > 1)
    )
      throw Error('Use a slab thickness of 0.02–1 m.')
    if (patch.railing !== undefined && !['slat', 'rail', 'glass', 'none'].includes(patch.railing))
      throw Error('Choose a railing style.')
    const meta = association(slab)!
    const options = { ...DEFAULT_BALCONY, ...meta.options, ...patch }
    const height = patch.railingHeight ?? guards[0]?.height ?? options.railingHeight
    if (
      !Number.isFinite(height) ||
      height < 0.3 ||
      height > 3 ||
      (patch.railing !== 'none' &&
        (patch.railing !== undefined || patch.railingHeight !== undefined) &&
        slab.elevation + height > getStoredLevelHeight(level) + 1e-6)
    )
      throw Error('The railing must fit within this floor.')
    update.push({
      id: slab.id,
      data: {
        ...(patch.thickness !== undefined ? { thickness: patch.thickness } : {}),
        metadata: { ...slab.metadata, balcony: { ...meta, options } },
      },
    })
    for (const guard of guards) {
      const guardMeta = association(guard)!
      let data: Partial<FenceNode> = {}
      if (patch.railing === 'none') {
        if (guard.visible !== false)
          data = {
            visible: false,
            metadata: { ...guard.metadata, balcony: { ...guardMeta, hiddenByStyle: true } },
          }
      } else if (patch.railing !== undefined) {
        const styled = balconyGuard({ ...guard, style: patch.railing })
        data = {
          style: styled.style,
          slatGap: styled.slatGap,
          slots: styled.slots,
          showInfill: styled.showInfill,
        }
        if (guardMeta.hiddenByStyle)
          data = {
            ...data,
            visible: true,
            metadata: { ...guard.metadata, balcony: { ...guardMeta, hiddenByStyle: false } },
          }
      }
      if (patch.railingHeight !== undefined) data.height = patch.railingHeight
      if (Object.keys(data).length) update.push({ id: guard.id, data })
    }
    if (!guards.length && patch.railing && patch.railing !== 'none') {
      const perimeter = [slab.polygon, ...slab.holes].flatMap((loop) =>
        loop.map((p, i) => [p, loop[(i + 1) % loop.length]!] as BalconyEdge),
      )
      const candidates = perimeter.filter((_, i) =>
        meta.guardBoundaryIndices ? meta.guardBoundaryIndices.includes(i) : i !== options.openEdge,
      )
      const edges = exposedBalconyEdges(
        candidates,
        Object.values(nodes).filter((n): n is WallNode => n.type === 'wall'),
        level,
        slab.elevation,
        nodes,
      )
      for (const [start, end] of edges)
        create.push(
          balconyGuard({
            parentId: level.id,
            start,
            end,
            supportSlabId: slab.id,
            height,
            style: patch.railing,
            metadata: { balcony: { id: slab.id, role: 'guard', source: 'balcony-tool' } },
          }),
        )
    }
  }
  return { update, create }
}

export function applyBalconyStyle(ids: readonly string[], patch: BalconyStylePatch) {
  const scene = useScene.getState()
  if (scene.readOnly) return
  const plan = planBalconyStyle(scene.nodes, ids, patch)
  runAsSingleSceneHistoryStep(useScene, () => {
    scene.updateNodes(plan.update)
    if (plan.create.length)
      useScene
        .getState()
        .createNodes(plan.create.map((node) => ({ node, parentId: node.parentId as AnyNodeId })))
  })
}
