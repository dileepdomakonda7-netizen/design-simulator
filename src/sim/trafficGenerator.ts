import type { Design, TrafficSource } from '@/schema/types'
import type { EventId, SimEvent } from './types'
import { subStream } from './prng'

interface GenerateResult {
  events: SimEvent[]
  nextEventId: EventId
  nextRequestId: number
}

/**
 * Pre-computes all `request_arrival` events for the entire simulation.
 *
 * For 4 of the 6 LoadShapes the schedule is fully deterministic from the
 * load shape parameters alone (no PRNG): `constant`, `ramp`, `step`, `spike`,
 * `sine`. Only `random_burst` consumes the PRNG (Poisson inter-arrival via
 * exponential samples). Sub-stream key: `traffic:<source.id>`.
 *
 * Each arrival is assigned a fresh event id (continuing from `startingEventId`)
 * and a fresh request id of the form `req-<n>` (continuing from
 * `startingRequestNumber`). The engine creates the matching SimRequest
 * record when it processes the arrival in the main loop — the traffic
 * generator only emits events.
 */
export function generateTraffic(
  _design: Design,
  traffic: TrafficSource[],
  durationMs: number,
  globalSeed: number,
  startingEventId: EventId,
  startingRequestNumber: number,
): GenerateResult {
  const events: SimEvent[] = []
  let nextEventId = startingEventId
  let nextRequestNumber = startingRequestNumber

  for (const source of traffic) {
    const arrivalTimes = scheduleArrivals(source, durationMs, globalSeed)
    // 6e: optional read/write classification per arrival. Only consumes rng
    // when write_ratio > 0 — pre-6e sources keep their event payloads byte-
    // identical, preserving every prior digest.
    const writeRatio = source.write_ratio ?? 0
    const writeRng =
      writeRatio > 0 ? subStream(globalSeed, `traffic-write:${source.id}`) : undefined
    for (const t of arrivalTimes) {
      const kind = writeRng ? (writeRng() < writeRatio ? 'write' : 'read') : undefined
      events.push({
        id: nextEventId++,
        at: t,
        kind: 'request_arrival',
        nodeId: source.target_node_id,
        requestId: `req-${nextRequestNumber++}`,
        payload: {
          trafficSourceId: source.id,
          ...(kind ? { kind } : {}),
        },
      })
    }
  }

  return { events, nextEventId, nextRequestId: nextRequestNumber }
}

/**
 * Returns the sorted list of arrival times in [0, durationMs) for a single source.
 * Pure given (source, durationMs, globalSeed).
 */
function scheduleArrivals(
  source: TrafficSource,
  durationMs: number,
  globalSeed: number,
): number[] {
  const shape = source.load_shape
  switch (shape.kind) {
    case 'constant':
      return constantSchedule(shape.rps, durationMs)
    case 'ramp':
      return rampSchedule(shape.start_rps, shape.end_rps, shape.duration_ms, durationMs)
    case 'step':
      return stepSchedule(shape.steps, durationMs)
    case 'spike':
      return spikeSchedule(
        shape.base_rps,
        shape.spike_rps,
        shape.at_ms,
        shape.duration_ms,
        durationMs,
      )
    case 'sine':
      return sineSchedule(shape.base_rps, shape.amplitude_rps, shape.period_ms, durationMs)
    case 'random_burst':
      return randomBurstSchedule(
        shape.base_rps,
        shape.burst_probability,
        shape.burst_multiplier,
        shape.burst_duration_ms,
        durationMs,
        subStream(globalSeed, `traffic:${source.id}`),
      )
  }
}

function evenSpaced(rps: number, fromMs: number, toMs: number, out: number[]): void {
  if (rps <= 0) return
  const interval = 1000 / rps
  // Place arrivals at fromMs + interval/2, +3*interval/2, ... so the first
  // arrival is offset half an interval (avoids piling on at exact second boundaries).
  for (let t = fromMs + interval / 2; t < toMs; t += interval) {
    out.push(t)
  }
}

function constantSchedule(rps: number, durationMs: number): number[] {
  const out: number[] = []
  evenSpaced(rps, 0, durationMs, out)
  return out
}

function rampSchedule(
  startRps: number,
  endRps: number,
  rampMs: number,
  durationMs: number,
): number[] {
  // Integrate the linear rps to find arrival times. The number of arrivals
  // accumulated by time t inside the ramp is the integral of rps(t):
  //   N(t) = startRps*t/1000 + (endRps - startRps) * t^2 / (2 * rampMs * 1000)
  // Solve N(t) = k for t to place the k-th arrival. We'll compute arrivals
  // numerically by stepping rps over small intervals — simpler and good enough
  // for v1. After the ramp, rate stays at endRps until durationMs.
  const out: number[] = []
  const slice = 50 // ms
  let acc = 0 // fractional arrivals accumulated
  for (let t = 0; t < durationMs; t += slice) {
    const phase = Math.min(t / Math.max(rampMs, 1), 1)
    const rps = startRps + (endRps - startRps) * phase
    acc += (rps * slice) / 1000
    while (acc >= 1) {
      out.push(t + slice / 2)
      acc -= 1
    }
  }
  return out
}

function stepSchedule(
  steps: Array<{ at_ms: number; rps: number }>,
  durationMs: number,
): number[] {
  if (steps.length === 0) return []
  const sorted = [...steps].sort((a, b) => a.at_ms - b.at_ms)
  const out: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!
    const next = sorted[i + 1]
    const from = Math.max(cur.at_ms, 0)
    const to = Math.min(next?.at_ms ?? durationMs, durationMs)
    if (to > from) evenSpaced(cur.rps, from, to, out)
  }
  return out
}

function spikeSchedule(
  baseRps: number,
  spikeRps: number,
  atMs: number,
  durationMs: number,
  totalMs: number,
): number[] {
  const out: number[] = []
  const spikeEnd = Math.min(atMs + durationMs, totalMs)
  evenSpaced(baseRps, 0, Math.min(atMs, totalMs), out)
  if (atMs < totalMs) evenSpaced(spikeRps, atMs, spikeEnd, out)
  if (spikeEnd < totalMs) evenSpaced(baseRps, spikeEnd, totalMs, out)
  out.sort((a, b) => a - b)
  return out
}

function sineSchedule(
  baseRps: number,
  amplitudeRps: number,
  periodMs: number,
  durationMs: number,
): number[] {
  // Numerical accumulation, same idea as ramp but with sinusoidal rate.
  const out: number[] = []
  const slice = 50
  let acc = 0
  for (let t = 0; t < durationMs; t += slice) {
    const rps = Math.max(0, baseRps + amplitudeRps * Math.sin((2 * Math.PI * t) / periodMs))
    acc += (rps * slice) / 1000
    while (acc >= 1) {
      out.push(t + slice / 2)
      acc -= 1
    }
  }
  return out
}

function randomBurstSchedule(
  baseRps: number,
  burstProbability: number,
  burstMultiplier: number,
  burstDurationMs: number,
  durationMs: number,
  rng: () => number,
): number[] {
  // At each 1s boundary, with probability `burstProbability`, enter a burst that
  // lasts `burstDurationMs` and multiplies rate by `burstMultiplier`. Inter-
  // arrival inside any rate `r` is exponential with mean 1000/r (Poisson).
  const out: number[] = []
  let t = 0
  let burstUntil = -1
  while (t < durationMs) {
    // Decide if we should start a new burst (only when not already bursting).
    if (t >= burstUntil && rng() < burstProbability * 0.001) {
      // 0.001 normalizes per-1ms-tick probability. burstProbability is per second.
      burstUntil = t + burstDurationMs
    }
    const rate = t < burstUntil ? baseRps * burstMultiplier : baseRps
    if (rate <= 0) {
      t += 1
      continue
    }
    // Sample exponential inter-arrival.
    const u = Math.max(rng(), Number.EPSILON)
    const delta = -Math.log(u) * (1000 / rate)
    t += delta
    if (t < durationMs) out.push(t)
  }
  return out
}
