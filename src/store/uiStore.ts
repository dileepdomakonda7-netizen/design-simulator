import { create } from 'zustand'

export type PenTool = 'off' | 'pen' | 'eraser'

export interface ToastMessage {
  id: number
  kind: 'info' | 'warn'
  message: string
}

interface UIState {
  paletteCollapsed: boolean
  togglePaletteCollapsed: () => void

  inspectorCollapsed: boolean
  toggleInspectorCollapsed: () => void

  penTool: PenTool
  setPenTool: (tool: PenTool) => void

  // Round-3 R3-6: ephemeral toasts so we can surface "this connection
  // would create a cycle" without baking a notification primitive into
  // every component that needs to fail loudly. ToastHost subscribes and
  // auto-clears after a delay.
  toasts: ToastMessage[]
  pushToast: (kind: ToastMessage['kind'], message: string) => void
  dismissToast: (id: number) => void
}

let nextToastId = 1

// Transient UI state — NOT persisted to localStorage, NOT in undo history.
export const useUIStore = create<UIState>()((set) => ({
  paletteCollapsed: false,
  togglePaletteCollapsed: () =>
    set((s) => ({ paletteCollapsed: !s.paletteCollapsed })),

  inspectorCollapsed: false,
  toggleInspectorCollapsed: () =>
    set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),

  penTool: 'off',
  setPenTool: (penTool) => set({ penTool }),

  toasts: [],
  pushToast: (kind, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: nextToastId++, kind, message }],
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
