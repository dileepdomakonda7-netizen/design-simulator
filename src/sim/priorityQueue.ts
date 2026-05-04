import type { SimEvent } from './types'

/**
 * Min-heap event queue keyed by `at` (virtual time), with `id` as deterministic
 * tiebreaker. Lower `at` first; for same `at`, lower `id` (i.e. first scheduled
 * fires first). Tiebreaking is mandatory for reproducible runs across executions.
 *
 * Standard array-backed binary heap with parent = (i-1)>>1, children = 2i+1, 2i+2.
 */
export class EventQueue {
  private heap: SimEvent[] = []

  size(): number {
    return this.heap.length
  }

  peek(): SimEvent | undefined {
    return this.heap[0]
  }

  push(event: SimEvent): void {
    this.heap.push(event)
    this.siftUp(this.heap.length - 1)
  }

  pop(): SimEvent | undefined {
    const n = this.heap.length
    if (n === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()!
    if (n > 1) {
      this.heap[0] = last
      this.siftDown(0)
    }
    return top
  }

  private less(a: SimEvent, b: SimEvent): boolean {
    if (a.at !== b.at) return a.at < b.at
    return a.id < b.id
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.less(this.heap[i]!, this.heap[parent]!)) {
        ;[this.heap[i], this.heap[parent]] = [this.heap[parent]!, this.heap[i]!]
        i = parent
      } else break
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length
    while (true) {
      const l = 2 * i + 1
      const r = 2 * i + 2
      let smallest = i
      if (l < n && this.less(this.heap[l]!, this.heap[smallest]!)) smallest = l
      if (r < n && this.less(this.heap[r]!, this.heap[smallest]!)) smallest = r
      if (smallest === i) break
      ;[this.heap[i], this.heap[smallest]] = [this.heap[smallest]!, this.heap[i]!]
      i = smallest
    }
  }
}

/**
 * Test-only: returns true iff the array satisfies the min-heap property.
 * Linear scan over the array; not used in production paths.
 */
export function isHeapValid(arr: readonly SimEvent[]): boolean {
  const less = (a: SimEvent, b: SimEvent): boolean =>
    a.at !== b.at ? a.at < b.at : a.id < b.id
  for (let i = 0; i < arr.length; i++) {
    const l = 2 * i + 1
    const r = 2 * i + 2
    if (l < arr.length && less(arr[l]!, arr[i]!)) return false
    if (r < arr.length && less(arr[r]!, arr[i]!)) return false
  }
  return true
}
