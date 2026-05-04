import type { CircuitBreakerConfig } from '@/schema/types'
import { NumberField } from './NumberField'
import { SliderField } from './SliderField'
import { CheckboxField } from './CheckboxField'

interface Props {
  value: CircuitBreakerConfig
  onChange: (v: CircuitBreakerConfig) => void
}

export function CircuitBreakerEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <CheckboxField
        label="Circuit breaker"
        value={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      {value.enabled && (
        <>
          <SliderField
            label="Failure threshold"
            value={value.failure_threshold}
            onChange={(v) => onChange({ ...value, failure_threshold: v })}
            asPercent
          />
          <NumberField
            label="Success threshold"
            value={value.success_threshold}
            onChange={(v) => onChange({ ...value, success_threshold: Math.round(v) })}
            min={1}
            step={1}
            hint="Consecutive successes in half-open state to close"
          />
          <NumberField
            label="Half-open timeout"
            value={value.half_open_timeout_ms}
            onChange={(v) => onChange({ ...value, half_open_timeout_ms: v })}
            min={0}
            suffix="ms"
          />
        </>
      )}
    </div>
  )
}
