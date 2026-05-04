interface Props {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: string
}

export function CheckboxField({ label, value, onChange, disabled, hint }: Props) {
  return (
    <label
      className="flex items-center gap-2 text-xs text-neutral-700 cursor-pointer"
      title={hint ?? ''}
    >
      <span className="w-32 shrink-0 truncate">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled ?? false}
        className="accent-neutral-700"
      />
    </label>
  )
}
