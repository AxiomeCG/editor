import { expect, test } from 'bun:test'
import { GuideNode } from '@pascal-app/core'
import { levelContours } from './use-workspace-preview'

test('overlay contours are placed in level metres at the guide frame, holes included', () => {
  // 1000 px at scale 10 → 0.1 m/px; the image centre sits at the guide position.
  const guide = GuideNode.parse({
    url: '/plan.svg',
    scale: 10,
    position: [5, 0, -3],
    metadata: { planReference: { width: 1000, height: 800 } },
  })
  const [contour] = levelContours(
    guide,
    [
      {
        id: 'room',
        points: [
          [500, 400],
          [600, 400],
          [600, 450],
        ],
        holes: [
          [
            [520, 410],
            [540, 410],
            [540, 420],
          ],
        ],
      },
    ],
    true,
  )

  const rounded = (points: [number, number][]) => points.map((p) => p.map((v) => +v.toFixed(6)))
  expect(rounded(contour!.points)).toEqual([
    [5, -3],
    [15, -3],
    [15, 2],
  ])
  expect(rounded(contour!.holes[0]!)).toEqual([
    [7, -2],
    [9, -2],
    [9, -1],
  ])
})
