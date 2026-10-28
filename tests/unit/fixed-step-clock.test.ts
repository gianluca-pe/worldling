import { describe, expect, it, vi } from "vitest";
import { FixedStepClock } from "../../src/app/fixed-step-clock";

describe("FixedStepClock", () => {
  it("uses the first frame as a baseline and advances fixed ticks", () => {
    const step = vi.fn();
    const clock = new FixedStepClock(50);
    expect(clock.advance(1000, step)).toBe(0);
    expect(clock.advance(1060, step)).toBe(1);
    expect(clock.advance(1160, step)).toBe(2);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it("bounds a long frame and discards excess backlog", () => {
    const step = vi.fn();
    const clock = new FixedStepClock(50);
    clock.advance(0, step);
    expect(clock.advance(60_000, step)).toBe(5);
    expect(clock.advance(60_010, step)).toBe(0);
    expect(step).toHaveBeenCalledTimes(5);
  });

  it("does not burst after a lifecycle reset", () => {
    const step = vi.fn();
    const clock = new FixedStepClock(50);
    clock.advance(0, step);
    clock.reset();
    expect(clock.advance(60_000, step)).toBe(0);
    expect(clock.advance(60_050, step)).toBe(1);
    expect(step).toHaveBeenCalledTimes(1);
  });
});
