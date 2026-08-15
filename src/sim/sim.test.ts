import { describe, expect, it } from "vitest";
import { createSimState, tick } from "./sim.ts";
import { hashState } from "./testHash.ts";
import { DEFAULT_PARAMS } from "../params.ts";

function runToTick(seed: number, ticks: number): string {
  const { state, rng } = createSimState(seed, DEFAULT_PARAMS);
  for (let i = 0; i < ticks; i++) tick(state, rng, DEFAULT_PARAMS);
  return hashState(state);
}

describe("determinism", () => {
  it("produces an identical hashed state for the same seed after 5000 ticks", () => {
    expect(runToTick(42, 5000)).toBe(runToTick(42, 5000));
  });

  it("produces different states for different seeds", () => {
    expect(runToTick(1, 2000)).not.toBe(runToTick(2, 2000));
  });

  // The determinism tests above are only as strong as what hashState actually looks at. Each case
  // below perturbs exactly one field that drives the next tick and asserts the hash notices —
  // otherwise a real divergence in that field passes every determinism test in the suite silently.
  // heading in particular was genuinely uncovered: it decides where a creature moves next, but a
  // heading-only difference shows up in positions a tick LATER, so a hash compared at a run's final
  // tick could never see one introduced on that tick.
  describe("hashState covers the state that drives the next tick", () => {
    function perturbed(mutate: (state: ReturnType<typeof createSimState>["state"]) => void): string {
      const { state, rng } = createSimState(42, DEFAULT_PARAMS);
      for (let i = 0; i < 50; i++) tick(state, rng, DEFAULT_PARAMS);
      mutate(state);
      return hashState(state);
    }
    const baseline = perturbed(() => {});

    it.each([
      ["creature heading", (s: ReturnType<typeof createSimState>["state"]) => (s.evolution.creatures[0].heading += 0.5)],
      ["creature nursingUntilTick", (s: ReturnType<typeof createSimState>["state"]) => (s.evolution.creatures[0].nursingUntilTick += 10)],
      ["the creature id allocator", (s: ReturnType<typeof createSimState>["state"]) => (s.evolution.nextId += 1)],
      ["the tree id allocator", (s: ReturnType<typeof createSimState>["state"]) => (s.evolution.trees.nextId += 1)],
      ["the species id allocator", (s: ReturnType<typeof createSimState>["state"]) => (s.observations.taxonomy.nextSpeciesId += 1)],
      ["a drought/bloom regrowth modifier", (s: ReturnType<typeof createSimState>["state"]) => (s.evolution.world.regrowthModifier[0] = 0.5)],
      [
        "an in-flight barrier transition",
        (s: ReturnType<typeof createSimState>["state"]) =>
          s.evolution.activeTransitions.push({ field: "passability", cellIndices: [0], fromValues: [1], toValues: [0], startTick: 0, durationTicks: 100 }),
      ],
      [
        "an active drought override",
        (s: ReturnType<typeof createSimState>["state"]) =>
          s.evolution.activeRegrowthOverrides.push({ cellIndices: [0], multiplier: 0.5, startTick: 0, endTick: 100 }),
      ],
    ])("notices a change to %s", (_label, mutate) => {
      expect(perturbed(mutate)).not.toBe(baseline);
    });
  });
});

describe("population dynamics", () => {
  it("does not go extinct immediately under default params", () => {
    const { state, rng } = createSimState(7, DEFAULT_PARAMS);
    for (let i = 0; i < 3000; i++) tick(state, rng, DEFAULT_PARAMS);
    expect(state.evolution.creatures.length).toBeGreaterThan(0);
  });
});

describe("consumption grid", () => {
  it("accumulates real per-species feeding activity as the sim runs — the competition heatmap's data source", () => {
    const { state, rng } = createSimState(7, DEFAULT_PARAMS);
    for (let i = 0; i < 200; i++) tick(state, rng, DEFAULT_PARAMS);

    expect(state.observations.consumptionGrid.bySpecies.size).toBeGreaterThan(0);
    const founderCells = state.observations.consumptionGrid.bySpecies.get(0);
    expect(founderCells).toBeDefined();
    expect(founderCells!.some((v) => v > 0)).toBe(true);
  });
});

describe("species behavior stats", () => {
  it("tracks distanceTraveled on living creatures as the sim runs", () => {
    const { state, rng } = createSimState(7, DEFAULT_PARAMS);
    for (let i = 0; i < 200; i++) tick(state, rng, DEFAULT_PARAMS);

    expect(state.evolution.creatures.length).toBeGreaterThan(0);
    expect(state.evolution.creatures.some((c) => c.distanceTraveled > 0)).toBe(true);
  });

  it("records births as the population grows, and deaths once creatures start aging out", () => {
    const { state, rng } = createSimState(3, DEFAULT_PARAMS);
    for (let i = 0; i < 500; i++) tick(state, rng, DEFAULT_PARAMS);

    const founderAcc = state.observations.speciesBehavior.bySpecies.get(0);
    expect(founderAcc).toBeDefined();
    expect(founderAcc!.births).toBeGreaterThan(0);
  });
});

describe("predation", () => {
  it("a population of forced carnivores actually kills and eats each other, with deaths recorded", () => {
    // carnivory: 1 makes fruit worthless (gainPerUnit(1, 0, ...) = 0), so a healthy population
    // here can only be surviving off successful kills — real end-to-end evidence the whole
    // sense-target-attack-resolve pipeline works, not just its individual pieces in isolation.
    const params = { ...DEFAULT_PARAMS, foundingPopulationSize: 60 };
    const { state, rng } = createSimState(11, params);
    for (const c of state.evolution.creatures) c.genome.carnivory = 1;

    for (let i = 0; i < 500; i++) tick(state, rng, params);

    let totalDeaths = 0;
    for (const acc of state.observations.speciesBehavior.bySpecies.values()) totalDeaths += acc.deaths;
    expect(totalDeaths).toBeGreaterThan(0);
  });

  it("stays deterministic with predation active", () => {
    const params = { ...DEFAULT_PARAMS, foundingPopulationSize: 60 };
    function run(): string {
      const { state, rng } = createSimState(11, params);
      for (const c of state.evolution.creatures) c.genome.carnivory = 1;
      for (let i = 0; i < 500; i++) tick(state, rng, params);
      return hashState(state);
    }
    expect(run()).toBe(run());
  });
});

describe("observation history compaction", () => {
  it("bounds populationHistory/traitHistory on a long run instead of growing every sample forever", () => {
    // Actually simulating far enough for compaction to matter (100k+ ticks) would be far too slow
    // for a regular test run — this tests the WIRING (tick() calls compactHistory at the right
    // cadence, HISTORY_COMPACTION_INTERVAL_TICKS=5000) by injecting a large synthetic history and
    // running just one real tick across a compaction boundary, not by actually simulating that long.
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const syntheticSamples = 1000;
    state.observations.populationHistory = Array.from({ length: syntheticSamples }, (_, i) => ({
      tick: i * 100,
      counts: { 0: 500 },
    }));
    state.evolution.tick = 100_000; // a compaction boundary (100000 % HISTORY_COMPACTION_INTERVAL_TICKS(5000) === 0)

    tick(state, rng, DEFAULT_PARAMS);

    expect(state.observations.populationHistory.length).toBeLessThan(syntheticSamples / 3);
    // Still ordered and still ends at (approximately) the current tick -- compaction must never
    // reorder or drop the most recent samples.
    const history = state.observations.populationHistory;
    for (let i = 1; i < history.length; i++) {
      expect(history[i].tick).toBeGreaterThan(history[i - 1].tick);
    }
  });
});
