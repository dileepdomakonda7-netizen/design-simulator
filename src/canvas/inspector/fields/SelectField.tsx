interface Props<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: Props<T>) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-700">
      <span className="w-32 shrink-0 truncate">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled ?? false}
        className="flex-1 min-w-0 border border-neutral-300 rounded px-1.5 py-0.5 text-xs bg-white disabled:bg-neutral-50 disabled:text-neutral-400"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
