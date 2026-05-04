import type { RetryPolicy } from '@/schema/types'
import { NumberField } from './NumberField'
import { SelectField } from './SelectField'
import { CheckboxField } from './CheckboxField'

interface Props {
  value: RetryPolicy
  onChange: (v: RetryPolicy) => void
}

const KIND_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fixed', label: 'Fixed delay' },
  { value: 'exponential_backoff', label: 'Exponential backoff' },
] as const

function defaultRetryPolicy(kind: RetryPolicy['kind']): RetryPolicy {
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'fixed':
      return { kind: 'fixed', max_retries: 3, delay_ms: 100 }
    case 'exponential_backoff':
      return {
        kind: 'exponential_backoff',
        max_retries: 3,
        base_delay_ms: 100,
        max_delay_ms: 5000,
        jitter: true,
      }
  }
}

export function RetryPolicyEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <SelectField
        label="Retry policy"
        value={value.kind}
        options={KIND_OPTIONS}
        onChange={(k) => onChange(defaultRetryPolicy(k))}
      />
      {value.kind === 'fixed' && (
        <>
          <NumberField
            label="Max retries"
            value={value.max_retries}
            onChange={(v) => onChange({ ...value, max_retries: Math.round(v) })}
            min={1}
            step={1}
          />
          <NumberField
            label="Delay"
            value={value.delay_ms}
            onChange={(v) => onChange({ ...value, delay_ms: v })}
            min={0}
            suffix="ms"
          />
        </>
      )}
      {value.kind === 'exponential_backoff' && (
        <>
          <NumberField
            label="Max retries"
            value={value.max_retries}
            onChange={(v) => onChange({ ...value, max_retries: Math.round(v) })}
            min={1}
            step={1}
          />
          <NumberField
            label="Base delay"
            value={value.base_delay_ms}
            onChange={(v) => onChange({ ...value, base_delay_ms: v })}
            min={0}
            suffix="ms"
          />
          <NumberField
            label="Max delay"
            value={value.max_delay_ms}
            onChange={(v) => onChange({ ...value, max_delay_ms: v })}
            min={0}
            suffix="ms"
          />
          <CheckboxField
            label="Jitter"
            value={value.jitter}
            onChange={(v) => onChange({ ...value, jitter: v })}
          />
        </>
      )}
    </div>
  )
}
