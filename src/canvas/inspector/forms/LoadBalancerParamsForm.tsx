import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SelectField } from '../fields/SelectField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'load_balancer' }>
}

const ALGORITHMS = [
  { value: 'round_robin', label: 'Round Robin' },
  { value: 'least_connections', label: 'Least Connections' },
  { value: 'random', label: 'Random' },
  { value: 'consistent_hash', label: 'Consistent Hash' },
] as const

export function LoadBalancerParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <SelectField
        label="Algorithm"
        value={node.params.algorithm}
        options={ALGORITHMS}
        onChange={(v) => update(node.id, 'load_balancer', { algorithm: v })}
      />
      <NumberField
        label="Max connections"
        value={node.params.max_connections}
        onChange={(v) => update(node.id, 'load_balancer', { max_connections: Math.round(v) })}
        min={1}
        max={1_000_000}
        step={1}
      />
      <NumberField
        label="Health check"
        value={node.params.health_check_interval_ms}
        onChange={(v) => update(node.id, 'load_balancer', { health_check_interval_ms: v })}
        min={0}
        max={600_000}
        suffix="ms"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'load_balancer', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
