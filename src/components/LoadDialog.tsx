import { useState } from 'react'
import { listDesigns, loadDesignById, deleteDesign, type DesignsIndexEntry } from '@/persistence/designStorage'
import { useDesignStore } from '@/store/designStore'

interface Props {
  onClose: () => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function LoadDialog({ onClose }: Props) {
  const [entries, setEntries] = useState<DesignsIndexEntry[]>(listDesigns)
  const loadDesign = useDesignStore((s) => s.loadDesign)

  function handleLoad(id: string) {
    const design = loadDesignById(id)
    if (design) {
      loadDesign(design)
      onClose()
    } else {
      alert('Failed to load design — it may be corrupted.')
    }
  }

  function handleDelete(id: string) {
    deleteDesign(id)
    setEntries(listDesigns())
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onMouseDown={onClose}
    >
      {/* Panel — stop propagation so clicking inside doesn't close */}
      <div
        className="bg-white rounded-lg shadow-xl w-96 max-h-[70vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-gray-800">Load Design</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No saved designs.</p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 px-4 py-2.5 border-b last:border-0 hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{entry.name}</p>
                    <p className="text-xs text-gray-400">{formatDate(entry.updatedAt)}</p>
                  </div>
                  <button
                    onClick={() => handleLoad(entry.id)}
                    className="text-xs px-2 py-1 rounded bg-gray-900 text-white hover:bg-gray-700"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
