'use client'

import { cn } from '../../../lib/utils'

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { label: React.ReactNode; value: T; title?: string }[]
  className?: string
  disabled?: boolean
  mixed?: boolean
  'aria-label'?: string
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled = false,
  mixed = false,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const selected = mixed ? -1 : options.findIndex((option) => option.value === value)
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        'relative flex h-9 w-full items-center rounded-lg border border-border/50 bg-[#2C2C2E] p-[3px]',
        disabled && 'opacity-60',
        className,
      )}
      role="group"
    >
      {/* One thumb slides between equal-width segments instead of each segment
          fading its own background, so the change reads as a single movement. */}
      {selected >= 0 && (
        <span
          aria-hidden
          className="absolute inset-y-[3px] left-[3px] rounded-md bg-[#3e3e3e] shadow-sm ring-1 ring-border/50 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{
            width: `calc((100% - 6px) / ${options.length})`,
            transform: `translateX(${selected * 100}%)`,
          }}
        />
      )}
      {options.map((option, index) => {
        const isSelected = index === selected
        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              'relative z-10 flex h-full flex-1 items-center justify-center rounded-md font-medium text-xs outline-none transition-[color,background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]',
              isSelected
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
              disabled &&
                'cursor-not-allowed hover:bg-transparent hover:text-muted-foreground active:scale-100',
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            title={option.title}
            type="button"
          >
            <span className="flex items-center gap-1.5">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
