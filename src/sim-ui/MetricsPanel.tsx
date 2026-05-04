import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'
import { useSimStore } from '@/store/simStore'

interface ChartPoint {
  t: number
  throughput: number
  p50: number
  p95: number
  p99: number
  errorRate: number
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export function MetricsPanel() {
  const snapshots = useSimStore((s) => s.snapshots)
  const latest = useSimStore((s) => s.latestSnapshot)

  const data = useMemo<ChartPoint[]>(
    () =>
      snapshots.map((s) => ({
        t: s.at,
        throughput: s.windowMetrics.throughputRps,
        p50: s.windowMetrics.latencyMsP50,
        p95: s.windowMetrics.latencyMsP95,
        p99: s.windowMetrics.latencyMsP99,
        errorRate: s.windowMetrics.errorRate * 100,
      })),
    [snapshots],
  )

  const c = latest?.cumulativeMetrics

  return (
    <div className="bg-white rounded-lg border border-neutral-200 h-full flex flex-col overflow-hidden">
      <header className="px-3 py-2 border-b border-neutral-100 flex items-center justify-between">
        <span className="font-caveat text-base text-neutral-700">Metrics</span>
        {c && (
          <span className="text-[10px] text-neutral-500 font-mono">
            {c.totalRequestsCompleted}✓ / {c.totalRequestsFailed}✗ / {c.totalRequestsArrived} in
          </span>
        )}
      </header>
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-px bg-neutral-100 min-h-0">
        <ChartCard title="Throughput (rps)">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#f5f5f5" />
              <XAxis
                dataKey="t"
                tickFormatter={formatTime}
                stroke="#a3a3a3"
                fontSize={10}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                stroke="#a3a3a3"
                fontSize={10}
                tick={{ fontSize: 10 }}
                domain={[0, (dataMax: number) => Math.max(20, dataMax)]}
                width={32}
              />
              <Tooltip
                labelFormatter={(t) => formatTime(t as number)}
                formatter={(v: number) => v.toFixed(1)}
              />
              <Line
                type="monotone"
                dataKey="throughput"
                stroke="#1a1a1a"
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Latency (ms)">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#f5f5f5" />
              <XAxis
                dataKey="t"
                tickFormatter={formatTime}
                stroke="#a3a3a3"
                fontSize={10}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                stroke="#a3a3a3"
                fontSize={10}
                tick={{ fontSize: 10 }}
                width={32}
              />
              <Tooltip
                labelFormatter={(t) => formatTime(t as number)}
                formatter={(v: number) => `${v.toFixed(1)} ms`}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              <Line type="monotone" dataKey="p50" stroke="#22c55e" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p95" stroke="#eab308" strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p99" stroke="#dc2626" strokeWidth={1.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Error rate (%)">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#f5f5f5" />
              <XAxis
                dataKey="t"
                tickFormatter={formatTime}
                stroke="#a3a3a3"
                fontSize={10}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                stroke="#a3a3a3"
                fontSize={10}
                tick={{ fontSize: 10 }}
                domain={[0, 100]}
                width={32}
              />
              <Tooltip
                labelFormatter={(t) => formatTime(t as number)}
                formatter={(v: number) => `${v.toFixed(1)}%`}
              />
              <Area
                type="monotone"
                dataKey="errorRate"
                stroke="#dc2626"
                fill="#fecaca"
                strokeWidth={1.4}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="bg-white p-3 text-xs">
          <div className="font-caveat text-base text-neutral-700 mb-2">Cumulative</div>
          <Stat label="arrived" value={c?.totalRequestsArrived ?? 0} />
          <Stat label="completed" value={c?.totalRequestsCompleted ?? 0} />
          <Stat label="failed" value={c?.totalRequestsFailed ?? 0} color="text-red-700" />
          <Stat label="rejected" value={c?.totalRequestsRejected ?? 0} color="text-red-600" />
          <Stat label="timed out" value={c?.totalRequestsTimedOut ?? 0} color="text-orange-600" />
        </div>
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white px-2 pt-1.5 pb-2 flex flex-col min-h-0">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 px-1">{title}</div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-neutral-500">{label}</span>
      <span className={`font-mono tabular-nums ${color ?? 'text-neutral-800'}`}>{value}</span>
    </div>
  )
}
