import { create } from 'zustand'

// Stub for Phase 3. Shape will be expanded when the simulation engine is wired up.
interface SimState {
  isRunning: boolean
}

export const useSimStore = create<SimState>()(() => ({
  isRunning: false,
}))
