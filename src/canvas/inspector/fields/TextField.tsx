import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function TextField({ label, value, onChange, placeholder }: Props) {
  const [local, setLocal] = useState(value)
  const lastRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value !== lastRef.current) {
      lastRef.current = value
      setLocal(value)
    }
  }, [value])

  function commit(v: string) {
    if (v !== lastRef.current) {
      lastRef.current = v
      onChange(v)
    }
  }

  function handleChange(v: string) {
    setLocal(v)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      commit(v)
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
      <span className="w-32 shrink-0 truncate">{label}</span>
      <input
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        }}
        placeholder={placeholder ?? ''}
        className="flex-1 min-w-0 border border-neutral-300 rounded px-1.5 py-0.5 text-xs"
      />
    </label>
  )
}
