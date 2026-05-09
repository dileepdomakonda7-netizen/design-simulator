import { useState } from 'react'
import { useSimStore, type SimStatus } from '@/store/simStore'

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10] as const

interface Props {
  status: SimStatus
  hasConfig: boolean
  onRun: (seed: number, durationMs: number, rps: number, speed: number) => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onReset: () => void
  onSpeedChange: (multiplier: number) => void
}

export function ControlPanel({
  status,
  hasConfig,
  onRun,
  onPause,
  onResume,
  onCancel,
  onReset,
  onSpeedChange,
}: Props) {
  const [seed, setSeed] = useState(42)
  const [durationMs, setDurationMs] = useState(5000)
  const [rps, setRps] = useState(10)
  const [speed, setSpeed] = useState<number>(1)
  const digest = useSimStore((s) => s.digest)
  const virtualTime = useSimStore((s) => s.currentVirtualTimeMs)

  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const isActive = isRunning || isPaused
  const showReset = status === 'completed' || status === 'cancelled'
  const inputsLocked = isActive

  return (
    <div className="flex items-center gap-3 px-4 h-11 min-h-11 max-h-11 border-b border-neutral-200 bg-white shrink-0 overflow-x-auto overflow-y-hidden">
      <div className="flex items-center gap-1">
        {!isActive && (
          <button
            onClick={() => onRun(seed, durationMs, rps, speed)}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
          >
            ▶ Run
          </button>
        )}
        {isRunning && (
          <button
            onClick={onPause}
            className="text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-50"
          >
            ⏸ Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={onResume}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
          >
            ▶ Resume
          </button>
        )}
        {isActive && (
          <button
            onClick={onCancel}
            className="text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            ◼ Cancel
          </button>
        )}
        {showReset && (
          <button
            onClick={onReset}
            className="text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-50"
          >
            ↺ Reset
          </button>
        )}
      </div>

      <div className="h-5 w-px bg-neutral-200" />

      <NumberInput
        label="seed"
        value={seed}
        onChange={setSeed}
        disabled={inputsLocked}
        width={70}
        min={0}
      />
      <NumberInput
        label="duration"
        value={durationMs}
        onChange={setDurationMs}
        disabled={inputsLocked}
        width={90}
        suffix="ms"
        min={1}
        max={600000}
      />
      <NumberInput
        label="rps"
        value={rps}
        onChange={setRps}
        disabled={inputsLocked}
        width={60}
        min={1}
        max={10000}
      />

      <div className="h-5 w-px bg-neutral-200" />

      <label className="flex items-center gap-1.5 text-xs text-neutral-500">
        <span>speed</span>
        <select
          value={speed}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setSpeed(v)
            onSpeedChange(v)
          }}
          className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs font-mono bg-white"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500 shrink-0">
        <span className="font-mono tabular-nums">
          t = {(virtualTime / 1000).toFixed(2)}s
        </span>
        {digest && (
          <button
            onClick={() => navigator.clipboard?.writeText(digest)}
            className="font-mono text-neutral-700 hover:text-neutral-900"
            title="Click to copy"
          >
            digest <span className="select-all">{digest}</span>
          </button>
        )}
        <span
          className={[
            'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded',
            statusColor(status),
          ].join(' ')}
        >
          {status}
        </span>
        {!hasConfig && status === 'idle' && (
          <span className="text-[10px] text-neutral-400">click run to start</span>
        )}
      </div>
    </div>
  )
}

function statusColor(s: SimStatus): string {
  switch (s) {
    case 'running':
      return 'bg-green-100 text-green-800'
    case 'paused':
      return 'bg-yellow-100 text-yellow-800'
    case 'completed':
      return 'bg-blue-100 text-blue-800'
    case 'cancelled':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-neutral-100 text-neutral-600'
  }
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
  width,
  suffix,
  min = 0,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled: boolean
  width: number
  suffix?: string
  min?: number
  max?: number
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-500">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        {...(max !== undefined ? { max } : {})}
        step={1}
        value={value}
        disabled={disabled}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!Number.isFinite(n)) return
          let clamped = n
          if (clamped < min) clamped = min
          if (max !== undefined && clamped > max) clamped = max
          onChange(clamped)
        }}
        style={{ width }}
        className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs font-mono tabular-nums disabled:bg-neutral-100 disabled:text-neutral-400"
      />
      {suffix && <span className="text-neutral-400">{suffix}</span>}
    </label>
  )
}
