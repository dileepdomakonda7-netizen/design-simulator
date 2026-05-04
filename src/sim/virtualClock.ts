/**
 * Virtual simulation clock. Time-monotonic — moving backward is a bug
 * (almost certainly a behavior scheduled an event in the past). Crash loudly.
 */
export class VirtualClock {
  private current = 0

  now(): number {
    return this.current
  }

  advanceTo(t: number): void {
    if (t < this.current) {
      throw new Error(
        `VirtualClock cannot move backward: now=${this.current}, requested=${t}`,
      )
    }
    this.current = t
  }
}
