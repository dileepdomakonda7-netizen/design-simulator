import type { Design } from '@/schema/types'
import { validateDesignStrict } from '@/schema/validators'

// v1: passthrough. Add migration functions here when schemaVersion increments.
// Pattern: check raw.schemaVersion, run transformations, bump to next version, repeat.
export function migrateToCurrent(raw: unknown): Design {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid design: expected an object')
  }
  const version = (raw as Record<string, unknown>)['schemaVersion']
  if (version !== 1) {
    throw new Error(
      `Cannot migrate from schemaVersion ${String(version)} — only v1 is supported`,
    )
  }
  return validateDesignStrict(raw)
}
