import { describe, expect, it } from "vitest";
import { GENE_RANGES } from "./sim/genome.ts";
import { DEFAULT_PARAMS } from "./params.ts";

describe("DEFAULT_PARAMS safety invariants", () => {
  it("keeps offspringEnergyFractionMax below the lowest possible reproThreshold", () => {
    // If this ever stops holding, a child's birth energy can itself clear its own reproduction
    // threshold before it forages — the exact windfall-cascade bug reproduce() was written to
    // prevent (see creature.test.ts). This guards the invariant at the params level so a future
    // tuning change can't silently reintroduce it.
    const [minReproThreshold] = GENE_RANGES.reproThreshold;
    expect(DEFAULT_PARAMS.offspringEnergyFractionMax).toBeLessThan(minReproThreshold);
  });

  it("keeps every metabolic cost coefficient positive — no trait should be free", () => {
    expect(DEFAULT_PARAMS.baseCost).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.moveCost).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.senseCost).toBeGreaterThan(0);
  });
});
