import { useEffect, useRef, useState } from 'react'

/**
 * Local-state-with-debounced-commit pattern for form fields.
 *
 * Returns:
 *   [local, setLocal, flush]
 *
 * - `local` always reflects the latest user input.
 * - `setLocal(v)` updates local immediately and schedules a `commit(v)` after `delay` ms.
 * - `flush()` cancels any pending timer and commits the current local value now (call onBlur / Enter).
 * - When the upstream `value` changes (load, undo, programmatic edit), local syncs to it
 *   ONLY if the change didn't come from our own commit (tracked via lastCommittedRef).
 */
export function useDebouncedCommit<T>(
  value: T,
  commit: (v: T) => void,
  delay = 300,
): [T, (v: T) => void, () => void] {
  const [local, setLocalState] = useState<T>(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCommittedRef = useRef<T>(value)

  // Sync external → local when external changes (and the change didn't come from us)
  useEffect(() => {
    if (!Object.is(value, lastCommittedRef.current)) {
      lastCommittedRef.current = value
      setLocalState(value)
    }
  }, [value])

  function setLocal(v: T) {
    setLocalState(v)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      lastCommittedRef.current = v
      commit(v)
    }, delay)
  }

  function flush() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!Object.is(local, lastCommittedRef.current)) {
      lastCommittedRef.current = local
      commit(local)
    }
  }

  return [local, setLocal, flush]
}
