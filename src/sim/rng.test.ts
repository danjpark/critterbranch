import { describe, expect, it } from "vitest";
import { RNG } from "./rng.ts";

describe("RNG", () => {
  it("is deterministic: same seed produces the same sequence", () => {
    const a = new RNG(42);
    const b = new RNG(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new RNG(1);
    const b = new RNG(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() stays within [0, 1)", () => {
    const rng = new RNG(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("next() is roughly uniform over a large sample (mean near 0.5)", () => {
    const rng = new RNG(7);
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += rng.next();
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it("nextRange() stays within [min, max)", () => {
    const rng = new RNG(3);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextRange(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it("nextInt() stays within [0, maxExclusive) and hits multiple values", () => {
    const rng = new RNG(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it("gaussian() has roughly mean 0 and stddev 1 over a large sample", () => {
    const rng = new RNG(11);
    const n = 50_000;
    const samples = Array.from({ length: n }, () => rng.gaussian());
    const mean = samples.reduce((s, v) => s + v, 0) / n;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });
});
