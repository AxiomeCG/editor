import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode } from '@pascal-app/core'
import { useWallSplit } from '../store/use-wall-split'
import { bindWallSplitPointer } from './wall-split-pointer'

const previousWindow = globalThis.window
const events = new EventTarget()
const surface = new EventTarget()
const level = LevelNode.parse({ children: [] })
const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
level.children = [wall.id]
let cleanup = () => {}
const emit = (type: string, distance: number, button = 0) => {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, { clientX: distance, pointerId: 1, button, buttons: 0 })
  events.dispatchEvent(event)
  return event
}
beforeEach(() => {
  globalThis.window = events as unknown as Window & typeof globalThis
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
  useWallSplit.getState().open(wall)
  cleanup = bindWallSplitPointer(surface as unknown as Element, (event) =>
    event.clientX >= 0 ? event.clientX : null,
  )
})
afterEach(() => {
  cleanup()
  useWallSplit.getState().close()
  globalThis.window = previousWindow
})

test('widget distance stays fixed until picking is explicitly resumed', () => {
  emit('pointermove', 2)
  expect(useWallSplit.getState().draft?.preview.distance).toBe(2)
  useWallSplit.getState().update(3.25, 'distance')
  emit('pointermove', 5)
  expect(useWallSplit.getState().draft?.preview.distance).toBe(3.25)
  useWallSplit.getState().pick()
  emit('pointermove', 5)
  expect(useWallSplit.getState().draft?.preview.distance).toBe(5)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
test('left click commits the release mark once; orbit and out-of-wall clicks do not cut', () => {
  expect(emit('pointerdown', 3, 2).defaultPrevented).toBe(false)
  emit('pointerup', 3, 2)
  emit('pointerdown', -1)
  emit('pointerup', -1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(emit('pointerdown', 2).defaultPrevented).toBe(true)
  emit('pointermove', 3.5)
  expect(emit('pointerup', 3.5).defaultPrevented).toBe(true)
  expect((useScene.getState().nodes[wall.id] as WallNode).end).toEqual([3.5, 0])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})
test('cancelled pointer or release off-wall never commits a stale mark', () => {
  emit('pointerdown', 2)
  emit('pointercancel', 2)
  emit('pointerup', 2)
  emit('pointerdown', 3)
  emit('pointerup', -1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  cleanup()
  emit('pointermove', 6)
  expect(useWallSplit.getState().draft?.preview.distance).toBe(3)
})
