import { useEffect, useMemo, useRef } from 'react'
import { useSimStore } from '@/store/simStore'
import type { EventId, SimEvent } from '@/sim/types'

export function EventInspector() {
  const events = useSimStore((s) => s.events)
  const selectedId = useSimStore((s) => s.selectedEventId)
  const selectEvent = useSimStore((s) => s.selectEvent)

  const byId = useMemo(() => {
    const m = new Map<EventId, SimEvent>()
    for (const e of events) m.set(e.id, e)
    return m
  }, [events])

  const selected = selectedId !== null ? byId.get(selectedId) : null

  // Most-recent 100 events for the log table. Sort by (at desc, id desc) so
  // events at the same virtual timestamp display in their priority-queue order
  // — the same chronology the engine processed them in. Without this sort, the
  // raw callback order (from the worker → main thread) interleaves events
  // whose timestamps tie, producing a confusing 'jump' in displayed ids.
  const recent = useMemo(() => {
    const lastN = events.slice(-100)
    return [...lastN].sort((a, b) => b.at - a.at || b.id - a.id)
  }, [events])

  const causalChain = useMemo<SimEvent[]>(() => {
    if (!selected) return []
    const chain: SimEvent[] = []
    const seen = new Set<EventId>()
    let cur: SimEvent | undefined = selected
    while (cur && cur.causeEventId !== undefined) {
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      const parent = byId.get(cur.causeEventId)
      if (!parent) break
      chain.push(parent)
      cur = parent
    }
    return chain
  }, [selected, byId])

  const logRef = useRef<HTMLDivElement>(null)
  // Auto-scroll the log to top on new events when not user-scrolled. Since
  // recent[] is "newest first," top = newest.
  useEffect(() => {
    logRef.current?.scrollTo({ top: 0 })
  }, [events.length])

  return (
    <div className="bg-white rounded-lg border border-neutral-200 h-full flex flex-col overflow-hidden">
      <header className="px-3 py-2 border-b border-neutral-100 flex items-center justify-between shrink-0">
        <span className="font-caveat text-base text-neutral-700">Inspector</span>
        {selected && (
          <button
            onClick={() => selectEvent(null)}
            className="text-[10px] text-neutral-400 hover:text-neutral-700"
          >
            clear
          </button>
        )}
      </header>

      {selected ? (
        <SelectedEventView
          event={selected}
          chain={causalChain}
          onSelect={selectEvent}
        />
      ) : (
        <div className="px-3 py-4 text-xs text-neutral-400 text-center shrink-0">
          Click an event below or a chart point to inspect.
        </div>
      )}

      <div className="border-t border-neutral-100 px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 shrink-0">
        Event log
      </div>
      <div ref={logRef} className="flex-1 overflow-auto text-[11px] font-mono">
        {recent.map((e) => {
          const sel = e.id === selectedId
          return (
            <button
              key={e.id}
              onClick={() => selectEvent(e.id)}
              className={[
                'w-full text-left px-2 py-0.5 border-b border-neutral-50 hover:bg-neutral-50 truncate',
                sel ? 'bg-yellow-50' : '',
                kindColor(e.kind),
              ].join(' ')}
            >
              <span className="text-neutral-400">#{e.id}</span>{' '}
              <span className="tabular-nums">{e.at.toFixed(0)}</span>{' '}
              {e.kind}
              {e.nodeId ? ` · ${e.nodeId.slice(0, 6)}` : ''}
              {e.requestId ? ` · ${e.requestId}` : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SelectedEventView({
  event,
  chain,
  onSelect,
}: {
  event: SimEvent
  chain: SimEvent[]
  onSelect: (id: EventId) => void
}) {
  return (
    <div className="border-b border-neutral-100 max-h-[60%] overflow-auto shrink-0 text-xs">
      <div className="px-3 py-2 bg-yellow-50 border-b border-neutral-100">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-neutral-400">#{event.id}</span>
          <span className="font-medium">{event.kind}</span>
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">
          at {event.at.toFixed(2)}ms
          {event.nodeId && ` · node=${event.nodeId}`}
          {event.requestId && ` · req=${event.requestId}`}
          {event.edgeId && ` · edge=${event.edgeId}`}
        </div>
      </div>
      {event.payload !== undefined && event.payload !== null && (
        <div className="px-3 py-2 border-b border-neutral-100">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Payload</div>
          <pre className="text-[10px] text-neutral-700 font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
      {chain.length > 0 ? (
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
            Caused by
          </div>
          <div className="space-y-0.5">
            {chain.map((e) => (
              <button
                key={e.id}
                onClick={() => onSelect(e.id)}
                className={[
                  'w-full text-left text-[11px] font-mono px-1.5 py-1 rounded hover:bg-neutral-100 truncate',
                  kindColor(e.kind),
                ].join(' ')}
              >
                ↑ #{e.id} {e.kind} <span className="text-neutral-400">at {e.at.toFixed(0)}ms</span>
              </button>
            ))}
            <div className="text-[10px] text-neutral-400 px-1.5">[root cause]</div>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 text-[10px] text-neutral-400">
          No causal chain — this is a root event.
        </div>
      )}
    </div>
  )
}

function kindColor(kind: SimEvent['kind']): string {
  if (kind === 'request_reject' || kind === 'request_timeout') return 'text-red-700'
  if (kind === 'node_failure' || kind === 'partition_start') return 'text-red-700'
  if (kind === 'request_response') return 'text-green-700'
  if (kind === 'request_arrival') return 'text-blue-700'
  // 6e: informational, not an error — yellow/amber.
  if (kind === 'consistency_violation') return 'text-amber-700'
  return 'text-neutral-700'
}
