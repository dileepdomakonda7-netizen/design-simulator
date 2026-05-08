import { useModeStore, type Mode } from '@/store/modeStore'

const MODES: { value: Mode; label: string }[] = [
  { value: 'build', label: 'Build' },
  { value: 'sketch', label: 'Sketch' },
  { value: 'simulate', label: 'Simulate' },
]

export function ModeToggle() {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)

  return (
    <div
      className="flex rounded-md border border-gray-300 overflow-hidden text-sm font-medium"
      role="group"
      aria-label="Mode"
    >
      {MODES.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setMode(value)}
          aria-pressed={mode === value}
          className={[
            'px-3 py-1.5 transition-colors',
            mode === value
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
