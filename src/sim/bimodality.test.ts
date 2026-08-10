import { describe, expect, it } from "vitest";
import { isBimodal } from "./bimodality.ts";
import { RNG } from "./rng.ts";

describe("isBimodal", () => {
  it("is false for a tight, unimodal cluster", () => {
    const values = [0.48, 0.49, 0.5, 0.5, 0.51, 0.52, 0.5, 0.49, 0.5, 0.51];
    expect(isBimodal(values)).toBe(false);
  });

  it("is false for a smooth uniform spread (no real gap)", () => {
    const values = Array.from({ length: 20 }, (_, i) => i / 19);
    expect(isBimodal(values)).toBe(false);
  });

  it("is true for two clearly separated clusters of similar size", () => {
    const rng = new RNG(1);
    const low = Array.from({ length: 10 }, () => 0.1 + rng.next() * 0.02);
    const high = Array.from({ length: 10 }, () => 0.9 + rng.next() * 0.02);
    expect(isBimodal([...low, ...high])).toBe(true);
  });

  it("is false when one 'cluster' is too small to count (noise, not a real split)", () => {
    const rng = new RNG(1);
    const main = Array.from({ length: 19 }, () => 0.5 + rng.next() * 0.02);
    const outlier = [0.99];
    expect(isBimodal([...main, ...outlier])).toBe(false);
  });

  it("is false for fewer than 4 values regardless of spread", () => {
    expect(isBimodal([0, 1, 0.5])).toBe(false);
  });

  it("is false when all values are identical", () => {
    expect(isBimodal([0.5, 0.5, 0.5, 0.5, 0.5])).toBe(false);
  });
});
