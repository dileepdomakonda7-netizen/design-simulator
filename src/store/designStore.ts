import { create } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import type {
  Node,
  Edge,
  EdgeKind,
  Annotation,
  Sketch,
  Viewport,
  Design,
  ComponentType,
} from '@/schema/types'
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

  // Node operations
  addNode: (node: Node) => void

  /**
   * Position-only update — no type narrowing required because position
   * is type-independent. Called by React Flow on drag-end.
   */
  updateNodePosition: (id: string, position: { x: number; y: number }) => void

  /**
   * Label/notes update — type-independent fields, no narrowing required.
   */
  updateNodeMeta: (id: string, patch: { label?: string; notes?: string }) => void

  /**
   * Type-narrowed params update. Caller passes `type` as proof of expected
   * variant; the function throws on mismatch and TypeScript narrows
   * `patch` to the correct params shape at the call site.
   */
  updateNodeParams: <T extends ComponentType>(
    id: string,
    type: T,
    patch: Partial<Extract<Node, { type: T }>['params']>,
  ) => void

  /**
   * @deprecated prefer updateNodePosition / updateNodeMeta / updateNodeParams.
   * Kept for backward compatibility; uses an internal `as Node` cast that
   * cannot be proven type-safe through Partial<Omit<Node, 'id'>>.
   */
  updateNode: (id: string, patch: Partial<Omit<Node, 'id'>>) => void

  removeNode: (id: string) => void

  // Edge operations
  addEdge: (edge: Edge) => void
  updateEdgeMeta: (id: string, patch: { kind?: EdgeKind; label?: string }) => void
  updateEdgeParams: (id: string, patch: Partial<Edge['params']>) => void

  /**
   * @deprecated prefer updateEdgeMeta / updateEdgeParams.
   */
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

// Type predicate enables narrowing via `if (isNodeOfType(n, type))` in updateNodeParams
// — no `as Node` cast needed inside the narrowed branch.
function isNodeOfType<T extends ComponentType>(
  node: Node,
  type: T,
): node is Extract<Node, { type: T }> {
  return node.type === type
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
      // history — by that point useDesignStore is guaranteed defined since actions
      // only run after module initialization completes.
      loadDesign: (design) => {
        set({ design })
        queueMicrotask(() => useDesignStore.temporal.getState().clear())
      },

      newDesign: () => {
        set({ design: createDefaultDesign() })
        queueMicrotask(() => useDesignStore.temporal.getState().clear())
      },

      renameDesign: (name) => set((s) => ({ design: touch({ ...s.design, name }) })),

      updateViewport: (viewport) => set((s) => ({ design: { ...s.design, viewport } })),
      // viewport changes are not tracked in undo history (purely cosmetic).
      // The temporal partialize below excludes the action functions; viewport changes
      // do still hit history because they go through `design`. We accept a viewport
      // entry per pan/zoom — the 250ms debounce in DesignCanvas keeps it reasonable.

      addNode: (node) =>
        set((s) => ({
          design: touch({ ...s.design, nodes: [...s.design.nodes, node] }),
        })),

      updateNodePosition: (id, position) =>
        set((s) => ({
          design: touch({
            ...s.design,
            nodes: s.design.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
          }),
        })),

      updateNodeMeta: (id, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
            nodes: s.design.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
          }),
        })),

      updateNodeParams: (id, type, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
            nodes: s.design.nodes.map((n) => {
              if (n.id !== id) return n
              if (!isNodeOfType(n, type)) {
                throw new Error(
                  `updateNodeParams: node ${id} has type "${n.type}", expected "${type}"`,
                )
              }
              // Inside this branch n is narrowed to Extract<Node, { type: T }>,
              // so n.params and patch share the same shape — no cast needed.
              return { ...n, params: { ...n.params, ...patch } }
            }),
          }),
        })),

      // Legacy: kept for source compatibility; internal cast is unavoidable here.
      updateNode: (id, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
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

      updateEdgeMeta: (id, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
            edges: s.design.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          }),
        })),

      updateEdgeParams: (id, patch) =>
        set((s) => ({
          design: touch({
            ...s.design,
            edges: s.design.edges.map((e) =>
              e.id === id ? { ...e, params: { ...e.params, ...patch } } : e,
            ),
          }),
        })),

      // Legacy
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

      clearSketches: () => set((s) => ({ design: touch({ ...s.design, sketches: [] }) })),
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
