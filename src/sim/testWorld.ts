import { DEFAULT_PARAMS, type Params } from "../params.ts";

/**
 * The world size the long-horizon dynamics tests (axisIsolation, goldenScenarios) were calibrated
 * against — 200x200 with its matching tree and founder counts, which is what DEFAULT_PARAMS carried
 * until SPEC.md Addendum 31 grew the shipping world to 400x400.
 *
 * Those tests ask whether a MECHANISM works: does maxing patchBimodality produce a foraging split,
 * does a meteor wipe out a regional lineage, does the neutral control stay unimodal. None of that is
 * a claim about the map's dimensions, and every threshold in them was swept by hand at this scale.
 * Inheriting the shipping size instead would mean re-sweeping every one of those thresholds on each
 * future resize, and would say nothing new about the mechanism.
 *
 * It is also the difference between a suite that finishes and one that doesn't: quadrupling the area
 * quadruples creatures and trees, so per-tick cost scales with it, and these tests run tens of
 * thousands of ticks. At 400x400 the life-history scenario ran 278s against a 120s budget and timed
 * out rather than failing on anything it was actually testing.
 *
 * What this deliberately does NOT cover: whether the game is well-balanced at 400x400. That is a
 * gameplay question, answered by playing it, not by these tests.
 */
export const CALIBRATED_WORLD: Partial<Params> = {
  worldWidth: 200,
  worldHeight: 200,
  richTreeCount: 4,
  poorTreeCount: 200,
  poorClusterCount: 25,
  shallowWaterTreeCount: 30,
  maxTreeCount: 350,
  terrainHillCount: 5,
  foundingPopulationSize: 100,
  // The island edge (Addendum 31) is geography, and these tests flatten geography on purpose so a
  // lucky land/sea split can't drive or suppress speciation independently of the axis under test —
  // the same reasoning that already zeroes waterPassabilitySteepness. A border would also make ~45%
  // of the map barren ocean, which is a habitat change, not a neutral one.
  oceanBorderFraction: 0,
};

/** DEFAULT_PARAMS at the calibration scale, plus any per-test overrides. */
export function calibratedParams(overrides: Partial<Params> = {}): Params {
  return { ...DEFAULT_PARAMS, ...CALIBRATED_WORLD, ...overrides };
}
