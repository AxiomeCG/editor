'use client'
import type {
  FacadeModule,
  FacadeModuleBalcony,
  FacadeModuleOpening,
  FacadeUnitHorizontalAnchor,
  FacadeUnitVerticalAnchor,
} from '@pascal-app/core'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { Button } from '../primitives/button'

/** The studio owns history for the whole draft, so sliders stay out of scene undo. */
function MetreSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 20,
  step = 0.05,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <SliderControl
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      precision={2}
      unit="m"
      manageHistory={false}
      restoreOnCommit={false}
      liveText
      onChange={onChange}
    />
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** A track with the pinned edge filled in — a generic constraint mark drawn for Pascal. */
function AnchorGlyph({ axis, value }: { axis: 'horizontal' | 'vertical'; value: string }) {
  const first = axis === 'horizontal' ? 'left' : 'bottom'
  const last = axis === 'horizontal' ? 'right' : 'top'
  const at = value === first ? 0 : value === last ? 8 : 4
  // SVG y runs down, so a bottom anchor pins the far end of a vertical track.
  const pinned = axis === 'vertical' ? 8 - at : at
  const track =
    axis === 'horizontal' ? { x: 1, y: 5, width: 10, height: 2 } : { x: 5, y: 1, width: 2, height: 10 }
  const pin =
    axis === 'horizontal'
      ? { x: 1 + pinned, y: 2, width: 2, height: 8 }
      : { x: 2, y: 1 + pinned, width: 8, height: 2 }
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3.5">
      <rect {...track} rx={1} className="fill-current opacity-30" />
      <rect {...pin} rx={1} className="fill-current" />
    </svg>
  )
}

const horizontalOptions = (['left', 'center', 'right'] as FacadeUnitHorizontalAnchor[]).map((value) => ({
  value,
  label: (
    <span className="flex items-center gap-1.5" title={`Pinned to the ${value === 'center' ? 'centre' : `${value} corner`}`}>
      <AnchorGlyph axis="horizontal" value={value} />
      {value === 'center' ? 'Centre' : value === 'left' ? 'Left' : 'Right'}
    </span>
  ),
}))
const verticalOptions = (['bottom', 'center', 'top'] as FacadeUnitVerticalAnchor[]).map((value) => ({
  value,
  label: (
    <span className="flex items-center gap-1.5">
      <AnchorGlyph axis="vertical" value={value} />
      {value === 'center' ? 'Middle' : value === 'bottom' ? 'Floor' : 'Top'}
    </span>
  ),
}))

export const newOpening = (module: FacadeModule): FacadeModuleOpening => ({
  kind: 'window',
  width: Math.min(1.2, module.width),
  height: 1.5,
  sill: 0.9,
  vertical: 'bottom',
  widthMode: 'fixed',
  heightMode: 'fixed',
  offsetX: 0,
  offsetY: 0,
})
const newBalcony = (): FacadeModuleBalcony => ({ depth: 1.4, railing: 'slat', offsetX: 0 })

/** Constraints of one module: how it sits between the corners, and what it holds. */
export function FacadeModuleControls({
  module,
  onChange,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
}: {
  module: FacadeModule
  onChange: (module: FacadeModule) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const set = (patch: Partial<FacadeModule>) => onChange({ ...module, ...patch })
  const { opening, balcony } = module
  const setOpening = (patch: Partial<FacadeModuleOpening>) => set({ opening: { ...opening!, ...patch } })
  const setBalcony = (patch: Partial<FacadeModuleBalcony>) => set({ balcony: { ...balcony!, ...patch } })
  const offsetLabel =
    module.widthMode === 'stretch'
      ? 'Inset'
      : module.horizontal === 'center'
        ? 'Shift'
        : `From ${module.horizontal} corner`

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2">
        <input
          aria-label="Module name"
          value={module.name ?? ''}
          placeholder={module.key}
          onChange={(event) => set({ name: event.target.value || undefined })}
          className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Earlier: takes space first"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Later: yields space"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Delete module" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <PanelSection title="Between the corners">
        <Row label="Size">
          <SegmentedControl
            value={module.widthMode}
            onChange={(widthMode) => set({ widthMode })}
            options={[
              { value: 'repeat', label: 'Repeat' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'stretch', label: 'Stretch' },
            ]}
          />
        </Row>
        {module.widthMode !== 'stretch' && (
          <Row label="Pinned to">
            <SegmentedControl
              value={module.horizontal}
              onChange={(horizontal) => set({ horizontal })}
              options={horizontalOptions}
            />
          </Row>
        )}
        {module.widthMode !== 'stretch' && (
          <MetreSlider label="Module width" value={module.width} min={0.3} max={12} onChange={(width) => set({ width })} />
        )}
        {module.widthMode !== 'repeat' && (
          <MetreSlider label={offsetLabel} value={module.offsetX} min={-10} max={10} onChange={(offsetX) => set({ offsetX })} />
        )}
        {module.widthMode === 'repeat' && (
          <>
            <MetreSlider label="Gap" value={module.gap} max={10} onChange={(gap) => set({ gap })} />
            <MetreSlider label="Clear of corners" value={module.margin} max={5} onChange={(margin) => set({ margin })} />
            <Row label="Leftover">
              <SegmentedControl
                value={module.remainder}
                onChange={(remainder) => set({ remainder })}
                options={[
                  { value: 'center', label: 'Centre' },
                  { value: 'gap-stretch', label: 'Widen gaps' },
                  { value: 'edge-align', label: 'To anchor' },
                ]}
              />
            </Row>
          </>
        )}
      </PanelSection>

      <PanelSection title="Opening">
        <ToggleControl
          label="This module has an opening"
          checked={!!opening}
          onChange={(on) => set({ opening: on ? newOpening(module) : undefined })}
        />
        {opening && (
          <>
            <Row label="Kind">
              <SegmentedControl
                value={opening.kind}
                onChange={(kind) =>
                  setOpening(
                    kind === 'door'
                      ? { kind, sill: 0, vertical: 'bottom', height: Math.max(opening.height, 2.1) }
                      : { kind },
                  )
                }
                options={[
                  { value: 'window', label: 'Window' },
                  { value: 'door', label: 'Door' },
                ]}
              />
            </Row>
            <Row label="Width">
              <SegmentedControl
                value={opening.widthMode}
                onChange={(widthMode) => setOpening({ widthMode, offsetX: 0 })}
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'stretch', label: 'Fill module' },
                ]}
              />
            </Row>
            {opening.widthMode === 'fixed' ? (
              <>
                <MetreSlider label="Width" value={opening.width} min={0.3} max={12} onChange={(width) => setOpening({ width })} />
                <MetreSlider label="Shift" value={opening.offsetX} min={-6} max={6} onChange={(offsetX) => setOpening({ offsetX })} />
              </>
            ) : (
              <MetreSlider label="Inset" value={opening.offsetX} max={3} onChange={(offsetX) => setOpening({ offsetX })} />
            )}
            <Row label="Height">
              <SegmentedControl
                value={opening.heightMode}
                onChange={(heightMode) => setOpening({ heightMode })}
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'stretch', label: 'To ceiling' },
                ]}
              />
            </Row>
            {opening.heightMode === 'fixed' && (
              <>
                <MetreSlider label="Height" value={opening.height} min={0.3} max={10} onChange={(height) => setOpening({ height })} />
                <Row label="Pinned to">
                  <SegmentedControl
                    value={opening.vertical}
                    onChange={(vertical) => setOpening({ vertical })}
                    options={verticalOptions}
                  />
                </Row>
              </>
            )}
            {(opening.heightMode === 'stretch' || opening.vertical !== 'center') && (
              <MetreSlider
                label={opening.vertical === 'top' && opening.heightMode === 'fixed' ? 'From top' : 'Sill'}
                value={opening.sill}
                max={10}
                onChange={(sill) => setOpening({ sill })}
              />
            )}
            <MetreSlider
              label={opening.heightMode === 'stretch' ? 'Head clearance' : 'Shift up'}
              value={opening.offsetY}
              min={opening.heightMode === 'stretch' ? 0 : -5}
              max={5}
              onChange={(offsetY) => setOpening({ offsetY })}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Balcony">
        <ToggleControl
          label="This module has a balcony"
          checked={!!balcony}
          onChange={(on) => set({ balcony: on ? newBalcony() : undefined })}
        />
        {balcony && (
          <>
            <MetreSlider label="Projection" value={balcony.depth} min={0.5} max={3} onChange={(depth) => setBalcony({ depth })} />
            <ToggleControl
              label="As wide as the module"
              checked={balcony.width === undefined}
              onChange={(full) => setBalcony({ width: full ? undefined : Math.max(0.6, module.width) })}
            />
            {balcony.width !== undefined && (
              <MetreSlider label="Width" value={balcony.width} min={0.6} max={12} onChange={(width) => setBalcony({ width })} />
            )}
            <MetreSlider label="Shift" value={balcony.offsetX} min={-6} max={6} onChange={(offsetX) => setBalcony({ offsetX })} />
            <Row label="Railing">
              <SegmentedControl
                value={balcony.railing}
                onChange={(railing) => setBalcony({ railing })}
                options={[
                  { value: 'slat', label: 'Bars' },
                  { value: 'rail', label: 'Rails' },
                  { value: 'glass', label: 'Glass' },
                ]}
              />
            </Row>
          </>
        )}
      </PanelSection>
    </div>
  )
}
