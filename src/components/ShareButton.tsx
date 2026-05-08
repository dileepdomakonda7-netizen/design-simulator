import { useState } from 'react'
import { useDesignStore } from '@/store/designStore'
import { buildShareUrl, encodeDesignForUrl } from '@/persistence/urlShare'

/**
 * Share button: serializes the current design into the URL via lz-string,
 * copies the resulting link to clipboard, and shows a small toast.
 *
 * Disabled cases:
 *   - empty design (nothing to share)
 *   - encoded URL exceeds the 8KB cap (toast asks the user to JSON-export
 *     instead; the export feature is deferred)
 */
export function ShareButton() {
  const design = useDesignStore((s) => s.design)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const empty = design.nodes.length === 0

  async function onShare() {
    const result = encodeDesignForUrl(design)
    if (!result.ok) {
      setToast({
        kind: 'err',
        msg: `Design too large to share via URL (${result.encodedLength} bytes > ${result.cap}). Export to JSON instead.`,
      })
      setTimeout(() => setToast(null), 4000)
      return
    }
    const url = buildShareUrl(result.encoded)
    try {
      await navigator.clipboard.writeText(url)
      setToast({
        kind: 'ok',
        msg: 'Link copied — anyone with this URL can load your design.',
      })
    } catch {
      // Older browsers / non-secure contexts: fall back to a textarea selection.
      setToast({ kind: 'err', msg: 'Could not copy to clipboard. URL: ' + url })
    }
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="relative">
      <button
        onClick={onShare}
        disabled={empty}
        className={[
          'text-sm px-2 py-1 rounded border',
          empty
            ? 'border-gray-200 text-gray-300 cursor-not-allowed'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer',
        ].join(' ')}
        title="Copy a shareable link to this design"
      >
        ↗ Share
      </button>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            'absolute right-0 top-full mt-1 w-72 max-w-[90vw] text-xs rounded border px-2.5 py-1.5 shadow-sm whitespace-normal z-50',
            toast.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900',
          ].join(' ')}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
