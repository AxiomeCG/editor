'use client'
import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'
import { X } from 'lucide-react'
import { MaterialPicker } from '../controls/material-picker'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'

export type MaterialSwatch = { label: string; color: string; image?: string }

/** How a paint reference reads in a swatch: the catalog thumbnail, or its colour. */
export function materialSwatch(ref: string | undefined): MaterialSwatch | null {
  const item = getCatalogMaterialById(getLibraryMaterialIdFromRef(ref) ?? undefined)
  if (item)
    return {
      label: item.label,
      color: item.previewColor ?? '#8a8a8a',
      image: item.previewThumbnailUrl,
    }
  const sceneId = getSceneMaterialIdFromRef(ref)
  const scene = sceneId ? useScene.getState().materials[sceneId as SceneMaterialId] : undefined
  if (scene) return { label: scene.name, color: scene.material.properties?.color ?? '#8a8a8a' }
  return null
}

/**
 * One paintable surface of the unit, picked from the same library as the paint
 * tool. `onClear` makes the surface optional: cleared, the unit leaves it as it is.
 */
export function MaterialField({
  label,
  value,
  onChange,
  onClear,
  emptyLabel = 'Keep as is',
}: {
  label: string
  value: string | undefined
  onChange: (ref: string) => void
  onClear?: () => void
  emptyLabel?: string
}) {
  const swatch = materialSwatch(value)
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${swatch?.label ?? emptyLabel}`}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/50 bg-background px-1.5 text-left text-xs text-foreground hover:bg-accent/40"
          >
            <span
              className="size-5 shrink-0 rounded-sm border border-border/50 bg-cover bg-center"
              style={
                swatch
                  ? {
                      backgroundColor: swatch.color,
                      backgroundImage: swatch.image ? `url(${swatch.image})` : undefined,
                    }
                  : undefined
              }
            />
            <span className={swatch ? 'truncate' : 'truncate text-muted-foreground'}>
              {swatch?.label ?? emptyLabel}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="start"
          className="h-[26rem] w-80 p-3"
        >
          <MaterialPicker selectedMaterialPreset={value} onSelectMaterialPreset={onChange} />
        </PopoverContent>
      </Popover>
      {onClear && value && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={onClear}
          className="rounded-full p-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
