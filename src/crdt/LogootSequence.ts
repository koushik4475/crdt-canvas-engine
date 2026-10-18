import { Position, START_POS, END_POS, comparePositions, allocatePositionBetween } from './LogootPosition';

export interface CRDTAtom<T> {
  readonly position: Position;
  readonly value: T;
  readonly siteId: string;
  readonly clock: number;
  readonly isDeleted: boolean;
  readonly timestamp: number;
}

export type CRDTOperation<T> =
  | {
      type: 'insert';
      position: Position;
      value: T;
      siteId: string;
      clock: number;
      timestamp: number;
    }
  | {
      type: 'delete';
      position: Position;
      siteId: string;
      clock: number;
      timestamp: number;
    };

/**
 * Text CRDT using Logoot total-ordering sequence model.
 * Guarantees strong eventual consistency under arbitrary reordering and network partitions.
 */
export class LogootSequence<T = string> {
  private atoms: CRDTAtom<T>[] = [];
  public readonly siteId: string;
  private localClock: number = 0;

  constructor(siteId: string) {
    this.siteId = siteId;
  }

  public getClock(): number {
    return this.localClock;
  }

  public advanceClock(): number {
    return ++this.localClock;
  }

  public getAtoms(): ReadonlyArray<CRDTAtom<T>> {
    return this.atoms;
  }

  public getVisibleAtoms(): CRDTAtom<T>[] {
    return this.atoms.filter(a => !a.isDeleted);
  }

  public length(): number {
    return this.getVisibleAtoms().length;
  }

  /**
   * Find index in atoms array for a given position using binary search.
   */
  public findAtomIndex(pos: Position): { found: boolean; index: number } {
    let low = 0;
    let high = this.atoms.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cmp = comparePositions(this.atoms[mid].position, pos);

      if (cmp === 0) {
        return { found: true, index: mid };
      } else if (cmp < 0) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return { found: false, index: low };
  }

  /**
   * Insert item at zero-based visible index.
   * Returns generated CRDTOperation to broadcast.
   */
  public insertAt(visibleIndex: number, value: T): CRDTOperation<T> {
    const visible = this.getVisibleAtoms();
    if (visibleIndex < 0 || visibleIndex > visible.length) {
      throw new RangeError(`Visible index ${visibleIndex} out of bounds [0, ${visible.length}]`);
    }

    const prevPos = visibleIndex === 0 ? START_POS : visible[visibleIndex - 1].position;
    const nextPos = visibleIndex === visible.length ? END_POS : visible[visibleIndex].position;

    const clock = this.advanceClock();
    const position = allocatePositionBetween(prevPos, nextPos, this.siteId, clock);
    const op: CRDTOperation<T> = {
      type: 'insert',
      position,
      value,
      siteId: this.siteId,
      clock,
      timestamp: Date.now()
    };

    this.apply(op);
    return op;
  }

  /**
   * Delete item at zero-based visible index.
   * Returns generated CRDTOperation to broadcast.
   */
  public deleteAt(visibleIndex: number): CRDTOperation<T> {
    const visible = this.getVisibleAtoms();
    if (visibleIndex < 0 || visibleIndex >= visible.length) {
      throw new RangeError(`Visible index ${visibleIndex} out of bounds [0, ${visible.length - 1}]`);
    }

    const target = visible[visibleIndex];
    const clock = this.advanceClock();
    const op: CRDTOperation<T> = {
      type: 'delete',
      position: target.position,
      siteId: this.siteId,
      clock,
      timestamp: Date.now()
    };

    this.apply(op);
    return op;
  }

  /**
   * Apply an incoming operation (local or remote). Idempotent and commutative.
   */
  public apply(op: CRDTOperation<T>): boolean {
    if (op.clock > this.localClock) {
      this.localClock = op.clock;
    }

    const { found, index } = this.findAtomIndex(op.position);

    if (op.type === 'insert') {
      if (found) {
        // Already exists; check if tombstoned or duplicate op
        return false;
      }
      const atom: CRDTAtom<T> = {
        position: op.position,
        value: op.value,
        siteId: op.siteId,
        clock: op.clock,
        isDeleted: false,
        timestamp: op.timestamp
      };
      this.atoms.splice(index, 0, atom);
      return true;
    } else if (op.type === 'delete') {
      if (found) {
        if (!this.atoms[index].isDeleted) {
          const old = this.atoms[index];
          this.atoms[index] = {
            ...old,
            isDeleted: true
          };
          return true;
        }
        return false;
      } else {
        // Tombstone inserted for out-of-order delete
        const atom: CRDTAtom<T> = {
          position: op.position,
          value: null as unknown as T,
          siteId: op.siteId,
          clock: op.clock,
          isDeleted: true,
          timestamp: op.timestamp
        };
        this.atoms.splice(index, 0, atom);
        return true;
      }
    }
    return false;
  }

  /**
   * Serialize entire sequence to array of values.
   */
  public toArray(): T[] {
    return this.getVisibleAtoms().map(a => a.value);
  }

  /**
   * Serialize visible text representation.
   */
  public toString(): string {
    return this.toArray().join('');
  }

  /**
   * Dump state for state-based replication.
   */
  public getState(): CRDTAtom<T>[] {
    return JSON.parse(JSON.stringify(this.atoms));
  }

  /**
   * Merge complete state snapshot from remote peer.
   */
  public mergeState(remoteAtoms: CRDTAtom<T>[]): void {
    for (const remoteAtom of remoteAtoms) {
      const { found, index } = this.findAtomIndex(remoteAtom.position);
      if (!found) {
        this.atoms.splice(index, 0, { ...remoteAtom });
      } else {
        // If remote is deleted, local becomes deleted (tombstone dominance)
        if (remoteAtom.isDeleted && !this.atoms[index].isDeleted) {
          this.atoms[index] = {
            ...this.atoms[index],
            isDeleted: true
          };
        }
      }
    }
  }
}
