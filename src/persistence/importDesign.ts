import type { Design } from '@/schema/types'
import { validateDesignStrict } from '@/schema/validators'

export async function importDesignFromFile(file: File): Promise<Design> {
  const text = await file.text()
  // JSON.parse throws on invalid JSON — caller must catch
  const parsed: unknown = JSON.parse(text)

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>)['schemaVersion'] !== 1
  ) {
    throw new Error(
      `Unsupported schema version: ${String((parsed as Record<string, unknown>)?.['schemaVersion'])}. Only schemaVersion 1 is supported.`,
    )
  }

  // validateDesignStrict throws a ZodError on failure
  return validateDesignStrict(parsed)
}
