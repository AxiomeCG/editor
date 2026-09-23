'use client'
import {
  bayWidth,
  type FacadeBay,
  type FacadeBayBalcony,
  type FacadeBayOpening,
  type FacadeCladding,
  type FacadeUnitHorizontalAnchor,
  type FacadeUnitVerticalAnchor,
} from '@pascal-app/core'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { SliderControl } from '../controls/slider-control'
import { Button } from '../primitives/button'
import { HoverPreviewProvider, PreviewSegmented, PreviewToggle } from './facade-hover-preview'
import { MaterialField } from './facade-material-field'
import { StudioSection } from './studio-section'

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

/** Paint and how the panels sit on the face. */
function CladdingControls<T extends FacadeCladding>({
  value,
  onChange,
}: {
  value: T
  onChange: (value: T) => void
}) {
  return (
    <>
      <MaterialField
        label="Material"
        value={value.material}
        onChange={(material) => onChange({ ...value, material })}
      />
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
  onPreview,
  sectionIndex,
  sectionCount,
}: {
  /** Where this bay's sections start among the panel's pinned sections, and how many there are. */
  sectionIndex: number
  sectionCount: number
  bay: FacadeBay
  onChange: (bay: FacadeBay) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  /** What a hovered choice would make of this bay, or null when nothing is hovered. */
  onPreview?: (bay: FacadeBay | null) => void
}) {
  // While a hovered choice replays its onChange, writes go to the preview, not the draft.
  const previewing = useRef(false)
  const set = (patch: Partial<FacadeBay>) =>
    previewing.current ? onPreview?.({ ...bay, ...patch }) : onChange({ ...bay, ...patch })
  const hoverPreview = {
    begin: (choose: () => void) => {
      previewing.current = true
      try {
        choose()
      } finally {
        previewing.current = false
      }
    },
    end: () => onPreview?.(null),
  }
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
        : 'Gap before'

  // A fragment: the sections must be children of the panel's scroll container to stay pinned.
  return (
    <HoverPreviewProvider value={hoverPreview}>
      <div className="flex shrink-0 items-center gap-1 px-3 py-2">
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

      <StudioSection title="Rhythm" index={sectionIndex + 0} count={sectionCount}>
        <Row label="Size">
          <PreviewSegmented
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
            <PreviewSegmented
              value={bay.horizontal}
              onChange={(horizontal) => set({ horizontal })}
              options={horizontalOptions}
            />
          </Row>
        )}
        {bay.widthMode !== 'stretch' && (
          <Row label="Width">
            <PreviewSegmented
              value={bay.fit}
              onChange={(fit) =>
                set(
                  fit === 'content'
                    ? {
                        fit,
                        // Hugging needs real sizes: a panel filling to the edge and a
                        // stretching opening have none of their own.
                        ...(bay.infill && bay.infill.width === undefined
                          ? { infill: { ...bay.infill, width: 0.4 } }
                          : {}),
                        ...(opening && opening.widthMode !== 'fixed'
                          ? { opening: { ...opening, widthMode: 'fixed', offsetX: 0 } }
                          : {}),
                      }
                    : { fit, width: bayWidth(bay) },
                )
              }
              options={[
                { value: 'content', label: 'Fit content' },
                { value: 'locked', label: 'Set' },
              ]}
            />
          </Row>
        )}
        {bay.widthMode !== 'stretch' && bay.fit === 'locked' && (
          <MetreSlider label="Bay width" value={bay.width} min={0.3} max={12} onChange={(width) => set({ width })} />
        )}
        {bay.widthMode !== 'stretch' && bay.fit === 'content' && (
          <p className="text-[11px] leading-4 text-muted-foreground">
            {bayWidth(bay).toFixed(2)} m: its panels and opening side by side. Widening either
            pushes the bay, and the run re-flows.
          </p>
        )}
        {bay.widthMode !== 'repeat' && (
          <MetreSlider label={offsetLabel} value={bay.offsetX} min={-10} max={10} onChange={(offsetX) => set({ offsetX })} />
        )}
        {bay.widthMode === 'repeat' && (
          <>
            <MetreSlider label="Pier width" value={bay.pier} max={10} onChange={(pier) => set({ pier })} />
            <MetreSlider label="End piers" value={bay.endPier} max={5} onChange={(endPier) => set({ endPier })} />
            <Row label="Leftover">
              <PreviewSegmented
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
      </StudioSection>

      <StudioSection title="Opening" index={sectionIndex + 1} count={sectionCount}>
        <PreviewToggle
          label="This bay has an opening"
          checked={!!opening}
          onChange={(on) => set({ opening: on ? newOpening(bay) : undefined })}
        />
        {opening && (
          <>
            <Row label="Kind">
              <PreviewSegmented
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
                  <PreviewSegmented
                    value={String(opening.columns)}
                    onChange={(columns) => setOpening({ columns: Number(columns) })}
                    options={['1', '2', '3', '4'].map((value) => ({ value, label: value }))}
                  />
                </Row>
                <Row label="Panes up">
                  <PreviewSegmented
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
              <PreviewSegmented
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
              <PreviewSegmented
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
                  <PreviewSegmented
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
      </StudioSection>

      <StudioSection title="Infill" index={sectionIndex + 2} count={sectionCount}>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {opening
            ? 'The sides of the bay, beside the opening, floor to ceiling.'
            : 'Cladding across the whole bay.'}
        </p>
        <PreviewToggle
          label={opening ? 'Panels beside the opening' : 'Clad the whole bay'}
          checked={!!bay.infill}
          onChange={(on) =>
            set({
              infill: on
                ? {
                    material: 'library:preset-charcoal',
                    thickness: 0.03,
                    standoff: 0,
                    sides: 'both',
                    height: 'storey',
                    // A bay that hugs its content grows by the panels' own width.
                    ...(bay.fit === 'content' ? { width: DEFAULT_SIDE_ROOM } : {}),
                  }
                : undefined,
              // An opening as wide as its locked bay leaves no side to clad: make room.
              ...(on &&
              bay.fit === 'locked' &&
              sideRoom < MIN_SIDE_ROOM &&
              opening?.widthMode === 'fixed' &&
              bay.widthMode !== 'stretch'
                ? { width: opening.width + 2 * DEFAULT_SIDE_ROOM }
                : {}),
            })
          }
        />
        {bay.fit === 'locked' && bay.infill && sideRoom < MIN_SIDE_ROOM && (
          <p role="status" className="text-[11px] leading-4 text-amber-400">
            No room beside the opening: widen the bay or narrow the opening.
          </p>
        )}
        {bay.infill && opening && (
          <>
            <Row label="Sides">
              <PreviewSegmented
                value={bay.infill.sides}
                onChange={(sides) => set({ infill: { ...bay.infill!, sides } })}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </Row>
            <Row label="Height">
              <PreviewSegmented
                value={bay.infill.height}
                onChange={(height) => set({ infill: { ...bay.infill!, height } })}
                options={[
                  { value: 'storey', label: 'Storey' },
                  { value: 'opening', label: 'Opening' },
                ]}
              />
            </Row>
            {bay.fit === 'locked' && (
            <PreviewToggle
              label="Fill to the edge of the bay"
              checked={bay.infill.width === undefined}
              onChange={(fill) =>
                set({ infill: { ...bay.infill!, width: fill ? undefined : 0.5 } })
              }
            />
            )}
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
      </StudioSection>

      {opening && (
        <StudioSection title="Spandrel" index={sectionIndex + 3} count={sectionCount}>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Below and above the opening, across its width — the band between one floor's
            window and the next.
          </p>
          <PreviewToggle
            label="Panels below and above the opening"
            checked={!!bay.spandrel}
            onChange={(on) =>
              set({
                spandrel: on
                  ? { material: 'library:flooring-rusticbrick', thickness: 0.03, standoff: 0, parts: 'both' }
                  : undefined,
              })
            }
          />
          {bay.spandrel && (
            <>
              <Row label="Where">
                <PreviewSegmented
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
        </StudioSection>
      )}

      <StudioSection title="Balcony" index={sectionIndex + (opening ? 4 : 3)} count={sectionCount}>
        <PreviewToggle
          label="This bay has a balcony"
          checked={!!balcony}
          onChange={(on) => set({ balcony: on ? newBalcony() : undefined })}
        />
        {balcony && (
          <>
            <MetreSlider label="Projection" value={balcony.depth} min={0.5} max={3} onChange={(depth) => setBalcony({ depth })} />
            <PreviewToggle
              label="As wide as the bay"
              checked={balcony.width === undefined}
              onChange={(full) => setBalcony({ width: full ? undefined : Math.max(0.6, bay.width) })}
            />
            {balcony.width !== undefined && (
              <MetreSlider label="Width" value={balcony.width} min={0.6} max={12} onChange={(width) => setBalcony({ width })} />
            )}
            <MetreSlider label="Shift" value={balcony.offsetX} min={-6} max={6} onChange={(offsetX) => setBalcony({ offsetX })} />
            <Row label="Span">
              <PreviewSegmented
                value={balcony.span}
                onChange={(span) => setBalcony({ span })}
                options={[
                  { value: 'bay', label: 'Each bay' },
                  { value: 'continuous', label: 'Continuous' },
                ]}
              />
            </Row>
            {balcony.span === 'continuous' && (
              <p className="text-[11px] leading-4 text-muted-foreground">
                One balcony along this bay's repeats and any neighbouring bay whose balcony is
                continuous too, such as a door bay beside window bays.
              </p>
            )}
            <Row label="Railing">
              <PreviewSegmented
                value={balcony.railing}
                onChange={(railing) => setBalcony({ railing })}
                options={[
                  { value: 'slat', label: 'Bars' },
                  { value: 'rail', label: 'Rails' },
                  { value: 'glass', label: 'Glass' },
                ]}
              />
            </Row>
            <MaterialField
              label="Deck"
              value={balcony.deckMaterial}
              emptyLabel="Default"
              onChange={(deckMaterial) => setBalcony({ deckMaterial })}
              onClear={() => setBalcony({ deckMaterial: undefined })}
            />
            <MaterialField
              label={balcony.railing === 'glass' ? 'Frame' : 'Railing'}
              value={balcony.railingMaterial}
              emptyLabel="Default"
              onChange={(railingMaterial) => setBalcony({ railingMaterial })}
              onClear={() => setBalcony({ railingMaterial: undefined })}
            />
          </>
        )}
      </StudioSection>
    </HoverPreviewProvider>
  )
}
