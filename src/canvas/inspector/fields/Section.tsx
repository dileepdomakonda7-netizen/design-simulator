import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

export function Section({ title, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-t border-neutral-100 first:border-t-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-500 hover:bg-neutral-50"
      >
        <span>{title}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-1.5">{children}</div>}
    </section>
  )
}
