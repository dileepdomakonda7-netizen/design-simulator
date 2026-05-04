import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  hint?: string
}

/**
 * Number input with debounced commit (300ms idle) and clamp-on-blur.
 * - Typing 1000 character-by-character won't dispatch 1, 10, 100, 1000 to the store.
 * - Blur or Enter commits immediately and clamps to [min, max].
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  disabled,
  hint,
}: Props) {
  const [local, setLocal] = useState(String(value))
  const lastValueRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external → local when value changes (load, undo, etc.)
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value
      setLocal(String(value))
    }
  }, [value])

  function clamp(n: number): number {
    let v = n
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    return v
  }

  function commit(raw: string) {
    const n = parseFloat(raw)
    if (Number.isNaN(n)) {
      // revert to last committed
      setLocal(String(lastValueRef.current))
      return
    }
    const clamped = clamp(n)
    setLocal(String(clamped))
    if (clamped !== lastValueRef.current) {
      lastValueRef.current = clamped
      onChange(clamped)
    }
  }

  function handleChange(raw: string) {
    setLocal(raw)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    // Debounced commit — but only if parseable
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      commit(raw)
    }, 300)
  }

  function flush() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    commit(local)
  }

  return (
    <label className="flex items-center gap-2 text-xs text-neutral-700">
      <span className="w-32 shrink-0 truncate" title={hint ?? label}>
        {label}
      </span>
      <span className="flex-1 flex items-center gap-1.5">
        <input
          type="number"
          value={local}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          }}
          {...(min !== undefined ? { min } : {})}
          {...(max !== undefined ? { max } : {})}
          {...(step !== undefined ? { step } : {})}
          disabled={disabled ?? false}
          className="flex-1 min-w-0 border border-neutral-300 rounded px-1.5 py-0.5 text-xs disabled:bg-neutral-50 disabled:text-neutral-400"
        />
        {suffix && <span className="text-neutral-400 text-[10px] shrink-0">{suffix}</span>}
      </span>
    </label>
  )
}
