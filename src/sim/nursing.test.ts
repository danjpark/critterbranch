import { describe, expect, it } from "vitest";
import { createCreature } from "./creature.ts";
import { randomGenome } from "./genome.ts";
import { applyNursing } from "./nursing.ts";
import { RNG } from "./rng.ts";
import { DEFAULT_PARAMS } from "../params.ts";

function makeCreature(overrides: Partial<Parameters<typeof createCreature>[0]> = {}) {
  const rng = new RNG(1);
  return createCreature({
    id: 0,
    parentId: null,
    lineageId: 0,
    genome: randomGenome(rng),
    x: 0,
    y: 0,
    energy: 10,
    birthTick: 0,
    rng,
    ...overrides,
  });
}

describe("applyNursing", () => {
  it("transfers energy from a living parent to a dependent still within its nursing window", () => {
    const parent = makeCreature({ id: 1, energy: 5 });
    const child = makeCreature({ id: 2, parentId: 1, nursingUntilTick: 100, energy: 1 });

    applyNursing([parent, child], 10, DEFAULT_PARAMS);

    expect(child.energy).toBeCloseTo(1 + DEFAULT_PARAMS.nursingRatePerTick);
    expect(parent.energy).toBeCloseTo(5 - DEFAULT_PARAMS.nursingRatePerTick);
  });

  it("transfers nothing once the child's nursing window has closed", () => {
    const parent = makeCreature({ id: 1, energy: 5 });
    const child = makeCreature({ id: 2, parentId: 1, nursingUntilTick: 100, energy: 1 });

    applyNursing([parent, child], 100, DEFAULT_PARAMS);

    expect(child.energy).toBe(1);
    expect(parent.energy).toBe(5);
  });

  it("never gives a child enough to itself clear the minimum reproThreshold from nursing alone", () => {
    // Same invariant reproduce() protects at birth (see creature.test.ts) — a single transfer here
    // is tiny, but it should never push the parent's energy negative either.
    const parent = makeCreature({ id: 1, energy: 0.001 });
    const child = makeCreature({ id: 2, parentId: 1, nursingUntilTick: 100, energy: 0 });

    applyNursing([parent, child], 10, DEFAULT_PARAMS);

    expect(parent.energy).toBeGreaterThanOrEqual(0);
    expect(child.energy).toBeCloseTo(0.001);
  });

  it("stops looking for a parent that has died — the child keeps going independently, not culled", () => {
    const child = makeCreature({ id: 2, parentId: 1, nursingUntilTick: 100, energy: 1 });

    // Parent (id 1) is not in the living population this tick — already died and was culled.
    applyNursing([child], 10, DEFAULT_PARAMS);

    expect(child.energy).toBe(1);
    expect(child.nursingUntilTick).toBe(10);

    // A later call must not throw or resume searching once the window has been closed early.
    applyNursing([child], 11, DEFAULT_PARAMS);
    expect(child.energy).toBe(1);
  });

  it("leaves parentless creatures (founders) untouched", () => {
    const founder = makeCreature({ id: 1, energy: 5 });
    applyNursing([founder], 10, DEFAULT_PARAMS);
    expect(founder.energy).toBe(5);
  });
});
