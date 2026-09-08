'use client'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'

import { FLOORPLAN_MAX_IMAGE_SIDE, FLOORPLAN_MAX_REQUEST_BYTES } from './schema'

export type FloorplanCrop = {
  x: number
  y: number
  width: number
  height: number
}

export type RenderedFloorplanPage = {
  page: number | null
  width: number
  height: number
  previewDataUrl: string
}

export type PreparedFloorplanSource = RenderedFloorplanPage & {
  imageDataUrl: string
  sourceFile: File
  crop: FloorplanCrop | null
}

export type FloorplanSource = {
  fileName: string
  kind: 'image' | 'pdf'
  pageCount: number
  renderPage: (page: number, signal?: AbortSignal) => Promise<RenderedFloorplanPage>
  preparePage: (
    rendered: RenderedFloorplanPage,
    crop?: FloorplanCrop | null,
  ) => Promise<PreparedFloorplanSource>
  dispose: () => Promise<void>
}

type ActivePdfRender = Pick<RenderTask, 'cancel' | 'promise'>

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The source preparation was cancelled.', 'AbortError')
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('This browser cannot prepare a floorplan preview.')
  return context
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function fitDimensions(width: number, height: number, allowUpscale = false) {
  const longestSide = Math.max(width, height)
  const scale =
    longestSide > FLOORPLAN_MAX_IMAGE_SIDE
      ? FLOORPLAN_MAX_IMAGE_SIDE / longestSide
      : allowUpscale
        ? Math.min(2, FLOORPLAN_MAX_IMAGE_SIDE / longestSide)
        : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The browser could not encode the prepared floorplan.'))
    }, 'image/png')
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The browser could not read the prepared floorplan.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

async function canvasToPage(
  canvas: HTMLCanvasElement,
  page: number | null,
): Promise<RenderedFloorplanPage> {
  const previewDataUrl = await blobToDataUrl(await canvasToBlob(canvas))
  return { page, width: canvas.width, height: canvas.height, previewDataUrl }
}

function normalizeCrop(crop: FloorplanCrop, width: number, height: number): FloorplanCrop {
  const minimumWidth = Math.min(2, width)
  const minimumHeight = Math.min(2, height)
  const x = Math.max(0, Math.min(width - minimumWidth, Math.round(crop.x)))
  const y = Math.max(0, Math.min(height - minimumHeight, Math.round(crop.y)))
  const cropWidth = Math.max(minimumWidth, Math.min(width - x, Math.round(crop.width)))
  const cropHeight = Math.max(minimumHeight, Math.min(height - y, Math.round(crop.height)))
  return { x, y, width: cropWidth, height: cropHeight }
}

async function imageDataUrlToCanvas(rendered: RenderedFloorplanPage) {
  const response = await fetch(rendered.previewDataUrl)
  if (!response.ok) throw new Error('The prepared floorplan preview is no longer available.')
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = createCanvas(rendered.width, rendered.height)
    getCanvasContext(canvas).drawImage(bitmap, 0, 0, rendered.width, rendered.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

async function prepareRenderedPage(
  fileName: string,
  rendered: RenderedFloorplanPage,
  crop?: FloorplanCrop | null,
): Promise<PreparedFloorplanSource> {
  const normalizedCrop = crop ? normalizeCrop(crop, rendered.width, rendered.height) : null
  let blob: Blob
  let imageDataUrl: string
  let width = rendered.width
  let height = rendered.height

  if (normalizedCrop) {
    const sourceCanvas = await imageDataUrlToCanvas(rendered)
    const output = createCanvas(normalizedCrop.width, normalizedCrop.height)
    getCanvasContext(output).drawImage(
      sourceCanvas,
      normalizedCrop.x,
      normalizedCrop.y,
      normalizedCrop.width,
      normalizedCrop.height,
      0,
      0,
      normalizedCrop.width,
      normalizedCrop.height,
    )
    blob = await canvasToBlob(output)
    imageDataUrl = await blobToDataUrl(blob)
    width = output.width
    height = output.height
  } else {
    const response = await fetch(rendered.previewDataUrl)
    if (!response.ok) throw new Error('The prepared floorplan preview is no longer available.')
    blob = await response.blob()
    imageDataUrl = rendered.previewDataUrl
  }

  if (imageDataUrl.length > FLOORPLAN_MAX_REQUEST_BYTES) {
    throw new Error('The prepared floorplan is too large to send. Select a smaller crop.')
  }

  const baseName = fileName.replace(/\.[^.]+$/, '') || 'floorplan'
  const pageSuffix = rendered.page ? `-page-${rendered.page}` : ''
  const cropSuffix = normalizedCrop ? '-crop' : ''
  const sourceFile = new File([blob], `${baseName}${pageSuffix}${cropSuffix}.png`, {
    type: 'image/png',
    lastModified: Date.now(),
  })

  return {
    ...rendered,
    width,
    height,
    imageDataUrl,
    sourceFile,
    crop: normalizedCrop,
  }
}

async function loadImageSource(file: File): Promise<FloorplanSource> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This image could not be decoded. Choose a PNG, JPEG, or WebP file.')
  }

  let disposed = false
  return {
    fileName: file.name,
    kind: 'image',
    pageCount: 1,
    async renderPage(page, signal) {
      if (disposed) throw new Error('This floorplan source has been closed.')
      if (page !== 1) throw new Error('This image has only one page.')
      throwIfAborted(signal)
      const fitted = fitDimensions(bitmap.width, bitmap.height)
      const canvas = createCanvas(fitted.width, fitted.height)
      const context = getCanvasContext(canvas)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      throwIfAborted(signal)
      return canvasToPage(canvas, null)
    },
    preparePage(rendered, crop) {
      if (disposed) throw new Error('This floorplan source has been closed.')
      return prepareRenderedPage(file.name, rendered, crop)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      bitmap.close()
    },
  }
}

async function loadPdfSource(file: File): Promise<FloorplanSource> {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }

  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: false,
  })

  let pdf: PDFDocumentProxy
  try {
    pdf = await loadingTask.promise
  } catch {
    await loadingTask.destroy()
    throw new Error('This PDF could not be opened. It may be damaged, encrypted, or unsupported.')
  }

  let disposed = false
  let activeRender: ActivePdfRender | null = null
  return {
    fileName: file.name,
    kind: 'pdf',
    pageCount: pdf.numPages,
    async renderPage(pageNumber, signal) {
      if (disposed) throw new Error('This floorplan source has been closed.')
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error(`Choose a PDF page between 1 and ${pdf.numPages}.`)
      }
      throwIfAborted(signal)
      const page = await pdf.getPage(pageNumber)
      try {
        const baseViewport = page.getViewport({ scale: 1 })
        const fitted = fitDimensions(baseViewport.width, baseViewport.height, true)
        const viewport = page.getViewport({ scale: fitted.scale })
        const canvas = createCanvas(fitted.width, fitted.height)
        const context = getCanvasContext(canvas)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        const renderTask = page.render({ canvas, canvasContext: context, viewport })
        activeRender = renderTask
        const abort = () => renderTask.cancel()
        signal?.addEventListener('abort', abort, { once: true })
        try {
          await renderTask.promise
        } catch (error) {
          throwIfAborted(signal)
          throw error
        } finally {
          signal?.removeEventListener('abort', abort)
          if (activeRender === renderTask) activeRender = null
        }
        throwIfAborted(signal)
        return await canvasToPage(canvas, pageNumber)
      } finally {
        page.cleanup()
      }
    },
    preparePage(rendered, crop) {
      if (disposed) throw new Error('This floorplan source has been closed.')
      return prepareRenderedPage(file.name, rendered, crop)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      activeRender?.cancel()
      await loadingTask.destroy()
    },
  }
}

export async function openFloorplanSource(file: File): Promise<FloorplanSource> {
  const lowerName = file.name.toLowerCase()
  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) return loadPdfSource(file)

  const type = file.type.toLowerCase()
  const supportedImageType = type === 'image/png' || type === 'image/jpeg' || type === 'image/webp'
  if (supportedImageType || /\.(png|jpe?g|webp)$/i.test(lowerName)) return loadImageSource(file)

  throw new Error('Choose a PNG, JPEG, WebP, or PDF floorplan.')
}
