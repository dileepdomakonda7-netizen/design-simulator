/**
 * mulberry32: a small, fast, decent-quality 32-bit PRNG.
 * Returns a function that yields uniform [0, 1) values.
 *
 * The returned generator carries its own state — two `mulberry32(42)` calls
 * produce two independent generators with the same sequence, not a shared one.
 *
 * Reference: https://stackoverflow.com/a/47593316
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * fnv1a32: 32-bit FNV-1a hash of a UTF-8 string.
 * Used to derive sub-stream seeds from string ids.
 */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * Derives a deterministic sub-stream PRNG from the global seed and a string id.
 * Each (globalSeed, streamId) pair produces an independent stream that doesn't
 * couple to the order in which behaviors are invoked.
 *
 *   const rng = subStream(42, 'node:abc')
 *   const x = rng()  // [0, 1)
 */
export function subStream(globalSeed: number, streamId: string): () => number {
  return mulberry32((globalSeed ^ fnv1a32(streamId)) >>> 0)
}

// Standard-normal z-score for 0.99 (used to back-out sigma from the p99 percentile).
const Z_99 = 2.326

/**
 * Sample from a log-normal distribution given desired p50 and p99 latency in ms.
 *
 * Why log-normal: real service latency is well-modeled by a heavy right tail.
 * Log-normal captures this with two parameters that are also the two percentiles
 * users intuitively know — p50 (median) and p99. Given p50 and p99:
 *
 *   mu    = ln(p50)                       since the median of a log-normal is e^mu
 *   sigma = (ln(p99) - mu) / Z_99         since p99 = e^(mu + Z_99 * sigma)
 *
 * Then sample X = exp(mu + sigma * Z) where Z is a standard-normal variate
 * derived via the Box-Muller transform from two uniform PRNG draws.
 *
 * Edge case: if p99 <= p50, treat as deterministic (no spread) and return p50.
 */
export function sampleLogNormal(rng: () => number, p50Ms: number, p99Ms: number): number {
  if (!isFinite(p50Ms) || p50Ms <= 0) return 0
  if (p99Ms <= p50Ms) return p50Ms
  const mu = Math.log(p50Ms)
  const sigma = (Math.log(p99Ms) - mu) / Z_99
  // Box-Muller: turn two uniforms into one standard-normal sample.
  // Avoid u1 = 0 which would log to -Infinity.
  const u1 = Math.max(rng(), Number.EPSILON)
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.exp(mu + sigma * z)
}
