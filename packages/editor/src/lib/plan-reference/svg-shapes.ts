'use client'

import type { Path } from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import type { PlanPoint } from './calibration'
import type { ReferenceImage } from './guides'
import { type ReferenceOutline, simplifyOutline } from './outlines'
import { signedContourArea, simplifyContour } from './vectorize'

/** Only inert geometry is parsed. SVG scripts, links, images and stylesheets never enter the DOM. */
export function extractSvgPlanShapes(
  source: string,
  image: ReferenceImage,
  metersPerPixel: number,
): ReferenceOutline[] {
  if (source.length > 6_000_000 || !(metersPerPixel > 0))
    throw Error('Choose a calibrated SVG under 6 MB.')
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
    throw Error('This file is not a valid SVG.')
  const root = doc.documentElement
  const allowed = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'polygon',
    'polyline',
    'circle',
    'ellipse',
    'line',
  ])
  const attributes = new Set([
    'd',
    'points',
    'x1',
    'y1',
    'x2',
    'y2',
    'x',
    'y',
    'width',
    'height',
    'rx',
    'ry',
    'cx',
    'cy',
    'r',
    'transform',
    'viewBox',
    'fill',
    'fill-rule',
    'stroke',
    'stroke-width',
    'display',
    'visibility',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'id',
  ])
  const all = [...root.querySelectorAll('*')]
  if (all.length > 5000)
    throw Error('This SVG has too many elements. Export only the plan geometry.')
  for (const node of [root, ...all]) {
    if (!allowed.has(node.localName)) {
      node.remove()
      continue
    }
    // Preserve common inline presentation while stripping executable or external content.
    for (const entry of (node.getAttribute('style') ?? '').split(';')) {
      const [key, value] = entry.split(':').map((p) => p.trim())
      if (key && value && attributes.has(key) && !/url\s*\(/i.test(value))
        node.setAttribute(key, value)
    }
    if (node.getAttribute('display') === 'none' || node.getAttribute('visibility') === 'hidden')
      node.remove()
    for (const a of [...node.attributes])
      if (!attributes.has(a.name) || /url\s*\(/i.test(a.value)) node.removeAttribute(a.name)
  }
  const viewBox = (root.getAttribute('viewBox') ?? `0 0 ${image.width} ${image.height}`)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (
    viewBox.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    !(viewBox[2]! > 0 && viewBox[3]! > 0)
  )
    throw Error('The SVG has an invalid viewBox.')
  const sx = image.width / viewBox[2]!,
    sy = image.height / viewBox[3]!
  const sample = (path: Path, open = false): PlanPoint[] => {
    const points: PlanPoint[] = []
    for (const curve of path.curves) {
      const divisions =
        curve.type === 'LineCurve'
          ? 1
          : Math.min(256, Math.max(4, Math.ceil((curve.getLength() * metersPerPixel) / 0.1)))
      for (const p of curve.getPoints(divisions)) {
        const q: PlanPoint = [(p.x - viewBox[0]!) * sx, (p.y - viewBox[1]!) * sy]
        const previous = points.at(-1)
        if (
          !previous ||
          Math.hypot(q[0] - previous[0], q[1] - previous[1]) * metersPerPixel >= 0.001
        )
          points.push(q)
      }
    }
    if (
      !open &&
      points.length > 1 &&
      Math.hypot(points[0]![0] - points.at(-1)![0], points[0]![1] - points.at(-1)![1]) *
        metersPerPixel <
        0.001
    )
      points.pop()
    return open
      ? simplifyOutline(points, 0.015 / metersPerPixel)
      : simplifyContour(points, 0.015 / metersPerPixel)
  }
  const paths = new SVGLoader().parse(new XMLSerializer().serializeToString(root)).paths
  const result: ReferenceOutline[] = [],
    keys = new Set<string>()
  const polygonsByKey = new Map<string, ReferenceOutline>()
  const extra: ReferenceOutline[] = []
  const isClosed = (p: Path) => {
    if (p.autoClose) return true
    const a = p.curves[0]?.getPoint(0),
      b = p.curves.at(-1)?.getPoint(1)
    return !!a && !!b && Math.hypot((a.x - b.x) * sx, (a.y - b.y) * sy) * metersPerPixel < 0.001
  }
  for (const path of paths) {
    const style = path.userData?.style
    const boundary =
      !!style?.stroke &&
      style.stroke !== 'none' &&
      style.strokeOpacity !== 0 &&
      style.strokeWidth > 0
    if (style?.opacity === 0 || style?.display === 'none' || style?.visibility === 'hidden')
      continue
    const previousFill =
      style?.fillOpacity !== 0 &&
      (style?.fill !== 'none' || path.subPaths.every((p) => p.autoClose))
    const canFill =
      previousFill ||
      (style?.stroke !== 'none' && style?.strokeOpacity !== 0 && path.subPaths.every(isClosed))
    if (
      style?.stroke &&
      style.stroke !== 'none' &&
      style.strokeOpacity !== 0 &&
      style.strokeWidth > 0
    ) {
      for (const subpath of path.subPaths) {
        if (isClosed(subpath)) continue
        const points = sample(subpath, true)
        if (points.length < 2 || points.some((p) => !p.every(Number.isFinite))) continue
        const forward = points.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ')
        const reverse = [...points]
          .reverse()
          .map((p) => p.map((n) => n.toFixed(2)).join(','))
          .join(' ')
        const key = `line:${forward < reverse ? forward : reverse}`
        if (keys.has(key)) continue
        keys.add(key)
        extra.push({
          id: '',
          type: 'Stroke',
          boundary: true,
          points: points.map((p) => p.join(',')).join(' '),
          strokeWidth: style.strokeWidth * Math.sqrt(sx * sy),
        })
      }
    }
    if (!canFill) continue
    for (const shape of path.toShapes(false)) {
      const points = sample(shape),
        holes = shape.holes.map((hole) => sample(hole)).filter((h) => h.length >= 3)
      const area = Math.abs(signedContourArea(points))
      if (
        points.length < 3 ||
        points.some((p) => !p.every(Number.isFinite)) ||
        area * metersPerPixel ** 2 < 0.000001 ||
        area >= image.width * image.height * 0.9
      )
        continue
      const key = points
        .map((p) => p.map((n) => n.toFixed(2)).join(','))
        .sort()
        .join(' ')
      const duplicate = polygonsByKey.get(key)
      if (duplicate) {
        duplicate.boundary ||= boundary
        continue
      }
      keys.add(key)
      const target = !previousFill || area * metersPerPixel ** 2 < 0.2 ? extra : result
      const outline: ReferenceOutline = {
        id: `svg-${result.length}`,
        type: 'Polygon',
        boundary,
        points: points.map((p) => p.join(',')).join(' '),
        holes: holes.map((h) => h.map((p) => p.join(',')).join(' ')),
      }
      target.push(outline)
      polygonsByKey.set(key, outline)
    }
  }
  result.push(...extra.map((o, i) => ({ ...o, id: `svg-extra-${i}` })))
  if (!result.length) throw Error('No visible shapes or lines found in this SVG.')
  if (result.length > 512)
    throw Error('This SVG has too many contours. Simplify small details first.')
  return result
}
