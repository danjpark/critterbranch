import { describe, expect, it } from "vitest";
import { GENE_RANGES } from "./genome.ts";
import { deriveMorphology, type MorphologySource } from "./morphology.ts";

function source(overrides: Partial<MorphologySource> = {}): MorphologySource {
  return { speed: 1, size: 1, carnivory: 0, senseRadius: 5, aquaticAdaptation: 0, ...overrides };
}

describe("deriveMorphology", () => {
  it("bodyScale is a pure pass-through of size", () => {
    expect(deriveMorphology(source({ size: 1.5 })).bodyScale).toBe(1.5);
    expect(deriveMorphology(source({ size: 0.5 })).bodyScale).toBe(0.5);
  });

  it("limbLength increases monotonically with speed", () => {
    const slow = deriveMorphology(source({ speed: GENE_RANGES.speed[0] })).limbLength;
    const mid = deriveMorphology(source({ speed: 1.6 })).limbLength;
    const fast = deriveMorphology(source({ speed: GENE_RANGES.speed[1] })).limbLength;
    expect(slow).toBeLessThan(mid);
    expect(mid).toBeLessThan(fast);
  });

  it("jawSize increases monotonically with carnivory, spanning its full range at the extremes", () => {
    const herbivore = deriveMorphology(source({ carnivory: 0 }));
    const omnivore = deriveMorphology(source({ carnivory: 0.5 }));
    const carnivore = deriveMorphology(source({ carnivory: 1 }));
    expect(herbivore.jawSize).toBeLessThan(omnivore.jawSize);
    expect(omnivore.jawSize).toBeLessThan(carnivore.jawSize);
  });

  it("earSize increases monotonically with senseRadius", () => {
    const low = deriveMorphology(source({ senseRadius: GENE_RANGES.senseRadius[0] })).earSize;
    const high = deriveMorphology(source({ senseRadius: GENE_RANGES.senseRadius[1] })).earSize;
    expect(low).toBeLessThan(high);
  });

  it("tailForm is a pure pass-through of aquaticAdaptation — the visual encoding Addendum 12 deferred", () => {
    expect(deriveMorphology(source({ aquaticAdaptation: 0 })).tailForm).toBe(0);
    expect(deriveMorphology(source({ aquaticAdaptation: 1 })).tailForm).toBe(1);
    expect(deriveMorphology(source({ aquaticAdaptation: 0.42 })).tailForm).toBe(0.42);
  });

  it("keeps every dimension within [0, 1] (bodyScale excepted — it's a raw size scale, not normalized) across the full gene range", () => {
    for (const speed of [GENE_RANGES.speed[0], GENE_RANGES.speed[1]]) {
      for (const carnivory of [0, 1]) {
        for (const senseRadius of [GENE_RANGES.senseRadius[0], GENE_RANGES.senseRadius[1]]) {
          for (const aquaticAdaptation of [0, 1]) {
            const m = deriveMorphology(source({ speed, carnivory, senseRadius, aquaticAdaptation }));
            expect(m.limbLength).toBeGreaterThanOrEqual(0);
            expect(m.limbLength).toBeLessThanOrEqual(1);
            expect(m.jawSize).toBeGreaterThanOrEqual(0);
            expect(m.jawSize).toBeLessThanOrEqual(1);
            expect(m.earSize).toBeGreaterThanOrEqual(0);
            expect(m.earSize).toBeLessThanOrEqual(1);
            expect(m.tailForm).toBeGreaterThanOrEqual(0);
            expect(m.tailForm).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("is deterministic — identical input produces identical output", () => {
    const a = deriveMorphology(source({ speed: 2.1, carnivory: 0.6, senseRadius: 8, aquaticAdaptation: 0.3 }));
    const b = deriveMorphology(source({ speed: 2.1, carnivory: 0.6, senseRadius: 8, aquaticAdaptation: 0.3 }));
    expect(a).toEqual(b);
  });
});
