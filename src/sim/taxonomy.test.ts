import { describe, expect, it } from "vitest";
import { createCreature, type Creature } from "./creature.ts";
import { GENE_KEYS, randomGenome, type Genome } from "./genome.ts";
import { RNG } from "./rng.ts";
import { generateTerrain } from "./terrain.ts";
import { initTaxonomy, updateTaxonomy } from "./taxonomy.ts";
import { applyIntervention } from "./intervention.ts";
import { createSimState, tick } from "./sim.ts";
import { DEFAULT_PARAMS } from "../params.ts";

function makeGenome(overrides: Partial<Genome>): Genome {
  const rng = new RNG(1);
  return { ...randomGenome(rng), ...overrides };
}

function makeCreature(id: number, genome: Genome, x: number, y: number, lineageId = 0): Creature {
  const rng = new RNG(id + 1);
  return createCreature({ id, parentId: null, lineageId, genome, x, y, energy: 1, birthTick: 0, rng });
}

describe("updateTaxonomy", () => {
  it("does not split a genetically tight population", () => {
    const baseline = makeGenome({});
    const members = Array.from({ length: 20 }, (_, i) => makeCreature(i, baseline, 50, 50));
    const taxonomy = initTaxonomy(members, 0);
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 50, 50);

    const events = updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 100);
    expect(events).toHaveLength(0);
    expect(taxonomy.species.size).toBe(1);
  });

  it("splits into two species when two well-separated, spatially-overlapping clusters exist (sympatric)", () => {
    const dietA = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ dietPref: 0.02 }), 50, 50));
    const dietB = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ dietPref: 0.98 }), 52, 50));
    const members = [...dietA, ...dietB];
    const taxonomy = initTaxonomy(members, 0);
    // Flat terrain: no barrier anywhere, so any split found here can't be allopatric.
    const terrain = generateTerrain(new RNG(1), { ...DEFAULT_PARAMS, terrainHillCount: 0 }, 50, 50);

    const events = updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 100);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("speciation");
    if (events[0].type === "speciation") {
      expect(events[0].event.mechanism).toBe("sympatric");
      expect(events[0].event.dominantDivergentGene).toBe("dietPref");
    }
    expect(taxonomy.species.size).toBe(2);
  });

  it("tags a split as allopatric when a low-passability barrier separates the clusters", () => {
    const params = { ...DEFAULT_PARAMS, foundingPopulationSize: 1 };
    const { state, rng } = createSimState(1, params);

    // Stamp an impassable vertical wall right down the middle of the map.
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "barrierStamp",
      params: { x1: 100, y1: 0, x2: 100, y2: 200, width: 10, targetPassability: 0, formationTicks: 0 },
    });

    const left = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ dietPref: 0.02, speed: 0.3 }), 20, 100));
    const right = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ dietPref: 0.98, speed: 0.3 }), 180, 100));
    state.evolution.creatures = [...left, ...right];
    const taxonomy = initTaxonomy(state.evolution.creatures, 0);

    const events = updateTaxonomy(taxonomy, state.evolution.creatures, state.evolution.terrain, params, 100);
    expect(events).toHaveLength(1);
    if (events[0].type === "speciation") {
      expect(events[0].event.mechanism).toBe("allopatric");
    }
  });

  it("detects extinction when a species loses all living members", () => {
    const members = Array.from({ length: 5 }, (_, i) => makeCreature(i, makeGenome({}), 50, 50));
    const taxonomy = initTaxonomy(members, 0);
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 50, 50);

    const events = updateTaxonomy(taxonomy, [], terrain, DEFAULT_PARAMS, 500);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("extinction");
    if (events[0].type === "extinction") {
      expect(events[0].event.speciesId).toBe(0);
      expect(events[0].event.lifespanTicks).toBe(500);
    }
    expect(taxonomy.species.get(0)?.extinctTick).toBe(500);
  });

  it("picks the gene with the largest normalized deviation as dominantDivergentGene", () => {
    const baseline = makeGenome({});
    const dietA = Array.from({ length: 10 }, (_, i) => makeCreature(i, { ...baseline, senseRadius: 0.5 }, 50, 50));
    const dietB = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, { ...baseline, senseRadius: 19.5 }, 52, 50));
    const members = [...dietA, ...dietB];
    const taxonomy = initTaxonomy(members, 0);
    const terrain = generateTerrain(new RNG(1), { ...DEFAULT_PARAMS, terrainHillCount: 0 }, 50, 50);

    const events = updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 100);
    expect(events).toHaveLength(1);
    if (events[0].type === "speciation") {
      expect(events[0].event.dominantDivergentGene).toBe("senseRadius");
    }
  });
});

describe("Phase 4 milestone: hand-raised barrier produces a detected, logged allopatric split", () => {
  it("raising a barrier between two genetically-seeded populations produces an allopatric speciation event", () => {
    const params = { ...DEFAULT_PARAMS, foundingPopulationSize: 1, taxonomyIntervalTicks: 20 };
    const { state, rng } = createSimState(1, params);

    // Stamp a wall down the middle of the map, instantly.
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "barrierStamp",
      params: { x1: 100, y1: 0, x2: 100, y2: 200, width: 10, targetPassability: 0, formationTicks: 0 },
    });

    // Seed two clearly genetically-distinct founding groups, one on each side of the wall.
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 30, y: 100, spreadRadius: 15, count: 15, genome: makeGenome({ dietPref: 0.05, speed: 0.4 }) },
    });
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 170, y: 100, spreadRadius: 15, count: 15, genome: makeGenome({ dietPref: 0.95, speed: 0.4 }) },
    });

    let foundAllopatricSplit = false;
    for (let i = 0; i < 200 && !foundAllopatricSplit; i++) {
      tick(state, rng, params);
      foundAllopatricSplit = state.observations.taxonomyEvents.some((e) => e.type === "speciation" && e.event.mechanism === "allopatric");
    }

    expect(foundAllopatricSplit).toBe(true);

    const splitEvent = state.observations.taxonomyEvents.find((e) => e.type === "speciation" && e.event.mechanism === "allopatric");
    expect(splitEvent).toBeDefined();
    if (splitEvent?.type === "speciation") {
      // The two seeded groups both descend from the barrier being between them, not selection —
      // dominant gene should be whichever axis the two seed genomes actually differed on.
      expect(GENE_KEYS).toContain(splitEvent.event.dominantDivergentGene);
      expect(splitEvent.event.founderCount).toBeGreaterThanOrEqual(1);
    }

    // The species registry itself should also reflect the split, not just the event log.
    const allopatricSpecies = Array.from(state.observations.taxonomy.species.values()).find((s) => s.mechanism === "allopatric");
    expect(allopatricSpecies).toBeDefined();
    expect(allopatricSpecies?.parentId).not.toBeNull();
  });
});
