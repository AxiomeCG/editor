import { expect, test } from 'bun:test'
import {
  indexRepetitions,
  linearArray,
  reconcileRepetitions,
  remapRepeatedReferences,
} from './repetition'

test('array placement keeps logical indices and positions across realized gaps', () => {
  const placements = linearArray({
    count: 4,
    firstIndex: 1,
    step: [2, 0, -1],
    origin: [5, 3, 0],
    excluded: [2],
  })
  expect(placements.map((p) => p.key)).toEqual(['1', '3', '4'])
  expect(placements.map((p) => p.offset)).toEqual([
    [7, 3, -1],
    [11, 3, -3],
    [13, 3, -4],
  ])
  expect(linearArray({ count: 0, step: [0, 0, 0] })).toEqual([])
  expect(() => linearArray({ count: 0.5, step: [0, 0, 0] })).toThrow()
  expect(() => linearArray({ count: 2, step: [NaN, 0, 0] })).toThrow()
})

test('reconciliation preserves records and identity when cells are filtered or reordered', () => {
  const nodes = [
    { key: '0', id: 'a', x: 0 },
    { key: '1', id: 'b', x: 1 },
    { key: '2', id: 'c', x: 2 },
  ]
  const desired = [
    { key: '2', x: 2 },
    { key: '0', x: 4 },
    { key: '3', x: 6 },
  ]
  const plan = reconcileRepetitions({
    desired,
    previous: indexRepetitions(nodes, (n) => n.key),
    keyOf: (n) => n.key,
    build: (spec, old) => ({ ...spec, id: old?.id ?? 'new' }),
    equal: (a, b) => a.id === b.id && a.x === b.x,
  })
  expect(plan.values[0]).toBe(nodes[2])
  expect(plan.values.map((n) => n.id)).toEqual(['c', 'a', 'new'])
  expect(plan.updated.map((n) => n.id)).toEqual(['a'])
  expect(plan.added.map((n) => n.id)).toEqual(['new'])
  expect(plan.removed).toEqual([nodes[1]!])
  expect(nodes[0]!.x).toBe(0)
})

test('ambiguous keys are rejected before building or mutating any representation', () => {
  let builds = 0
  expect(() =>
    reconcileRepetitions({
      desired: ['a', 'a'],
      previous: new Map(),
      keyOf: (x) => x,
      build: (x) => {
        builds++
        return x
      },
    }),
  ).toThrow('Duplicate')
  expect(builds).toBe(0)
  expect(() => indexRepetitions(['a', 'a'], (x) => x)).toThrow('Duplicate')
})

test('subtree references are remapped without altering the template', () => {
  const source = {
    id: 'wall_original',
    children: ['window_original'],
    metadata: { facadeOwner: 'wall_original', label: 'Unchanged' },
  }
  const result = remapRepeatedReferences(
    source,
    new Map([
      ['wall_original', 'wall_copy'],
      ['window_original', 'window_copy'],
    ]),
  )
  expect(result.children).toEqual(['window_copy'])
  expect(result.metadata).toEqual({ facadeOwner: 'wall_copy', label: 'Unchanged' })
  expect(source.id).toBe('wall_original')
  expect(source.children).toEqual(['window_original'])
})
