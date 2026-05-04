import { memo } from 'react'
import type { SimEvent } from '../types'

interface Props {
  events: SimEvent[] // newest first
}

function formatPayload(payload: unknown): string {
  if (payload === undefined || payload === null) return ''
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function EventLogTableImpl({ events }: Props) {
  return (
    <div className="text-xs font-mono">
      <table className="w-full">
        <thead className="sticky top-0 bg-neutral-100 text-left">
          <tr className="text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="px-2 py-1 w-14">id</th>
            <th className="px-2 py-1 w-16">at (ms)</th>
            <th className="px-2 py-1 w-40">kind</th>
            <th className="px-2 py-1 w-32">nodeId</th>
            <th className="px-2 py-1 w-24">requestId</th>
            <th className="px-2 py-1 w-14">cause</th>
            <th className="px-2 py-1">payload</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-neutral-100">
              <td className="px-2 py-1 tabular-nums">{e.id}</td>
              <td className="px-2 py-1 tabular-nums">{e.at.toFixed(1)}</td>
              <td className="px-2 py-1">{e.kind}</td>
              <td className="px-2 py-1 truncate max-w-[10rem]">{e.nodeId ?? ''}</td>
              <td className="px-2 py-1">{e.requestId ?? ''}</td>
              <td className="px-2 py-1 tabular-nums">
                {e.causeEventId !== undefined ? e.causeEventId : ''}
              </td>
              <td className="px-2 py-1 text-neutral-600 truncate max-w-[20rem]">
                {formatPayload(e.payload)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const EventLogTable = memo(EventLogTableImpl)
