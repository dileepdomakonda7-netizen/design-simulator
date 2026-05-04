import { create } from 'zustand'

export type Mode = 'build' | 'sketch' | 'simulate'

interface ModeState {
  mode: Mode
  setMode: (mode: Mode) => void
}

export const useModeStore = create<ModeState>()((set) => ({
  mode: 'build', // default per SPEC Section 4
  setMode: (mode) => set({ mode }),
}))
