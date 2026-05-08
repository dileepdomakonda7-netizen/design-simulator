import { useDebouncedCommit } from './useDebouncedCommit'

interface Props {
  label: string
  value: number // stored as 0..1 when asPercent
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  asPercent?: boolean // display as integer percent (multiplies by 100)
}

/**
 * Slider for bounded numeric ranges. When `asPercent` is true, the slider
 * spans 0..1 internally but displays as 0..100 (rounded percent).
 */
export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  asPercent = false,
}: Props) {
  const [local, setLocal, flush] = useDebouncedCommit(value, onChange, 200)
  const display = asPercent ? Math.round(local * 100) : local

  return (
    <label className="flex items-center gap-2 text-xs text-neutral-700">
      <span className="w-28 shrink-0 truncate" title={label}>{label}</span>
      <span className="flex-1 flex items-center gap-1.5 min-w-0">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={local}
          onChange={(e) => setLocal(parseFloat(e.target.value))}
          onMouseUp={flush}
          onTouchEnd={flush}
          className="flex-1 min-w-0 accent-neutral-700"
        />
        <span className="tabular-nums text-[10px] text-neutral-500 w-9 text-right shrink-0">
          {display}
          {asPercent ? '%' : ''}
        </span>
      </span>
    </label>
  )
}
