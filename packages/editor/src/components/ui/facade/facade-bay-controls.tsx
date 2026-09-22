'use client'
import type {
  FacadeBay,
  FacadeBayBalcony,
  FacadeBayOpening,
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
    <div className="flex items-center pier-2">
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
    <span className="flex items-center pier-1.5" title={`Pinned to the ${value === 'center' ? 'centre' : `${value} corner`}`}>
      <AnchorGlyph axis="horizontal" value={value} />
      {value === 'center' ? 'Centre' : value === 'left' ? 'Left' : 'Right'}
    </span>
  ),
}))
const verticalOptions = (['bottom', 'center', 'top'] as FacadeUnitVerticalAnchor[]).map((value) => ({
  value,
  label: (
    <span className="flex items-center pier-1.5">
      <AnchorGlyph axis="vertical" value={value} />
      {value === 'center' ? 'Middle' : value === 'bottom' ? 'Floor' : 'Top'}
    </span>
  ),
}))

export const newOpening = (bay: FacadeBay): FacadeBayOpening => ({
  kind: 'window',
  width: Math.min(1.2, bay.width),
  height: 1.5,
  sill: 0.9,
  vertical: 'bottom',
  widthMode: 'fixed',
  heightMode: 'fixed',
  offsetX: 0,
  offsetY: 0,
})
const newBalcony = (): FacadeBayBalcony => ({ depth: 1.4, railing: 'slat', offsetX: 0 })

/** Constraints of one bay: how it sits between the corners, and what it holds. */
export function FacadeBayControls({
  bay,
  onChange,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
}: {
  bay: FacadeBay
  onChange: (bay: FacadeBay) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const set = (patch: Partial<FacadeBay>) => onChange({ ...bay, ...patch })
  const { opening, balcony } = bay
  const setOpening = (patch: Partial<FacadeBayOpening>) => set({ opening: { ...opening!, ...patch } })
  const setBalcony = (patch: Partial<FacadeBayBalcony>) => set({ balcony: { ...balcony!, ...patch } })
  const offsetLabel =
    bay.widthMode === 'stretch'
      ? 'Inset'
      : bay.horizontal === 'center'
        ? 'Shift'
        : `From ${bay.horizontal} corner`

  return (
    <div className="flex flex-col">
      <div className="flex items-center pier-1 px-3 py-2">
        <input
          aria-label="Bay name"
          value={bay.name ?? ''}
          placeholder={bay.key}
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
        <Button size="icon-sm" variant="ghost" aria-label="Delete bay" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <PanelSection title="Rhythm">
        <Row label="Size">
          <SegmentedControl
            value={bay.widthMode}
            onChange={(widthMode) => set({ widthMode })}
            options={[
              { value: 'repeat', label: 'Repeat' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'stretch', label: 'Stretch' },
            ]}
          />
        </Row>
        {bay.widthMode !== 'stretch' && (
          <Row label="Pinned to">
            <SegmentedControl
              value={bay.horizontal}
              onChange={(horizontal) => set({ horizontal })}
              options={horizontalOptions}
            />
          </Row>
        )}
        {bay.widthMode !== 'stretch' && (
          <MetreSlider label="Bay width" value={bay.width} min={0.3} max={12} onChange={(width) => set({ width })} />
        )}
        {bay.widthMode !== 'repeat' && (
          <MetreSlider label={offsetLabel} value={bay.offsetX} min={-10} max={10} onChange={(offsetX) => set({ offsetX })} />
        )}
        {bay.widthMode === 'repeat' && (
          <>
            <MetreSlider label="Pier width" value={bay.pier} max={10} onChange={(pier) => set({ pier })} />
            <MetreSlider label="End piers" value={bay.endPier} max={5} onChange={(endPier) => set({ endPier })} />
            <Row label="Leftover">
              <SegmentedControl
                value={bay.remainder}
                onChange={(remainder) => set({ remainder })}
                options={[
                  { value: 'center', label: 'Centre' },
                  { value: 'widen-piers', label: 'Widen piers' },
                  { value: 'align-to-anchor', label: 'To anchor' },
                ]}
              />
            </Row>
          </>
        )}
      </PanelSection>

      <PanelSection title="Opening">
        <ToggleControl
          label="This bay has an opening"
          checked={!!opening}
          onChange={(on) => set({ opening: on ? newOpening(bay) : undefined })}
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
                  { value: 'stretch', label: 'Fill bay' },
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
          label="This bay has a balcony"
          checked={!!balcony}
          onChange={(on) => set({ balcony: on ? newBalcony() : undefined })}
        />
        {balcony && (
          <>
            <MetreSlider label="Projection" value={balcony.depth} min={0.5} max={3} onChange={(depth) => setBalcony({ depth })} />
            <ToggleControl
              label="As wide as the bay"
              checked={balcony.width === undefined}
              onChange={(full) => setBalcony({ width: full ? undefined : Math.max(0.6, bay.width) })}
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
