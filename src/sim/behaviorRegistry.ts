import type { ComponentType } from '@/schema/types'
import type { SimEventKind } from './types'
import type { Behavior } from './behaviors/types'

/**
 * In-memory registry mapping (componentType, eventKind) → behavior.
 *
 * The 'echo' synthetic type is used only by the 4a debug page; 4b will populate
 * the real ComponentType keys and remove 'echo'. The map-of-maps shape is small
 * enough to swap for a class-based registry later without rippling changes.
 */
type DispatchType = ComponentType | 'echo'

const registry = new Map<DispatchType, Map<SimEventKind, Behavior>>()

export function registerBehavior(
  type: DispatchType,
  kind: SimEventKind,
  behavior: Behavior,
): void {
  let byKind = registry.get(type)
  if (!byKind) {
    byKind = new Map()
    registry.set(type, byKind)
  }
  byKind.set(kind, behavior)
}

export function getBehavior(
  type: DispatchType,
  kind: SimEventKind,
): Behavior | undefined {
  return registry.get(type)?.get(kind)
}
