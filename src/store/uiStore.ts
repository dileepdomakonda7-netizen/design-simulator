import { create } from 'zustand'

export type PenTool = 'off' | 'pen' | 'eraser'

interface UIState {
  paletteCollapsed: boolean
  togglePaletteCollapsed: () => void

  inspectorCollapsed: boolean
  toggleInspectorCollapsed: () => void

  penTool: PenTool
  setPenTool: (tool: PenTool) => void
}

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
}))
