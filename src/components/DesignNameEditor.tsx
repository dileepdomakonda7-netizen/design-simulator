import { useState, useEffect } from 'react'
import { useDesignStore } from '@/store/designStore'

export function DesignNameEditor() {
  const name = useDesignStore((s) => s.design.name)
  const renameDesign = useDesignStore((s) => s.renameDesign)
  const [localName, setLocalName] = useState(name)

  // Sync local state when external design changes (e.g. load, undo)
  useEffect(() => {
    setLocalName(name)
  }, [name])

  function commit() {
    const trimmed = localName.trim()
    if (trimmed === '') {
      setLocalName(name) // revert to last saved name
      return
    }
    if (trimmed !== name) {
      renameDesign(trimmed)
    }
  }

  return (
    <input
      type="text"
      value={localName}
      onChange={(e) => setLocalName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setLocalName(name)
          e.currentTarget.blur()
        }
      }}
      size={Math.max(16, localName.length + 2)}
      className="text-sm font-medium text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-gray-500 focus:outline-none px-1 py-0.5 min-w-32 max-w-96 text-ellipsis"
      aria-label="Design name"
    />
  )
}
