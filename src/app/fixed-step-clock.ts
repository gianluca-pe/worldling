export class FixedStepClock {
  private previousTime: number | null = null;
  private accumulator = 0;

  constructor(
    private readonly tickMs: number,
    private readonly maxSteps = 5,
  ) {}

  advance(time: number, step: () => void): number {
    if (this.previousTime === null) {
      this.previousTime = time;
      return 0;
    }

    this.accumulator += Math.min(
      Math.max(time - this.previousTime, 0),
      this.tickMs * this.maxSteps,
    );
    this.previousTime = time;
    let steps = 0;
    while (this.accumulator >= this.tickMs && steps < this.maxSteps) {
      step();
      this.accumulator -= this.tickMs;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    return steps;
  }

  reset(): void {
    this.previousTime = null;
    this.accumulator = 0;
  }
}
