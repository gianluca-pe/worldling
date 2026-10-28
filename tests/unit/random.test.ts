import { describe, expect, it } from "vitest";
import { SeededRandom } from "../../src/sim/random";

describe("SeededRandom", () => {
  it("repeats the same sequence for the same seed", () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);

    const values = Array.from({ length: 100 }, () => first.nextUint32());
    expect(values).toEqual(
      Array.from({ length: 100 }, () => second.nextUint32()),
    );
  });

  it("produces unsigned 32-bit values and advances its state", () => {
    const random = new SeededRandom(42);
    const initialState = random.snapshot();
    const values = Array.from({ length: 100 }, () => random.nextUint32());

    expect(random.snapshot()).not.toBe(initialState);
    expect(new Set(values).size).toBeGreaterThan(95);
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xff_ff_ff_ff);
    }
  });

  it("rejects invalid seeds", () => {
    expect(() => new SeededRandom(-1)).toThrow(RangeError);
    expect(() => new SeededRandom(1.5)).toThrow(RangeError);
    expect(() => new SeededRandom(0x1_00_00_00_00)).toThrow(RangeError);
  });
});
