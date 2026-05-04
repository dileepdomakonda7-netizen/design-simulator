// djb2: tiny stable string→int hash. Used as a per-node rough.js seed so the
// sketchy strokes look stable across re-renders (no shimmer during drag).
export function hashCode(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  // rough.js wants a non-negative integer for `seed`
  return Math.abs(h)
}
