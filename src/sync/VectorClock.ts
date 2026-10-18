/**
 * Vector Clock for tracking causal history across distributed peers.
 */
export class VectorClock {
  private clock: Map<string, number>;

  constructor(initial?: Record<string, number> | Map<string, number>) {
    this.clock = new Map();
    if (initial) {
      if (initial instanceof Map) {
        for (const [k, v] of initial.entries()) {
          this.clock.set(k, v);
        }
      } else {
        for (const [k, v] of Object.entries(initial)) {
          this.clock.set(k, v);
        }
      }
    }
  }

  public get(siteId: string): number {
    return this.clock.get(siteId) || 0;
  }

  public increment(siteId: string): number {
    const current = this.get(siteId);
    const next = current + 1;
    this.clock.set(siteId, next);
    return next;
  }

  public set(siteId: string, val: number): void {
    this.clock.set(siteId, val);
  }

  /**
   * Merge with another vector clock by taking pairwise maximum.
   */
  public merge(other: VectorClock): void {
    for (const [siteId, value] of other.clock.entries()) {
      const cur = this.get(siteId);
      if (value > cur) {
        this.clock.set(siteId, value);
      }
    }
  }

  /**
   * Compare two vector clocks:
   * Returns:
   * - -1 if `this` happened-before `other` (this < other)
   * -  1 if `other` happened-before `this` (this > other)
   * -  0 if `this` equals `other` (this == other)
   * -  null if `this` and `other` are concurrent (conflict)
   */
  public compare(other: VectorClock): -1 | 0 | 1 | null {
    let thisStrictlyGreater = false;
    let otherStrictlyGreater = false;

    const allKeys = new Set([...this.clock.keys(), ...other.clock.keys()]);

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = other.get(key);

      if (v1 > v2) {
        thisStrictlyGreater = true;
      } else if (v1 < v2) {
        otherStrictlyGreater = true;
      }

      if (thisStrictlyGreater && otherStrictlyGreater) {
        return null; // Concurrent
      }
    }

    if (!thisStrictlyGreater && !otherStrictlyGreater) {
      return 0; // Equal
    }
    if (thisStrictlyGreater && !otherStrictlyGreater) {
      return 1;
    }
    return -1;
  }

  public toJSON(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [k, v] of this.clock.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public clone(): VectorClock {
    return new VectorClock(this.clock);
  }

  public static fromJSON(json: Record<string, number>): VectorClock {
    return new VectorClock(json);
  }
}
