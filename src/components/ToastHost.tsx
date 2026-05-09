import { useEffect } from 'react'
import { useUIStore } from '@/store/uiStore'

/**
 * Renders the queue of ephemeral toasts pushed via uiStore.pushToast.
 * Auto-dismisses each toast after 3.5s. Round-3 R3-6 added this so
 * graph-rejection feedback (cycles, self-loops) and palette feedback
 * have a place to land without each caller wiring its own notification.
 *
 * Position: top-center, fixed, above the React Flow canvas. aria-live so
 * screen readers announce the message.
 */
const TOAST_TIMEOUT_MS = 3500

export function ToastHost() {
  const toasts = useUIStore((s) => s.toasts)
  const dismissToast = useUIStore((s) => s.dismissToast)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) =>
      setTimeout(() => dismissToast(t.id), TOAST_TIMEOUT_MS),
    )
    return () => {
      for (const id of timers) clearTimeout(id)
    }
  }, [toasts, dismissToast])

  if (toasts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-1.5 items-center"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'pointer-events-auto rounded-md border px-3 py-1.5 text-xs shadow-md max-w-[80vw] whitespace-normal',
            t.kind === 'warn'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-neutral-900 border-neutral-800 text-white',
          ].join(' ')}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
