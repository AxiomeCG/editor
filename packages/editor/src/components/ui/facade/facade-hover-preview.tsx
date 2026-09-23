'use client'
import { createContext, type ReactNode, useContext } from 'react'
import { SegmentedControl } from '../controls/segmented-control'
import { ToggleControl } from '../controls/toggle-control'

/**
 * How a panel previews a choice: `begin` replays the control's own onChange in
 * preview mode (the host routes its writes to a preview instead of the draft),
 * `end` drops the preview. Controls stay unaware of what they preview.
 */
export type HoverPreview = { begin: (choose: () => void) => void; end: () => void }

const HoverPreviewContext = createContext<HoverPreview | null>(null)

export function HoverPreviewProvider({ value, children }: { value: HoverPreview; children: ReactNode }) {
  return <HoverPreviewContext.Provider value={value}>{children}</HoverPreviewContext.Provider>
}

/** A segmented control whose options preview themselves on hover. */
export function PreviewSegmented<T extends string>(props: {
  value: T
  onChange: (value: T) => void
  options: { label: ReactNode; value: T }[]
  className?: string
  disabled?: boolean
}) {
  const preview = useContext(HoverPreviewContext)
  return (
    <SegmentedControl
      {...props}
      onHoverValue={
        preview
          ? (value) =>
              value === null || value === props.value
                ? preview.end()
                : preview.begin(() => props.onChange(value))
          : undefined
      }
    />
  )
}

/** A toggle that previews its other state on hover. */
export function PreviewToggle(props: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  const preview = useContext(HoverPreviewContext)
  return (
    <ToggleControl
      {...props}
      onHoverChange={
        preview
          ? (hovering) =>
              hovering ? preview.begin(() => props.onChange(!props.checked)) : preview.end()
          : undefined
      }
    />
  )
}

/** The panel's preview hook-up, for controls that are neither segments nor toggles. */
export function useHoverPreview() {
  return useContext(HoverPreviewContext)
}

/** A button that previews what clicking it would do, then does it. */
export function PreviewButton({
  onClick,
  children,
  className,
  label,
}: {
  onClick: () => void
  children: ReactNode
  className?: string
  label?: string
}) {
  const preview = useContext(HoverPreviewContext)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        preview?.end()
        onClick()
      }}
      onPointerEnter={preview ? () => preview.begin(onClick) : undefined}
      onPointerLeave={preview ? () => preview.end() : undefined}
      className={className}
    >
      {children}
    </button>
  )
}
