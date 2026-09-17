import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode, WindowNode } from '@pascal-app/core'
import useInteractionScope from './use-interaction-scope'
import { useWallSplit } from './use-wall-split'

const level = LevelNode.parse({ children: [] })
const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
const window = WindowNode.parse({
  parentId: wall.id,
  wallId: wall.id,
  position: [6, 1.5, 0],
  width: 1,
})
level.children = [wall.id]
wall.children = [window.id]
beforeEach(() => {
  useWallSplit.getState().close()
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall, [window.id]: window },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useWallSplit.getState().close()
  useScene.setState({ readOnly: false })
})

test('hover and widget changes are ephemeral; cancel does not alter nodes or undo', () => {
  const before = useScene.getState().nodes
  useWallSplit.getState().open(wall)
  for (let distance = 1; distance < 4; distance += 0.1) useWallSplit.getState().update(distance)
  useWallSplit.getState().update(2.75, 'distance')
  expect(useWallSplit.getState().draft?.input).toBe('distance')
  expect(useWallSplit.getState().draft?.preview.frame.point.x).toBe(2.75)
  useWallSplit.getState().pick()
  expect(useWallSplit.getState().draft?.input).toBe('pointer')
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  useWallSplit.getState().close()
  expect(useWallSplit.getState().draft).toBeNull()
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
})
test('commit uses the displayed mark, reparents openings and is one undo', () => {
  const before = useScene.getState().nodes
  useWallSplit.getState().open(wall)
  useWallSplit.getState().update(3.25, 'distance')
  useWallSplit.getState().commit()
  const after = useScene.getState().nodes
  expect((after[wall.id] as WallNode).end).toEqual([3.25, 0])
  expect((after[window.id] as WindowNode).position).toEqual([2.75, 1.5, 0])
  expect(useWallSplit.getState().draft).toBeNull()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})
test('invalid opening cuts, replaced scopes and read-only transitions cannot commit', () => {
  const before = useScene.getState().nodes
  useWallSplit.getState().open(wall)
  useWallSplit.getState().update(6)
  useWallSplit.getState().commit()
  expect(useWallSplit.getState().draft?.preview.valid).toBe(false)
  expect(useScene.getState().nodes).toBe(before)
  useWallSplit.getState().update(3)
  useScene.setState({ readOnly: true })
  useWallSplit.getState().commit()
  expect(useScene.getState().nodes).toBe(before)
  useScene.setState({ readOnly: false })
  useInteractionScope.getState().begin({ kind: 'painting' })
  useWallSplit.getState().commit()
  useWallSplit.getState().close()
  expect(useScene.getState().nodes).toBe(before)
  expect(useInteractionScope.getState().scope.kind).toBe('painting')
  useInteractionScope.getState().end()
})
