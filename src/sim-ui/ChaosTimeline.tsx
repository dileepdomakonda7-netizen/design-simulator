import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useDesignStore } from '@/store/designStore'
import { useSimStore } from '@/store/simStore'
import type { ChaosEventSpec, Node } from '@/schema/types'

const SIM_DURATION_DEFAULT = 5000

/**
 * Chaos library + visual timeline. The timeline draws a horizontal SVG axis
 * spanning [0, durationMs] (latest run config or 5000 default) with each
 * scheduled chaos event as a colored marker. Click a marker to edit; X to
 * remove. The library above offers one button per chaos kind to add a new
 * default-configured event at the run midpoint.
 *
 * v1 scope: forms are inline (not modal). Drag-to-reposition is omitted —
 * markers are click-to-edit with numeric inputs. Phase 6 polish.
 */
export function ChaosTimeline() {
  const design = useDesignStore((s) => s.design)
  const updateDesignChaos = useUpdateDesignChaos()
  const config = useSimStore((s) => s.config)
  const durationMs = config?.durationMs ?? SIM_DURATION_DEFAULT
  const plan = design.chaosPlan ?? []

  const [editingId, setEditingId] = useState<string | null>(null)

  function add(spec: ChaosEventSpec) {
    updateDesignChaos([...plan, spec])
    setEditingId(spec.id)
  }
  function update(id: string, patch: Partial<ChaosEventSpec>) {
    updateDesignChaos(
      plan.map((p) => (p.id === id ? ({ ...p, ...patch } as ChaosEventSpec) : p)),
    )
  }
  function remove(id: string) {
    updateDesignChaos(plan.filter((p) => p.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const editing = plan.find((p) => p.id === editingId) ?? null

  return (
    <div className="bg-white rounded-lg border border-neutral-200 h-full flex flex-col overflow-hidden">
      <header className="px-3 py-2 border-b border-neutral-100">
        <div className="font-caveat text-base text-neutral-700">Chaos</div>
      </header>

      <div className="px-3 py-2 grid grid-cols-1 gap-1 border-b border-neutral-100 shrink-0">
        <Quick
          label="💥 Node crash"
          onClick={() => {
            const node = firstNode(design.nodes)
            if (!node) return
            add({
              id: nanoid(),
              kind: 'node_crash',
              node_id: node.id,
              at_ms: Math.round(durationMs / 2),
              duration_ms: 1000,
            })
          }}
          disabled={design.nodes.length === 0}
        />
        <Quick
          label="🌐 Partition"
          onClick={() => {
            if (design.nodes.length < 2) return
            const sideA = [design.nodes[0]!.id]
            const sideB = design.nodes.slice(1).map((n) => n.id)
            add({
              id: nanoid(),
              kind: 'network_partition',
              partition_a: sideA,
              partition_b: sideB,
              at_ms: Math.round(durationMs / 2),
              duration_ms: 1500,
            })
          }}
          disabled={design.nodes.length < 2}
        />
        <Quick
          label="📈 Traffic spike"
          onClick={() => {
            add({
              id: nanoid(),
              kind: 'traffic_spike',
              multiplier: 5,
              at_ms: Math.round(durationMs / 2),
              duration_ms: 1000,
            })
          }}
        />
        <Quick
          label="❄ Cache-miss storm"
          onClick={() => {
            const cache = design.nodes.find((n) => n.type === 'cache')
            if (!cache) return
            add({
              id: nanoid(),
              kind: 'cache_miss_storm',
              node_id: cache.id,
              at_ms: Math.round(durationMs / 2),
              duration_ms: 1500,
            })
          }}
          disabled={!design.nodes.some((n) => n.type === 'cache')}
        />
        <Quick
          label="🔥 Saturate node"
          onClick={() => {
            const target =
              design.nodes.find((n) => n.type === 'app_server') ??
              design.nodes.find((n) => n.type === 'database') ??
              design.nodes[0]
            if (!target) return
            add({
              id: nanoid(),
              kind: 'saturate_node',
              node_id: target.id,
              at_ms: Math.round(durationMs / 2),
              duration_ms: 1500,
            })
          }}
          disabled={design.nodes.length === 0}
        />
        <Quick label="◐ Node degraded" onClick={() => {}} disabled tooltip="Phase 6" />
      </div>

      <div className="px-3 pt-3 pb-2 border-b border-neutral-100 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
          Timeline · {durationMs}ms
        </div>
        <Timeline
          plan={plan}
          durationMs={durationMs}
          selectedId={editingId}
          onSelect={setEditingId}
        />
      </div>

      <div className="flex-1 overflow-auto px-3 py-2">
        {plan.length === 0 ? (
          <div className="text-[11px] text-neutral-400 text-center py-4">
            No chaos scheduled. Use a button above.
          </div>
        ) : (
          <div className="space-y-1.5">
            {plan.map((p) => (
              <ChaosRow
                key={p.id}
                spec={p}
                nodes={design.nodes}
                editing={editingId === p.id}
                onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                onChange={(patch) => update(p.id, patch)}
                onRemove={() => remove(p.id)}
              />
            ))}
          </div>
        )}
        {editing && (
          <div className="mt-3 text-[10px] text-neutral-400">
            Tap a row to expand and edit.
          </div>
        )}
      </div>
    </div>
  )
}

function useUpdateDesignChaos() {
  const setDesign = useDesignStore((s) => s.setDesign)
  const design = useDesignStore((s) => s.design)
  return (chaosPlan: ChaosEventSpec[]) =>
    setDesign({ ...design, chaosPlan, updatedAt: new Date().toISOString() })
}

function firstNode(nodes: Node[]): Node | undefined {
  return nodes[0]
}

function Quick({
  label,
  onClick,
  disabled,
  tooltip,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip ?? ''}
      className="text-xs text-left px-2 py-1.5 rounded border border-neutral-200 hover:bg-neutral-50 disabled:bg-neutral-50 disabled:text-neutral-300 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  )
}

// ─── Timeline SVG ─────────────────────────────────────────────────────────────
//
// Uses an SVG viewBox so the math is decoupled from pixel width: 1 unit per
// virtual ms, total width = durationMs. Markers render at exactly their
// `at_ms` position regardless of how the SVG is scaled into the page.
// CSS `preserveAspectRatio="none"` stretches horizontally only, leaving
// height fixed.

const TIMELINE_PX_HEIGHT = 60

function Timeline({
  plan,
  durationMs,
  selectedId,
  onSelect,
}: {
  plan: readonly ChaosEventSpec[]
  durationMs: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  // viewBox y range is fixed at 100; the px height is set in CSS.
  const VB_H = 100
  const VB_W = Math.max(1, durationMs)
  const ticks = [0, 0.25, 0.5, 0.75, 1] as const

  return (
    <div className="w-full">
      <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height: TIMELINE_PX_HEIGHT }}
    >
      {/* Axis line */}
      <line
        x1={0}
        x2={VB_W}
        y1={VB_H / 2}
        y2={VB_H / 2}
        stroke="#a3a3a3"
        // vector-effect prevents horizontal stretching from thinning the
        // stroke (the SVG is x-scaled but y-fixed).
        vectorEffect="non-scaling-stroke"
        strokeWidth={1}
      />
      {/* Tick marks */}
      {ticks.map((f) => (
        <g key={f}>
          <line
            x1={f * VB_W}
            x2={f * VB_W}
            y1={VB_H / 2 - 6}
            y2={VB_H / 2 + 6}
            stroke="#a3a3a3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
      {/* Markers (drawn AT exact ms positions) */}
      {plan.map((p) => {
        const sx = Math.max(0, Math.min(VB_W, p.at_ms))
        const ex = Math.max(0, Math.min(VB_W, p.at_ms + p.duration_ms))
        const sel = p.id === selectedId
        const color = colorForKind(p.kind)
        return (
          <g
            key={p.id}
            onClick={() => onSelect(sel ? null : p.id)}
            style={{ cursor: 'pointer' }}
          >
            <line
              x1={sx}
              x2={ex}
              y1={VB_H / 2}
              y2={VB_H / 2}
              stroke={color}
              strokeWidth={sel ? 6 : 4}
              opacity={sel ? 1 : 0.7}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={sx} cy={VB_H / 2} r={sel ? 7 : 5} fill={color} vectorEffect="non-scaling-stroke" />
            <circle
              cx={ex}
              cy={VB_H / 2}
              r={sel ? 7 : 5}
              fill={color}
              opacity={0.6}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </svg>
      {/* Tick labels: plain DOM percentages so viewBox stretching doesn't
          distort the text. Each label is positioned at its f-fraction of
          the container width; centered with translate(-50%). */}
      <div className="relative w-full h-3 mt-0.5">
        {ticks.map((f) => (
          <div
            key={f}
            className="absolute text-[8px] text-neutral-400 font-mono"
            style={{ left: `${f * 100}%`, transform: 'translateX(-50%)' }}
          >
            {Math.round(f * durationMs)}
          </div>
        ))}
      </div>
    </div>
  )
}

function colorForKind(kind: ChaosEventSpec['kind']): string {
  switch (kind) {
    case 'node_crash':
      return '#dc2626'
    case 'network_partition':
      return '#2563eb'
    case 'traffic_spike':
      return '#f97316'
    case 'cache_miss_storm':
      return '#06b6d4'
    case 'saturate_node':
      return '#a855f7'
  }
}

// ─── Chaos row (collapsed + expanded) ────────────────────────────────────────

function ChaosRow({
  spec,
  nodes,
  editing,
  onClick,
  onChange,
  onRemove,
}: {
  spec: ChaosEventSpec
  nodes: Node[]
  editing: boolean
  onClick: () => void
  onChange: (patch: Partial<ChaosEventSpec>) => void
  onRemove: () => void
}) {
  const summary = useMemo(() => describeSpec(spec, nodes), [spec, nodes])
  const color = colorForKind(spec.kind)

  return (
    <div className="rounded border border-neutral-200">
      <button
        onClick={onClick}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-neutral-50"
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="flex-1 truncate">{summary}</span>
        <span className="text-[10px] text-neutral-400 font-mono shrink-0">
          {spec.at_ms}–{spec.at_ms + spec.duration_ms}ms
        </span>
      </button>
      {editing && (
        <div className="px-2 pt-1 pb-2 border-t border-neutral-100 space-y-1.5">
          <NumPair label="at (ms)" value={spec.at_ms} onChange={(v) => onChange({ at_ms: v })} />
          <NumPair
            label="duration (ms)"
            value={spec.duration_ms}
            onChange={(v) => onChange({ duration_ms: v })}
          />
          {(spec.kind === 'node_crash' ||
            spec.kind === 'cache_miss_storm' ||
            spec.kind === 'saturate_node') && (
            <SelectPair
              label={spec.kind === 'cache_miss_storm' ? 'cache' : 'node'}
              value={spec.node_id}
              options={
                spec.kind === 'cache_miss_storm'
                  ? nodes.filter((n) => n.type === 'cache').map((n) => ({ id: n.id, label: n.label }))
                  : nodes.map((n) => ({ id: n.id, label: n.label }))
              }
              onChange={(v) => onChange({ node_id: v })}
            />
          )}
          {spec.kind === 'traffic_spike' && (
            <NumPair
              label="multiplier"
              value={spec.multiplier}
              onChange={(v) => onChange({ multiplier: v })}
            />
          )}
          {spec.kind === 'network_partition' && (
            <div className="text-[10px] text-neutral-500">
              side A: {spec.partition_a.length} node(s) · side B: {spec.partition_b.length}
              <div className="text-[10px] text-neutral-400 mt-0.5">
                Phase 6: visual side editor. v1 splits at first node.
              </div>
            </div>
          )}
          <button
            onClick={onRemove}
            className="text-[10px] text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

function describeSpec(spec: ChaosEventSpec, nodes: Node[]): string {
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id.slice(0, 6)
  switch (spec.kind) {
    case 'node_crash':
      return `Crash ${labelOf(spec.node_id)}`
    case 'network_partition':
      return `Partition (${spec.partition_a.length}↔${spec.partition_b.length})`
    case 'traffic_spike':
      return `Spike ${spec.multiplier}× traffic`
    case 'cache_miss_storm':
      return `Miss-storm ${labelOf(spec.node_id)}`
    case 'saturate_node':
      return `Saturate ${labelOf(spec.node_id)}`
  }
}

function NumPair({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-neutral-700">
      <span className="w-20 shrink-0 text-neutral-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        className="flex-1 min-w-0 border border-neutral-300 rounded px-1.5 py-0.5 text-[11px] font-mono"
      />
    </label>
  )
}

function SelectPair({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-neutral-700">
      <span className="w-20 shrink-0 text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 border border-neutral-300 rounded px-1.5 py-0.5 text-[11px] bg-white"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
