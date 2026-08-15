import { describe, expect, it } from "vitest";
import { DEFAULT_RAMP_CONFIG, rampedTicksPerFrame, type RampConfig } from "./pacing.ts";

const FULL_RAMP_TICKS = DEFAULT_RAMP_CONFIG.holdTicks + DEFAULT_RAMP_CONFIG.rampTicks;

describe("rampedTicksPerFrame", () => {
  it("starts at floorSpeedTicks the instant an eventful moment happens", () => {
    expect(rampedTicksPerFrame(10, 0, DEFAULT_RAMP_CONFIG)).toBe(DEFAULT_RAMP_CONFIG.floorSpeedTicks);
  });

  it("holds the floor speed through the whole hold window, not just the first frame", () => {
    for (const elapsed of [0, 40, DEFAULT_RAMP_CONFIG.holdTicks - 1]) {
      expect(rampedTicksPerFrame(10, elapsed, DEFAULT_RAMP_CONFIG)).toBe(DEFAULT_RAMP_CONFIG.floorSpeedTicks);
    }
  });

  it("reaches the full target speed once the hold and ramp have both elapsed", () => {
    expect(rampedTicksPerFrame(10, FULL_RAMP_TICKS, DEFAULT_RAMP_CONFIG)).toBe(10);
    expect(rampedTicksPerFrame(10, FULL_RAMP_TICKS + 500, DEFAULT_RAMP_CONFIG)).toBe(10);
  });

  it("interpolates monotonically between the floor and the target across the ramp window", () => {
    const config: RampConfig = { holdTicks: 0, rampTicks: 100, floorSpeedTicks: 1 };
    let previous = 0;
    for (let ticksSinceEventful = 0; ticksSinceEventful <= 100; ticksSinceEventful += 10) {
      const speed = rampedTicksPerFrame(50, ticksSinceEventful, config);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
    expect(previous).toBe(50);
  });

  // The point of easing in rather than interpolating linearly: a linear ramp is already at half
  // speed halfway through the window, so the back half of the ramp — still an eventful stretch of
  // the era — goes by nearly as fast as the settled remainder does.
  it("stays nearer the floor than a linear ramp would at the midpoint of the ramp window", () => {
    const config: RampConfig = { holdTicks: 0, rampTicks: 100, floorSpeedTicks: 1 };
    const midpoint = rampedTicksPerFrame(100, 50, config);
    const linearMidpoint = (1 + 100) / 2;
    expect(midpoint).toBeLessThan(linearMidpoint);
  });

  it("clamps negative ticksSinceEventful (e.g. right after a checkpoint restore) to the floor", () => {
    expect(rampedTicksPerFrame(10, -50, DEFAULT_RAMP_CONFIG)).toBe(DEFAULT_RAMP_CONFIG.floorSpeedTicks);
  });

  it("never exceeds the target speed, even when the target is slower than the floor", () => {
    const config: RampConfig = { holdTicks: 100, rampTicks: 100, floorSpeedTicks: 5 };
    expect(rampedTicksPerFrame(1, 0, config)).toBe(1);
    expect(rampedTicksPerFrame(1, 500, config)).toBe(1);
  });

  // The actual complaint this was retuned for (SPEC.md Addendum 23): the eventful opening of an
  // era used to be over in a moment. Measured as animation frames spent, not ticks — frames are
  // what the player experiences as time.
  it("spends most of an era's animation on its opening third, where the dynamics actually are", () => {
    const eraTicks = 2000;
    let tick = 0;
    let framesInFirstThird = 0;
    let totalFrames = 0;
    while (tick < eraTicks) {
      if (tick < eraTicks / 3) framesInFirstThird++;
      totalFrames++;
      tick += rampedTicksPerFrame(10, tick, DEFAULT_RAMP_CONFIG);
    }
    expect(framesInFirstThird / totalFrames).toBeGreaterThan(0.6);
  });
});
