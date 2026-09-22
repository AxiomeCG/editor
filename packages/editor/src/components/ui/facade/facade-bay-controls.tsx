'use client'
import {
  FACADE_FINISHES,
  type FacadeBay,
  type FacadeBayBalcony,
  type FacadeBayOpening,
  type FacadeCladding,
  type FacadeFinish,
  type FacadeUnitHorizontalAnchor,
  type FacadeUnitVerticalAnchor,
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
  windowType: 'casement',
  columns: 1,
  rows: 1,
  doorType: 'french',
})
const newBalcony = (): FacadeBayBalcony => ({
  depth: 1.4,
  railing: 'slat',
  span: 'bay',
  offsetX: 0,
})

/** The operations a facade window is likely to use, in the order people reach for them. */
const WINDOW_TYPES: [FacadeBayOpening['windowType'], string][] = [
  ['casement', 'Casement'],
  ['fixed', 'Fixed'],
  ['double-hung', 'Sash (double-hung)'],
  ['single-hung', 'Sash (single-hung)'],
  ['sliding', 'Sliding'],
  ['awning', 'Awning'],
  ['hopper', 'Hopper'],
  ['louvered', 'Louvred'],
]
const DOOR_TYPES: [FacadeBayOpening['doorType'], string][] = [
  ['french', 'French (glazed)'],
  ['hinged', 'Hinged'],
  ['double', 'Double'],
  ['sliding', 'Sliding'],
  ['folding', 'Folding'],
  ['garage-sectional', 'Garage'],
]

const MIN_SIDE_ROOM = 0.05
/** Room left each side when turning infill on for a bay its opening fills. */
const DEFAULT_SIDE_ROOM = 0.4

export const FINISH_LABELS: Record<FacadeFinish, string> = {
  brick: 'Brick',
  stone: 'Stone',
  plaster: 'Plaster',
  siding: 'Siding',
  timber: 'Timber',
  glass: 'Glass',
  metal: 'Metal',
}

/** Finish, colour and how the panels sit on the face. */
function CladdingControls<T extends FacadeCladding>({
  value,
  onChange,
}: {
  value: T
  onChange: (value: T) => void
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">Material</span>
        <select
          aria-label="Panel material"
          value={value.finish}
          onChange={(event) => onChange({ ...value, finish: event.target.value as FacadeFinish })}
          className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2 text-xs text-foreground"
        >
          {FACADE_FINISHES.map((finish) => (
            <option key={finish} value={finish}>
              {FINISH_LABELS[finish]}
            </option>
          ))}
        </select>
        <input
          type="color"
          aria-label="Panel colour"
          value={value.color}
          onChange={(event) => onChange({ ...value, color: event.target.value })}
          className="h-8 w-10 cursor-pointer rounded-md border border-border/50 bg-transparent"
        />
      </div>
      <MetreSlider
        label="Depth"
        value={value.thickness}
        min={0.005}
        max={0.5}
        step={0.005}
        onChange={(thickness) => onChange({ ...value, thickness })}
      />
      <MetreSlider
        label="Stand-off"
        value={value.standoff}
        max={1}
        step={0.005}
        onChange={(standoff) => onChange({ ...value, standoff })}
      />
    </>
  )
}

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
  // How much of the bay is left beside a fixed opening, for the infill to clad.
  const sideRoom = !opening
    ? Number.POSITIVE_INFINITY
    : opening.widthMode === 'stretch'
      ? opening.offsetX * 2
      : bay.widthMode === 'stretch'
        ? Number.POSITIVE_INFINITY
        : bay.width - opening.width
  const offsetLabel =
    bay.widthMode === 'stretch'
      ? 'Inset'
      : bay.horizontal === 'center'
        ? 'Shift'
        : `From ${bay.horizontal} corner`

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2">
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
            {opening.kind === 'window' ? (
              <>
                <Row label="Operation">
                  <select
                    aria-label="Window operation"
                    value={opening.windowType}
                    onChange={(event) =>
                      setOpening({ windowType: event.target.value as FacadeBayOpening['windowType'] })
                    }
                    className="h-8 w-full rounded-md border border-border/50 bg-background px-2 text-xs text-foreground"
                  >
                    {WINDOW_TYPES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Panes across">
                  <SegmentedControl
                    value={String(opening.columns)}
                    onChange={(columns) => setOpening({ columns: Number(columns) })}
                    options={['1', '2', '3', '4'].map((value) => ({ value, label: value }))}
                  />
                </Row>
                <Row label="Panes up">
                  <SegmentedControl
                    value={String(opening.rows)}
                    onChange={(rows) => setOpening({ rows: Number(rows) })}
                    options={['1', '2', '3'].map((value) => ({ value, label: value }))}
                  />
                </Row>
              </>
            ) : (
              <Row label="Door">
                <select
                  aria-label="Door style"
                  value={opening.doorType}
                  onChange={(event) =>
                    setOpening({ doorType: event.target.value as FacadeBayOpening['doorType'] })
                  }
                  className="h-8 w-full rounded-md border border-border/50 bg-background px-2 text-xs text-foreground"
                >
                  {DOOR_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Row>
            )}
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

      <PanelSection title="Infill">
        <p className="text-[11px] leading-4 text-muted-foreground">
          {opening
            ? 'The sides of the bay, beside the opening, floor to ceiling.'
            : 'Cladding across the whole bay.'}
        </p>
        <ToggleControl
          label={opening ? 'Panels beside the opening' : 'Clad the whole bay'}
          checked={!!bay.infill}
          onChange={(on) =>
            set({
              infill: on
                ? { finish: 'siding', color: '#2b2d2f', thickness: 0.03, standoff: 0, sides: 'both' }
                : undefined,
              // An opening as wide as its bay leaves no side to clad: make room.
              ...(on && sideRoom < MIN_SIDE_ROOM && opening?.widthMode === 'fixed' && bay.widthMode !== 'stretch'
                ? { width: opening.width + 2 * DEFAULT_SIDE_ROOM }
                : {}),
            })
          }
        />
        {bay.infill && sideRoom < MIN_SIDE_ROOM && (
          <p role="status" className="text-[11px] leading-4 text-amber-400">
            No room beside the opening: widen the bay or narrow the opening.
          </p>
        )}
        {bay.infill && opening && (
          <>
            <Row label="Sides">
              <SegmentedControl
                value={bay.infill.sides}
                onChange={(sides) => set({ infill: { ...bay.infill!, sides } })}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </Row>
            <ToggleControl
              label="Fill to the edge of the bay"
              checked={bay.infill.width === undefined}
              onChange={(fill) =>
                set({ infill: { ...bay.infill!, width: fill ? undefined : 0.5 } })
              }
            />
            {bay.infill.width !== undefined && (
              <MetreSlider
                label="Panel width"
                value={bay.infill.width}
                min={0.05}
                max={6}
                onChange={(width) => set({ infill: { ...bay.infill!, width } })}
              />
            )}
          </>
        )}
        {bay.infill && (
          <CladdingControls value={bay.infill} onChange={(infill) => set({ infill })} />
        )}
      </PanelSection>

      {opening && (
        <PanelSection title="Spandrel">
          <p className="text-[11px] leading-4 text-muted-foreground">
            Below and above the opening, across its width — the band between one floor's
            window and the next.
          </p>
          <ToggleControl
            label="Panels below and above the opening"
            checked={!!bay.spandrel}
            onChange={(on) =>
              set({
                spandrel: on
                  ? { finish: 'brick', color: '#5a4136', thickness: 0.03, standoff: 0, parts: 'both' }
                  : undefined,
              })
            }
          />
          {bay.spandrel && (
            <>
              <Row label="Where">
                <SegmentedControl
                  value={bay.spandrel.parts}
                  onChange={(parts) => set({ spandrel: { ...bay.spandrel!, parts } })}
                  options={[
                    { value: 'both', label: 'Both' },
                    { value: 'below', label: 'Below' },
                    { value: 'above', label: 'Above' },
                  ]}
                />
              </Row>
              <CladdingControls value={bay.spandrel} onChange={(spandrel) => set({ spandrel })} />
            </>
          )}
        </PanelSection>
      )}

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
            <Row label="Span">
              <SegmentedControl
                value={balcony.span}
                onChange={(span) => setBalcony({ span })}
                options={[
                  { value: 'bay', label: 'Each bay' },
                  { value: 'continuous', label: 'Continuous' },
                ]}
              />
            </Row>
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
