/**
 * Seeded PCG32 PRNG. This is the ONLY source of randomness allowed in src/sim/ —
 * Math.random() is banned there so that (seed, params) -> state is reproducible.
 */

const MASK64 = (1n << 64n) - 1n;
const MUL64 = 6364136223846793005n;

export class RNG {
  private state = 0n;
  private inc = 0n;
  private spareGaussian: number | null = null;

  constructor(seed: number, sequence = 1) {
    this.inc = ((BigInt(sequence) << 1n) | 1n) & MASK64;
    this.nextUint32();
    this.state = (this.state + BigInt(seed >>> 0)) & MASK64;
    this.nextUint32();
  }

  nextUint32(): number {
    const oldState = this.state;
    this.state = (oldState * MUL64 + this.inc) & MASK64;
    const xorshifted = Number(((oldState >> 18n) ^ oldState) >> 27n) >>> 0;
    const rot = Number(oldState >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Standard normal sample via Box-Muller, mean 0 stddev 1. */
  gaussian(): number {
    if (this.spareGaussian !== null) {
      const value = this.spareGaussian;
      this.spareGaussian = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s <= 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareGaussian = v * mul;
    return u * mul;
  }
}
