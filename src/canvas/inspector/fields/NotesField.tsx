import { useEffect, useRef, useState } from 'react'
import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'

export function NotesField({ node }: { node: Node }) {
  const updateNodeMeta = useDesignStore((s) => s.updateNodeMeta)
  const [local, setLocal] = useState(node.notes)
  const lastRef = useRef(node.notes)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (node.notes !== lastRef.current) {
      lastRef.current = node.notes
      setLocal(node.notes)
    }
  }, [node.notes])

  function commit(v: string) {
    if (v !== lastRef.current) {
      lastRef.current = v
      updateNodeMeta(node.id, { notes: v })
    }
  }

  function handleChange(v: string) {
    setLocal(v)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      commit(v)
    }, 400)
  }

  function flush() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    commit(local)
  }

  return (
    <textarea
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={flush}
      placeholder="Notes — free text, not used by simulator"
      rows={3}
      className="w-full text-xs border border-neutral-300 rounded px-1.5 py-1 resize-y placeholder:text-neutral-400"
    />
  )
}
