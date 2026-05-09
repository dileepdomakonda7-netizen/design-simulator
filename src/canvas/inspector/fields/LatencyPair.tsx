import { NumberField } from './NumberField'

/**
 * Paired p50 / p99 latency editor with the math invariant baked in:
 * p99 must be ≥ p50, otherwise sampleLogNormal collapses to a degenerate
 * point distribution that doesn't represent what the user typed.
 *
 * UX:
 *  - p50 increase past current p99 → p99 bumped to match.
 *  - p99 decrease below current p50 → p99 floored at p50.
 *
 * Round-3 R3-4 fix.
 */
export const MAX_LATENCY_MS = 60_000

interface Props {
  /** Field-set label printed above the pair. Optional; pass undefined for inline fields. */
  group?: string
  p50Label?: string
  p99Label?: string
  p50: number
  p99: number
  onChange: (next: { p50: number; p99: number }) => void
  max?: number
}

export function LatencyPair({
  group,
  p50Label = 'Latency p50',
  p99Label = 'Latency p99',
  p50,
  p99,
  onChange,
  max = MAX_LATENCY_MS,
}: Props) {
  return (
    <>
      {group && (
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 pt-1">
          {group}
        </div>
      )}
      <NumberField
        label={p50Label}
        value={p50}
        onChange={(v) => onChange({ p50: v, p99: Math.max(p99, v) })}
        min={0}
        max={max}
        suffix="ms"
      />
      <NumberField
        label={p99Label}
        value={p99}
        onChange={(v) => onChange({ p50, p99: Math.max(p50, v) })}
        min={0}
        max={max}
        suffix="ms"
      />
    </>
  )
}
