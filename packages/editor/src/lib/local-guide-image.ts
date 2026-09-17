import {
  type AnyNodeId,
  GuideNode,
  type GuideNode as GuideNodeType,
  ScanNode,
  type ScanNode as ScanNodeType,
  saveAsset,
} from '@pascal-app/core'
import { readPlanFile } from './plan-reference/import'

export function getGuideImageName(filename: string) {
  return getAssetName(filename, 'Guide image')
}

export function getScanName(filename: string) {
  return getAssetName(filename, 'Scan')
}

function getAssetName(filename: string, fallback: string) {
  const trimmed = filename.trim()
  if (!trimmed) {
    return fallback
  }

  const dotIndex = trimmed.lastIndexOf('.')
  return dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed
}

export async function createLocalGuideImage({
  createNode,
  file,
  levelId,
  position = [0, 0, 0],
}: {
  createNode: (node: GuideNodeType, parentId: AnyNodeId) => void
  file: File
  levelId: string
  position?: [number, number, number]
}) {
  const plan = await readPlanFile(file)
  const assetUrl = await saveAsset(
    file.type === plan.mimeType ? file : new File([file], file.name, { type: plan.mimeType }),
  )
  const guide = GuideNode.parse({
    name: getGuideImageName(file.name),
    url: assetUrl,
    position,
    rotation: [0, 0, 0],
    scale: 1,
    opacity: 50,
    scaleReference: null,
    parentId: levelId,
    metadata: {
      planReference: {
        version: 1,
        assetId: crypto.randomUUID(),
        role: 'floorplan',
        width: plan.width,
        height: plan.height,
        mimeType: plan.mimeType,
      },
    },
  })

  createNode(guide, levelId as AnyNodeId)
  return guide
}

export async function createLocalScan({
  createNode,
  file,
  levelId,
}: {
  createNode: (node: ScanNodeType, parentId: AnyNodeId) => void
  file: File
  levelId: string
}) {
  const assetUrl = await saveAsset(file)
  const scan = ScanNode.parse({
    name: getScanName(file.name),
    url: assetUrl,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    opacity: 100,
  })

  createNode(scan, levelId as AnyNodeId)
  return { scan, url: assetUrl }
}
