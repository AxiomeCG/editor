import { type GuideNode, loadAssetUrl } from '@pascal-app/core'

/** Decode in image context; imported SVG is never inserted as executable DOM. */
async function imageDimensions(url: string) {
  const image = new Image()
  image.src = url
  await image.decode()
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0))
    throw Error('This plan has no image dimensions.')
  return { width: image.naturalWidth, height: image.naturalHeight }
}

export async function readPlanFile(file: File) {
  if (!(file.type.startsWith('image/') || /\.svg$/i.test(file.name)))
    throw Error('Choose an SVG, PNG, JPEG or WebP plan.')
  if (file.size > 20 * 1024 * 1024) throw Error('Choose a plan under 20 MB.')
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  if (svg && file.size > 6 * 1024 * 1024) throw Error('Choose an SVG under 6 MB.')
  const url = URL.createObjectURL(
    svg && file.type !== 'image/svg+xml' ? new Blob([file], { type: 'image/svg+xml' }) : file,
  )
  try {
    const image = await imageDimensions(url)
    // Defer curve sampling until selection so it uses the guide's current scale.
    return { ...image, mimeType: svg ? 'image/svg+xml' : file.type }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Older guide nodes can be upgraded without changing their scale or pose. */
export async function preparePlanGuide(guide: GuideNode): Promise<GuideNode> {
  const ref = guide.metadata.planReference as { width?: number; height?: number } | undefined
  if (Number(ref?.width) > 0 && Number(ref?.height) > 0) return guide
  const url = await loadAssetUrl(guide.url)
  if (!url) throw Error('This plan file is unavailable. Replace it first.')
  const image = await imageDimensions(url)
  return {
    ...guide,
    metadata: {
      ...guide.metadata,
      planReference: { version: 1, assetId: guide.id, role: 'floorplan', ...image },
    },
  }
}
