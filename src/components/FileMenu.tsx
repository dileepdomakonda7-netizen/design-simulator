import { useState, useEffect, useRef } from 'react'
import { useDesignStore } from '@/store/designStore'
import { exportDesignToFile } from '@/persistence/exportDesign'
import { importDesignFromFile } from '@/persistence/importDesign'
import { LoadDialog } from './LoadDialog'

export function FileMenu() {
  const [open, setOpen] = useState(false)
  const [showLoad, setShowLoad] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const design = useDesignStore((s) => s.design)
  const newDesign = useDesignStore((s) => s.newDesign)
  const loadDesign = useDesignStore((s) => s.loadDesign)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Element)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function close() {
    setOpen(false)
  }

  async function handleImport() {
    close()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const imported = await importDesignFromFile(file)
        loadDesign(imported)
      } catch (err) {
        alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    })
    input.click()
  }

  const itemClass =
    'w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-700"
      >
        File ▾
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-20 min-w-40">
          <button
            className={itemClass}
            onClick={() => {
              newDesign()
              close()
            }}
          >
            New Design
          </button>
          <button
            className={itemClass}
            onClick={() => {
              setShowLoad(true)
              close()
            }}
          >
            Load Design…
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            className={itemClass}
            onClick={() => {
              exportDesignToFile(design)
              close()
            }}
          >
            Export JSON
          </button>
          <button className={itemClass} onClick={handleImport}>
            Import JSON…
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button className={itemClass} disabled title="Available in Prompt 5">
            Import Image… (coming soon)
          </button>
        </div>
      )}

      {showLoad && <LoadDialog onClose={() => setShowLoad(false)} />}
    </div>
  )
}
