export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xff_ff_ff_ff) {
      throw new RangeError("Seed must be an unsigned 32-bit integer");
    }
    this.state = seed;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d_2b_79_f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  snapshot(): number {
    return this.state;
  }
}
