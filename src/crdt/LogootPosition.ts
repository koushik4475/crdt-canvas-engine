/**
 * Logoot / LSeq-style Identifier and Position definitions.
 * Provides total ordering over an infinite dense space of position identifiers.
 */

export interface Identifier {
  /** Digit in base Base (e.g. 0 to 65535 or unbounded positive integer) */
  readonly digit: number;
  /** Site ID / Peer UUID / client identifier */
  readonly siteId: string;
  /** Logical clock or clock counter at creation */
  readonly clock: number;
}

export type Position = Identifier[];

/**
 * Compare two identifiers lexicographically:
 * 1. By digit ascending
 * 2. By siteId ascending
 * 3. By clock ascending
 */
export function compareIdentifiers(a: Identifier, b: Identifier): number {
  if (a.digit !== b.digit) {
    return a.digit < b.digit ? -1 : 1;
  }
  if (a.siteId !== b.siteId) {
    return a.siteId < b.siteId ? -1 : 1;
  }
  if (a.clock !== b.clock) {
    return a.clock < b.clock ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two composite positions lexicographically.
 * If prefix is identical, the longer position is greater.
 */
export function comparePositions(pos1: Position, pos2: Position): number {
  const minLen = Math.min(pos1.length, pos2.length);
  for (let i = 0; i < minLen; i++) {
    const cmp = compareIdentifiers(pos1[i], pos2[i]);
    if (cmp !== 0) {
      return cmp;
    }
  }
  if (pos1.length !== pos2.length) {
    return pos1.length < pos2.length ? -1 : 1;
  }
  return 0;
}

/**
 * Check if two positions are structurally identical.
 */
export function positionsEqual(pos1: Position, pos2: Position): boolean {
  return comparePositions(pos1, pos2) === 0;
}

/**
 * Base boundary constants for Logoot positioning.
 */
export const MIN_DIGIT = 0;
export const MAX_DIGIT = 32767;

/**
 * Boundary positions.
 */
export const START_POS: Position = [{ digit: MIN_DIGIT, siteId: '__START__', clock: 0 }];
export const END_POS: Position = [{ digit: MAX_DIGIT, siteId: '__END__', clock: 0 }];

/**
 * Allocates a new position strictly between `prev` and `next`.
 * Utilizes Logoot / LSeq fractional indexing with random walk / midpoint allocation.
 */
export function allocatePositionBetween(
  prev: Position,
  next: Position,
  siteId: string,
  clock: number,
  boundaryStep: number = 10
): Position {
  if (comparePositions(prev, next) >= 0) {
    throw new Error('prev position must be strictly smaller than next position');
  }

  const result: Identifier[] = [];
  let depth = 0;

  while (true) {
    const prevId: Identifier = prev[depth] || { digit: MIN_DIGIT, siteId, clock };
    const nextId: Identifier = next[depth] || { digit: MAX_DIGIT, siteId, clock };

    const diff = nextId.digit - prevId.digit;

    if (diff > 1) {
      // We have room between prevId and nextId at current depth
      const step = Math.min(boundaryStep, Math.floor(diff / 2)) || 1;
      const newDigit = prevId.digit + step;
      result.push({ digit: newDigit, siteId, clock });
      return result;
    } else if (diff === 1) {
      // No integer room at current depth, but prevId is 1 less than nextId.
      // Append prevId and descend into next depth where boundary becomes (prev[depth+1], MAX_DIGIT)
      result.push(prevId);
      const remainingPrev = prev.slice(depth + 1);
      const subNext: Position = [{ digit: MAX_DIGIT, siteId, clock }];
      const subAlloc = allocatePositionBetween(
        remainingPrev.length > 0 ? remainingPrev : [{ digit: MIN_DIGIT, siteId, clock }],
        subNext,
        siteId,
        clock,
        boundaryStep
      );
      return result.concat(subAlloc);
    } else if (diff === 0) {
      if (prevId.siteId === nextId.siteId && prevId.clock === nextId.clock) {
        // Identical identifier at this depth, continue to next level
        result.push(prevId);
        depth++;
      } else {
        // Digits are equal but siteId or clock differ.
        // Follow prevId and add a suffix
        result.push(prevId);
        const remainingPrev = prev.slice(depth + 1);
        const subNext: Position = [{ digit: MAX_DIGIT, siteId, clock }];
        const subAlloc = allocatePositionBetween(
          remainingPrev.length > 0 ? remainingPrev : [{ digit: MIN_DIGIT, siteId, clock }],
          subNext,
          siteId,
          clock,
          boundaryStep
        );
        return result.concat(subAlloc);
      }
    } else {
      // diff < 0 shouldn't happen if comparePositions(prev, next) < 0
      result.push(prevId);
      depth++;
    }
  }
}
