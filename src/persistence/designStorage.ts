import type { Design } from '@/schema/types'
import { validateDesign } from '@/schema/validators'

const PREFIX = 'design:'
const INDEX_KEY = 'designs_index'

export interface DesignsIndexEntry {
  id: string
  name: string
  updatedAt: string
}

export function saveDesign(design: Design): void {
  try {
    localStorage.setItem(`${PREFIX}${design.id}`, JSON.stringify(design))
    upsertIndex({ id: design.id, name: design.name, updatedAt: design.updatedAt })
  } catch (err) {
    console.error('[designStorage] Failed to save design:', err)
  }
}

function upsertIndex(entry: DesignsIndexEntry): void {
  try {
    const current = listDesigns().filter((e) => e.id !== entry.id)
    const updated = [entry, ...current].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    localStorage.setItem(INDEX_KEY, JSON.stringify(updated))
  } catch (err) {
    console.error('[designStorage] Failed to update index:', err)
  }
}

export function loadDesignById(id: string): Design | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${id}`)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const result = validateDesign(parsed)
    if (!result.ok) {
      console.error('[designStorage] Corrupt design in localStorage:', result.error.message)
      return null
    }
    return result.design
  } catch (err) {
    console.error('[designStorage] Failed to load design:', err)
    return null
  }
}

export function deleteDesign(id: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${id}`)
    const updated = listDesigns().filter((e) => e.id !== id)
    localStorage.setItem(INDEX_KEY, JSON.stringify(updated))
  } catch (err) {
    console.error('[designStorage] Failed to delete design:', err)
  }
}

export function listDesigns(): DesignsIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (raw === null) return []
    return JSON.parse(raw) as DesignsIndexEntry[]
  } catch {
    return []
  }
}
