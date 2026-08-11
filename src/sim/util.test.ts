import { describe, expect, it } from "vitest";
import { circularMean, clamp, clamp01, lerp, torDelta, torDist, wrap, wrappedLerp } from "./util.ts";

describe("clamp", () => {
  it("passes values already inside the range through unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it("clamps above the maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("clamp01", () => {
  it("clamps to [0, 1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
  });
});

describe("lerp", () => {
  it("interpolates linearly, including outside [0, 1]", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe("wrap", () => {
  it("leaves in-range values unchanged", () => {
    expect(wrap(5, 10)).toBe(5);
  });
  it("wraps values at or above size back into [0, size)", () => {
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(15, 10)).toBe(5);
  });
  it("wraps negative values into [0, size)", () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(-15, 10)).toBe(5);
  });
});

describe("torDelta", () => {
  it("matches plain subtraction when there is no wraparound", () => {
    expect(torDelta(7, 3, 100)).toBe(4);
  });
  it("takes the shorter path around the torus", () => {
    // 99 vs 1 on a size-100 torus: going forward from 1 to 99 is 98, backward is -2.
    expect(torDelta(99, 1, 100)).toBe(-2);
    expect(torDelta(1, 99, 100)).toBe(2);
  });
});

describe("torDist", () => {
  it("is zero for coincident points", () => {
    expect(torDist(5, 5, 5, 5, 100, 100)).toBe(0);
  });
  it("uses the wrapped-around distance when it is shorter", () => {
    // Two points near opposite edges of a size-100 torus are actually close together.
    const dist = torDist(1, 1, 99, 1, 100, 100);
    expect(dist).toBe(2);
  });
});

describe("circularMean", () => {
  it("matches a plain average when nothing wraps", () => {
    expect(circularMean([40, 50, 60], 200)).toBeCloseTo(50, 6);
  });

  it("places points straddling the wrap seam on the near side, not in the middle of the map", () => {
    // 1 and 199 on a size-200 torus are ~2 apart, through the seam at 0/200 -- their "average"
    // should land right at the seam (0, i.e. 200), not at the naive-mean midpoint of 100.
    const mean = circularMean([1, 199], 200);
    expect(mean === 0 || mean > 199.9).toBe(true);
  });

  it("is invariant to a uniform shift of the whole period", () => {
    const a = circularMean([10, 20, 30], 100);
    const shifted = circularMean([60, 70, 80], 100); // same relative spread, shifted by 50
    expect(shifted).toBeCloseTo(wrap(a + 50, 100), 6);
  });
});

describe("wrappedLerp", () => {
  it("matches plain lerp when there is no wraparound", () => {
    expect(wrappedLerp(10, 20, 0.5, 100)).toBeCloseTo(15, 6);
  });

  it("takes the short way around the seam instead of the long straight line", () => {
    // From 199 to 1 on a size-200 torus, the short way goes forward through the seam
    // (199 -> 200/0 -> 1), not backward across the whole map.
    const midpoint = wrappedLerp(199, 1, 0.5, 200);
    expect(midpoint === 0 || Math.abs(midpoint - 0) < 1e-6).toBe(true);
  });

  it("reaches exactly a at t=0 and b (wrapped) at t=1", () => {
    expect(wrappedLerp(5, 90, 0, 100)).toBeCloseTo(5, 6);
    expect(wrappedLerp(5, 90, 1, 100)).toBeCloseTo(90, 6);
  });
});
