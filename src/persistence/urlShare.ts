/**
 * URL-sharing for designs (?d=<encoded>).
 *
 * Format: lz-string compressed JSON of a Design, base64-encoded for URL safety.
 * Designs typically compress to 1–3KB; we cap shared URLs at 8KB total so
 * very large designs don't generate links Slack/email/Twitter will silently
 * truncate. Above the cap, the user is prompted to export to JSON instead
 * (file export is a separate feature; v1 just rejects with a clear message).
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Design } from '@/schema/types'
import { validateDesign } from '@/schema/validators'

/** Hard cap on the encoded-design URL fragment length. Practical browser /
 *  CDN limits start mattering above ~8KB. */
const MAX_ENCODED_LENGTH = 8 * 1024

export interface EncodeResult {
  ok: true
  encoded: string
}

export interface EncodeError {
  ok: false
  reason: 'too_large'
  encodedLength: number
  cap: number
}

/** Compress + base64-encode a Design for URL embedding. Returns the encoded
 *  string on success, or an error result on hard size cap. */
export function encodeDesignForUrl(design: Design): EncodeResult | EncodeError {
  const json = JSON.stringify(design)
  const encoded = compressToEncodedURIComponent(json)
  if (encoded.length > MAX_ENCODED_LENGTH) {
    return {
      ok: false,
      reason: 'too_large',
      encodedLength: encoded.length,
      cap: MAX_ENCODED_LENGTH,
    }
  }
  return { ok: true, encoded }
}

export interface DecodeOk {
  ok: true
  design: Design
}

export interface DecodeError {
  ok: false
  reason: 'malformed' | 'invalid_schema'
  detail?: string
}

/** Decode + validate a URL-shared design. Always go through validateDesign —
 *  this is untrusted input from the network. */
export function decodeDesignFromUrl(encoded: string): DecodeOk | DecodeError {
  let json: string | null
  try {
    json = decompressFromEncodedURIComponent(encoded)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!json) return { ok: false, reason: 'malformed' }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return { ok: false, reason: 'malformed', detail: String(e) }
  }
  const result = validateDesign(parsed)
  if (!result.ok) {
    const detail = result.error.issues[0]?.message
    return detail !== undefined
      ? { ok: false, reason: 'invalid_schema', detail }
      : { ok: false, reason: 'invalid_schema' }
  }
  return { ok: true, design: result.design }
}

/** Build the full shareable URL. */
export function buildShareUrl(encoded: string, origin?: string): string {
  const o = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${o}/app?d=${encoded}`
}
