import { VectorClock } from '../src/sync/VectorClock';

describe('VectorClock counter validation', () => {
  test.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid initial counter %s',
    (counter) => {
      expect(() => new VectorClock({ peer: counter })).toThrow(RangeError);
    }
  );

  test('rejects invalid updates and empty site identifiers', () => {
    const clock = new VectorClock();

    expect(() => clock.set('peer', -1)).toThrow(RangeError);
    expect(() => clock.set('peer', 0.25)).toThrow(RangeError);
    expect(() => clock.set('peer', Number.NaN)).toThrow(RangeError);
    expect(() => clock.set('', 1)).toThrow(TypeError);
  });

  test('prevents incrementing beyond the safe integer range', () => {
    const clock = new VectorClock({ peer: Number.MAX_SAFE_INTEGER });

    expect(() => clock.increment('peer')).toThrow(RangeError);
    expect(clock.get('peer')).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('preserves valid zero and positive counters', () => {
    const clock = new VectorClock({ peer: 0 });

    expect(clock.get('peer')).toBe(0);
    expect(clock.increment('peer')).toBe(1);
  });
});


describe('VectorClock JSON serialization', () => {
  test('preserves prototype-named site identifiers as own properties', () => {
    const clock = new VectorClock({ ['__proto__']: 7, constructor: 3 });

    const json = clock.toJSON();
    expect(Object.prototype.hasOwnProperty.call(json, '__proto__')).toBe(true);
    expect(json['__proto__']).toBe(7);
    expect(json.constructor).toBe(3);
    expect(Object.getPrototypeOf(json)).toBe(Object.prototype);

    const restored = VectorClock.fromJSON(JSON.parse(JSON.stringify(clock)));
    expect(restored.get('__proto__')).toBe(7);
    expect(restored.get('constructor')).toBe(3);
  });
});
