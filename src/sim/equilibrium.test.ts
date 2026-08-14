import { describe, expect, it } from "vitest";
import { DEFAULT_EQUILIBRIUM_CONFIG, isEcosystemStable } from "./equilibrium.ts";
import { GENE_KEYS, type Genome, type TraitSample } from "./genome.ts";
import type { PopulationSample, TaxonomyEvent } from "./taxonomy.ts";

function flatGenome(value: number): Genome {
  const genome = {} as Genome;
  for (const key of GENE_KEYS) genome[key] = value;
  return genome;
}

function popSample(tick: number, total: number): PopulationSample {
  return { tick, counts: { 1: total } };
}

function traitSample(tick: number, overrides: Partial<Genome> = {}): TraitSample {
  return { tick, mean: { ...flatGenome(0.5), ...overrides }, std: flatGenome(0) };
}

const config = DEFAULT_EQUILIBRIUM_CONFIG;

describe("isEcosystemStable", () => {
  it("is false with fewer than windowSamples of history", () => {
    const pop = [popSample(0, 100), popSample(100, 100)];
    const traits = [traitSample(0), traitSample(100)];
    expect(isEcosystemStable(pop, traits, [], config)).toBe(false);
  });

  it("is true when population and every trait mean are flat across the window", () => {
    const pop = Array.from({ length: 5 }, (_, i) => popSample(i * 100, 100));
    const traits = Array.from({ length: 5 }, (_, i) => traitSample(i * 100));
    expect(isEcosystemStable(pop, traits, [], config)).toBe(true);
  });

  it("is false when total population swings beyond populationTolerance", () => {
    const pop = [popSample(0, 100), popSample(100, 100), popSample(200, 100), popSample(300, 100), popSample(400, 130)];
    const traits = Array.from({ length: 5 }, (_, i) => traitSample(i * 100));
    expect(isEcosystemStable(pop, traits, [], config)).toBe(false);
  });

  it("is false when a single gene's mean drifts beyond traitTolerance even if population and every other gene are flat", () => {
    const pop = Array.from({ length: 5 }, (_, i) => popSample(i * 100, 100));
    const traits = [
      traitSample(0),
      traitSample(100),
      traitSample(200),
      traitSample(300),
      traitSample(400, { carnivory: 0.9 }),
    ];
    expect(isEcosystemStable(pop, traits, [], config)).toBe(false);
  });

  it("is false when a taxonomy event happened within the window, even if population/traits look flat", () => {
    const pop = Array.from({ length: 5 }, (_, i) => popSample(i * 100, 100));
    const traits = Array.from({ length: 5 }, (_, i) => traitSample(i * 100));
    const events: TaxonomyEvent[] = [
      { type: "extinction", event: { tick: 250, speciesId: 1, lifespanTicks: 250, peakMemberCount: 100 } },
    ];
    expect(isEcosystemStable(pop, traits, events, config)).toBe(false);
  });

  it("is true when a taxonomy event happened before the window started", () => {
    const pop = Array.from({ length: 5 }, (_, i) => popSample(200 + i * 100, 100));
    const traits = Array.from({ length: 5 }, (_, i) => traitSample(200 + i * 100));
    const events: TaxonomyEvent[] = [
      { type: "extinction", event: { tick: 50, speciesId: 1, lifespanTicks: 50, peakMemberCount: 100 } },
    ];
    expect(isEcosystemStable(pop, traits, events, config)).toBe(true);
  });

  it("is false when the population has gone extinct (mean population 0) — extinction isn't equilibrium", () => {
    const pop = Array.from({ length: 5 }, (_, i) => popSample(i * 100, 0));
    const traits = Array.from({ length: 5 }, (_, i) => traitSample(i * 100));
    expect(isEcosystemStable(pop, traits, [], config)).toBe(false);
  });
});
