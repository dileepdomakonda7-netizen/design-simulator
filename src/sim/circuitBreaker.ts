import type { CircuitBreakerConfig } from '@/schema/types'

/**
 * Phase 6b: per-edge circuit breaker state machine.
 *
 *                       failure_threshold exceeded
 *             CLOSED ─────────────────────────────► OPEN
 *               ▲                                    │
 *               │  success_threshold                 │ half_open_timeout_ms
 *               │  consecutive successes             ▼   elapsed since opened
 *               │                                  HALF_OPEN ──────┐
 *               └──────────────────────────────────  │              │
 *                          one probe at a time       │ any failure │
 *                                                    ▼              ▼
 *                                                  OPEN (re-armed timer)
 *
 * v1 simplifications:
 *   - 20-outcome sliding window (hard-coded WINDOW_SIZE).
 *   - failure_threshold is computed only after WINDOW_SIZE outcomes; before
 *     that the breaker stays CLOSED. Avoids tripping on the first observed
 *     failure when the window is small.
 *   - half_open_timeout_ms is measured FROM `openedAt`. Each transition to
 *     OPEN re-stamps `openedAt`, so a failed probe restarts the timer.
 *   - HALF_OPEN is single-flight: only one probe at a time. Production CBs
 *     also do this (resilience4j, Hystrix). Don't loosen it.
 */

export type CBState = 'closed' | 'open' | 'half_open'

interface CBData {
  state: CBState
  window: ('success' | 'failure')[]
  openedAt?: number
  halfOpenSuccesses: number
  halfOpenInFlight: boolean
  /** Phase 6b telemetry: count of breaker-rejections in the current window. */
  recentRejectionAts: number[]
}

const WINDOW_SIZE = 20
const REJECTION_WINDOW_MS = 1000

function getOrInit(state: Record<string, unknown>): CBData {
  let cb = state['cb'] as CBData | undefined
  if (!cb) {
    cb = {
      state: 'closed',
      window: [],
      halfOpenSuccesses: 0,
      halfOpenInFlight: false,
      recentRejectionAts: [],
    }
    state['cb'] = cb
  }
  return cb
}

/**
 * Pre-flight check before emitting a request_send over an edge with a
 * circuit breaker enabled. Mutates state when transitioning OPEN → HALF_OPEN
 * (the timeout has elapsed and we're allowing this one through as the probe).
 *
 * Returns:
 *   - `{ reject: true }` if the request must NOT be sent now.
 *   - `{ reject: false }` if it should be sent. `transitionedTo` is set if
 *     this call moved the state machine (used by the caller to emit the
 *     corresponding `circuit_breaker_*` event).
 */
export function shouldReject(
  edgeState: Record<string, unknown>,
  config: CircuitBreakerConfig,
  now: number,
): { reject: boolean; transitionedTo?: CBState } {
  pruneRejections(edgeState, now)
  const cb = getOrInit(edgeState)

  if (cb.state === 'closed') return { reject: false }

  if (cb.state === 'open') {
    if (cb.openedAt === undefined || now - cb.openedAt < config.half_open_timeout_ms) {
      cb.recentRejectionAts.push(now)
      return { reject: true }
    }
    // Cool-down elapsed → transition to half_open and let THIS request through
    // as the probe.
    cb.state = 'half_open'
    cb.halfOpenSuccesses = 0
    cb.halfOpenInFlight = true
    return { reject: false, transitionedTo: 'half_open' }
  }

  // half_open
  if (cb.halfOpenInFlight) {
    cb.recentRejectionAts.push(now)
    return { reject: true }
  }
  cb.halfOpenInFlight = true
  return { reject: false }
}

/**
 * Update the breaker after observing a downstream outcome. Returns whether
 * the state changed (so the caller can emit a state-transition event).
 */
export function recordOutcome(
  edgeState: Record<string, unknown>,
  outcome: 'success' | 'failure',
  config: CircuitBreakerConfig,
  now: number,
): { stateChanged: boolean; newState?: CBState; failureRate?: number } {
  pruneRejections(edgeState, now)
  const cb = getOrInit(edgeState)
  const prev = cb.state

  if (cb.state === 'half_open') {
    cb.halfOpenInFlight = false
    if (outcome === 'failure') {
      cb.state = 'open'
      cb.openedAt = now
      cb.halfOpenSuccesses = 0
      return prev !== 'open'
        ? { stateChanged: true, newState: 'open' }
        : { stateChanged: false }
    }
    cb.halfOpenSuccesses++
    if (cb.halfOpenSuccesses >= config.success_threshold) {
      cb.state = 'closed'
      cb.window = []
      cb.halfOpenSuccesses = 0
      return { stateChanged: true, newState: 'closed' }
    }
    return { stateChanged: false }
  }

  // closed: append to sliding window, check threshold once it's full.
  cb.window.push(outcome)
  if (cb.window.length > WINDOW_SIZE) cb.window.shift()
  const failures = cb.window.filter((o) => o === 'failure').length
  const failureRate = cb.window.length > 0 ? failures / cb.window.length : 0
  if (
    cb.state === 'closed' &&
    cb.window.length >= WINDOW_SIZE &&
    failureRate >= config.failure_threshold
  ) {
    cb.state = 'open'
    cb.openedAt = now
    return { stateChanged: true, newState: 'open', failureRate }
  }
  return { stateChanged: false, failureRate }
}

/** Read the current state for snapshot rendering. Doesn't mutate. */
export function readSnapshot(
  edgeState: Record<string, unknown>,
  now: number,
): { state: CBState; failureRate: number; rejectionsInWindow: number } | null {
  const cb = edgeState['cb'] as CBData | undefined
  if (!cb) return null
  const fails = cb.window.filter((o) => o === 'failure').length
  const failureRate = cb.window.length > 0 ? fails / cb.window.length : 0
  const cutoff = now - REJECTION_WINDOW_MS
  const recentRejections = cb.recentRejectionAts.filter((t) => t >= cutoff).length
  return { state: cb.state, failureRate, rejectionsInWindow: recentRejections }
}

function pruneRejections(edgeState: Record<string, unknown>, now: number): void {
  const cb = edgeState['cb'] as CBData | undefined
  if (!cb) return
  const cutoff = now - REJECTION_WINDOW_MS
  while (cb.recentRejectionAts.length > 0 && cb.recentRejectionAts[0]! < cutoff) {
    cb.recentRejectionAts.shift()
  }
}
