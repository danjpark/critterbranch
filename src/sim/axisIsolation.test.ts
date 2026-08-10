import { describe, expect, it } from "vitest";
import { isBimodal } from "./bimodality.ts";
import { GENE_KEYS } from "./genome.ts";
import { createSimState, tick } from "./sim.ts";
import { DEFAULT_PARAMS, type Params } from "../params.ts";

const NEUTRAL: Partial<Params> = { specializationExponent: 0, patchBimodality: 0, regrowthCycleAmplitude: 0 };

function runFor(seed: number, overrides: Partial<Params>, ticks: number) {
  const params = { ...DEFAULT_PARAMS, ...overrides };
  const { state, rng } = createSimState(seed, params);
  for (let i = 0; i < ticks; i++) tick(state, rng, params);
  return state;
}

function speciationEvents(state: ReturnType<typeof runFor>) {
  return state.taxonomyEvents.filter((e): e is Extract<typeof e, { type: "speciation" }> => e.type === "speciation");
}

describe("neutral control", () => {
  it(
    "produces no speciation events and no gene bimodality with all three trade-off axes flattened",
    () => {
      // Run several seeds — a single lucky/unlucky seed proves nothing about whether the detector
      // is well-calibrated. If ANY of these produces a false positive, the detector is finding
      // noise and every other result in this app is meaningless (see SPEC.md's Testing section).
      for (const seed of [1, 2, 3]) {
        const state = runFor(seed, NEUTRAL, 4000);

        expect(state.taxonomyEvents.filter((e) => e.type === "speciation")).toHaveLength(0);
        expect(state.taxonomy.species.size).toBe(1);

        if (state.creatures.length > 0) {
          for (const key of GENE_KEYS) {
            expect(isBimodal(state.creatures.map((c) => c.genome[key]))).toBe(false);
          }
        }
      }
    },
    90_000,
  );
});

describe("diet axis in isolation", () => {
  it(
    "produces a detected dietPref speciation event when specializationExponent is hot and the other two axes are flat",
    () => {
      // SPEC.md's own worked example puts the first dietPref branch at "tick ~15,000" — this is
      // slow, drift-driven disruptive selection, not something that resolves in a few thousand
      // ticks. One seed run long enough to actually reach that regime is the honest test here;
      // requiring every seed to clear it by a fixed tick would just make the test flaky, since
      // sympatric speciation timing is inherently stochastic (see SPEC.md: "hardest and least
      // predictable work").
      const state = runFor(1, { ...NEUTRAL, specializationExponent: 3 }, 20_000);

      const events = speciationEvents(state);
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.event.dominantDivergentGene === "dietPref")).toBe(true);
    },
    120_000,
  );
});

describe("foraging axis in isolation", () => {
  it(
    "produces detected speciation events on foraging genes when patchBimodality is maxed and the other two axes are flat",
    () => {
      const state = runFor(1, { ...NEUTRAL, patchBimodality: 1.0 }, 20_000);

      const events = speciationEvents(state);
      expect(events.length).toBeGreaterThan(0);
      const foragingGenes = new Set(["speed", "senseRadius", "wanderPersistence"]);
      expect(events.some((e) => foragingGenes.has(e.event.dominantDivergentGene))).toBe(true);
    },
    120_000,
  );
});

describe("life-history axis in isolation", () => {
  it(
    "produces strong population-level boom/bust dynamics from regrowthCycleAmplitude, without a spurious species split",
    () => {
      // Unlike diet and foraging, this axis is explicitly *temporal*, not spatial (SPEC.md: "this
      // axis needs temporal structure to bite"). With no spatial refuge and no diploidy, a
      // synchronized global cycle applies the same selective pressure to every individual at
      // once — it can't sustain two co-existing genotype clusters, since there's no niche for a
      // "loser" strategy to persist in. What it *does* produce is measured here instead: the whole
      // population's mean trait gets dragged back and forth each half-cycle (cheap-and-many wins
      // the boom, expensive-and-few survives the bust — SPEC.md's own framing), which shows up as
      // large swings in population size that track the cycle. That is this axis's real signature
      // in isolation; symmetric bimodal splitting only happens once the diet/foraging axes have
      // already carved out spatial structure for it to act within (SPEC.md's worked example has
      // the life-history branch arrive as a *second*, asymmetric split inside an already-diverged
      // lineage, not as a standalone founder-population split).
      const ticks = 12_000;
      const cyclingState = runFor(1, { ...NEUTRAL, regrowthCycleAmplitude: 1.0, regrowthCyclePeriod: 3000 }, ticks);
      const flatState = runFor(1, NEUTRAL, ticks);

      const rangeOf = (samples: { counts: Record<number, number> }[]) => {
        const totals = samples.map((s) => Object.values(s.counts).reduce((a, b) => a + b, 0));
        return Math.max(...totals) / Math.max(1, Math.min(...totals));
      };

      const cyclingRange = rangeOf(cyclingState.populationHistory);
      const flatRange = rangeOf(flatState.populationHistory);

      expect(cyclingRange).toBeGreaterThan(flatRange * 2);
      expect(cyclingRange).toBeGreaterThan(3);

      // The wide population swing is directional selection, not disruptive selection — it should
      // not be misreported as speciation.
      expect(speciationEvents(cyclingState)).toHaveLength(0);
      expect(cyclingState.taxonomy.species.size).toBe(1);
    },
    120_000,
  );
});
