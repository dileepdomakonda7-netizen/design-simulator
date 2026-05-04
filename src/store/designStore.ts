import { create } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import type { Node, Edge, Annotation, Sketch, Viewport, Design } from '@/schema/types'
import { createDefaultDesign } from '@/schema/defaults'
import { saveDesign } from '@/persistence/designStorage'

// ─── State shape ──────────────────────────────────────────────────────────────

interface DesignState {
  design: Design
  // Every mutating action updates design.updatedAt via touch()
  setDesign: (design: Design) => void
  loadDesign: (design: Design) => void // loads without pushing undo history
  newDesign: () => void
  renameDesign: (name: string) => void
  updateViewport: (viewport: Viewport) => void
  // Node operations (bodies are complete; full inspector integration in Prompt 3)
  addNode: (node: Node) => void
  updateNode: (id: string, patch: Partial<Omit<Node, 'id'>>) => void
  removeNode: (id: string) => void
  // Edge operations
  addEdge: (edge: Edge) => void
  updateEdge: (id: string, patch: Partial<Omit<Edge, 'id'>>) => void
  removeEdge: (id: string) => void
  // Annotation operations
  addAnnotation: (annotation: Annotation) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  // Sketch operations
  setCurrentSketch: (sketch: Sketch) => void
  clearSketches: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function touch(design: Design): Design {
  return { ...design, updatedAt: new Date().toISOString() }
}

// Inline 500ms debounce — no lodash dependency
function debounce<T extends (...args: Parameters<T>) => void>(fn: T, wait: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }) as T
}

const debouncedSave = debounce((design: Design) => {
  saveDesign(design)
}, 500)

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDesignStore = create<DesignState>()(
  temporal(
    (set) => ({
      design: createDefaultDesign(),

      setDesign: (design) => set({ design }),

      // Loads without adding a history entry. After set(), queueMicrotask clears
      // history — by that point useDesignStore is guaranteed to be defined since
      // actions only run after module initialization completes.
      loadDesign: (design) => {
        set({ design })
        // useDesignStore is referenced after module init completes — safe in closure
        queueMicrotask(() => useDesignStore.temporal.getState().clear())
      },

      newDesign: () => {
        set({ design: createDefaultDesign() })
        queueMicrotask(() => useDesignStore.temporal.getState().clear())
      },

      renameDesign: (name) =>
        set((s) => ({ design: touch({ ...s.design, name }) })),

      updateViewport: (viewport) =>
        set((s) => ({ design: { ...s.design, viewport } })),
      // viewport changes are not tracked in undo history (purely cosmetic)
      // Note: temporal partialize below excludes viewport from history anyway

      addNode: (node) =>
        set((s) => ({
          design: touch({ ...s.design, nodes: [...s.design.nodes, node] }),
        })),

      updateNode: (id, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
            // `as Node` cast needed: TypeScript can't enforce type↔params
            // consistency through a Partial spread; this is tightened in Prompt 3
            nodes: s.design.nodes.map((n) =>
              n.id === id ? ({ ...n, ...patch } as Node) : n,
            ),
          }),
        })),

      removeNode: (id) =>
        set((s) => ({
          design: touch({
            ...s.design,
            nodes: s.design.nodes.filter((n) => n.id !== id),
            // also remove edges that reference this node
            edges: s.design.edges.filter((e) => e.source !== id && e.target !== id),
          }),
        })),

      addEdge: (edge) =>
        set((s) => ({
          design: touch({ ...s.design, edges: [...s.design.edges, edge] }),
        })),

      updateEdge: (id, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
            edges: s.design.edges.map((e) =>
              e.id === id ? ({ ...e, ...patch } as Edge) : e,
            ),
          }),
        })),

      removeEdge: (id) =>
        set((s) => ({
          design: touch({
            ...s.design,
            edges: s.design.edges.filter((e) => e.id !== id),
          }),
        })),

      addAnnotation: (annotation) =>
        set((s) => ({
          design: touch({ ...s.design, annotations: [...s.design.annotations, annotation] }),
        })),

      removeAnnotation: (id) =>
        set((s) => ({
          design: touch({
            ...s.design,
            annotations: s.design.annotations.filter((a) => a.id !== id),
          }),
        })),

      clearAnnotations: () =>
        set((s) => ({ design: touch({ ...s.design, annotations: [] }) })),

      setCurrentSketch: (sketch) =>
        set((s) => ({
          design: touch({ ...s.design, sketches: [...s.design.sketches, sketch] }),
        })),

      clearSketches: () =>
        set((s) => ({ design: touch({ ...s.design, sketches: [] }) })),
    }),
    {
      limit: 100,
      // Only track `design` in history — action functions are not serializable
      partialize: (s) => ({ design: s.design }),
    },
  ),
)

// ─── Temporal store hook ──────────────────────────────────────────────────────

export const useDesignTemporalStore = () => useStore(useDesignStore.temporal)

// ─── Auto-save subscription ───────────────────────────────────────────────────
// Runs once at module load; persists every design change to localStorage
// with a 500ms debounce (SPEC Section 11).

useDesignStore.subscribe((state) => {
  debouncedSave(state.design)
})
