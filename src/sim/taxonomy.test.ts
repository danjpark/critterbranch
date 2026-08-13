import { describe, expect, it } from "vitest";
import { createCreature, type Creature } from "./creature.ts";
import { GENE_KEYS, randomGenome, type Genome } from "./genome.ts";
import { RNG } from "./rng.ts";
import { generateTerrain, type TerrainGrid } from "./terrain.ts";
import { classifyMechanism, initTaxonomy, updateTaxonomy } from "./taxonomy.ts";
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

/** Fully flat, fully passable terrain except where `blockedAtGx` says otherwise — gives precise
 * control over exactly which grid columns are impassable, for testing barrier-sampling geometry
 * directly rather than relying on generateTerrain's randomized hills. */
function makeTerrainWithBlockedColumns(cols: number, rows: number, blockedAtGx: (gx: number) => boolean): TerrainGrid {
  const passability = new Float64Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      passability[gy * cols + gx] = blockedAtGx(gx) ? 0 : 1;
    }
  }
  return {
    cols,
    rows,
    elevation: new Float64Array(cols * rows),
    passability,
    fertility: new Float64Array(cols * rows).fill(1),
    seaLevel: -1, // below every (flat, all-zero) elevation value — nothing here counts as water
    revision: 0,
  };
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
    const dietA = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ offspringInvestment: 0.02 }), 50, 50));
    const dietB = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ offspringInvestment: 0.98 }), 52, 50));
    const members = [...dietA, ...dietB];
    const taxonomy = initTaxonomy(members, 0);
    // Flat terrain: no barrier anywhere, so any split found here can't be allopatric.
    const terrain = generateTerrain(new RNG(1), { ...DEFAULT_PARAMS, terrainHillCount: 0 }, 50, 50);

    // Default speciationConfirmationPasses is 2: the same split must be re-detected on a second
    // consecutive pass before it's promoted to a real species (see "persistence/hysteresis").
    // The population here doesn't change between calls, so the same split is found both times.
    expect(updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 100)).toHaveLength(0);
    const events = updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 200);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("speciation");
    if (events[0].type === "speciation") {
      expect(events[0].event.mechanism).toBe("sympatric");
      expect(events[0].event.dominantDivergentGene).toBe("offspringInvestment");

      // The event carries the raw evidence its mechanism tag was inferred from, not just the
      // label -- enough to independently see *why* this got called sympatric: no barrier, and
      // plenty of founders on both sides (so not a drift/founder-effect signature either).
      const { evidence } = events[0].event;
      expect(evidence.dominantDivergentGene).toBe("offspringInvestment");
      expect(evidence.founderCount).toBe(10);
      expect(evidence.geneticSeparation).toBeGreaterThan(DEFAULT_PARAMS.speciationThreshold);
      expect(evidence.minimumBarrierPassability).toBeGreaterThanOrEqual(DEFAULT_PARAMS.allopatricPassabilityThreshold);
    }
    expect(taxonomy.species.size).toBe(2);
    // The species registry carries the same evidence, not just the transient event.
    const spinoffSpecies = Array.from(taxonomy.species.values()).find((s) => s.id !== 0);
    expect(spinoffSpecies?.originEvidence?.dominantDivergentGene).toBe("offspringInvestment");
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

    // Positioned close enough to the wall (x=100) that it's genuinely on their shortest path —
    // worldWidth is 200, so x=20/x=180 would actually be *closer* via wraparound (40 apart) than
    // through this wall (160 apart), which would make the wall irrelevant to them on a true torus.
    const left = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ offspringInvestment: 0.02, speed: 0.3 }), 70, 100));
    const right = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ offspringInvestment: 0.98, speed: 0.3 }), 130, 100));
    state.evolution.creatures = [...left, ...right];
    const taxonomy = initTaxonomy(state.evolution.creatures, 0);

    expect(updateTaxonomy(taxonomy, state.evolution.creatures, state.evolution.terrain, params, 100)).toHaveLength(0);
    const events = updateTaxonomy(taxonomy, state.evolution.creatures, state.evolution.terrain, params, 200);
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

    expect(updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 100)).toHaveLength(0);
    const events = updateTaxonomy(taxonomy, members, terrain, DEFAULT_PARAMS, 200);
    expect(events).toHaveLength(1);
    if (events[0].type === "speciation") {
      expect(events[0].event.dominantDivergentGene).toBe("senseRadius");
    }
  });
});

describe("speciation persistence/hysteresis", () => {
  it("a split that appears for one pass and disappears never becomes a species", () => {
    const dietA = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ offspringInvestment: 0.02 }), 50, 50));
    const dietB = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ offspringInvestment: 0.98 }), 52, 50));
    const bimodal = [...dietA, ...dietB];
    const tight = Array.from({ length: 20 }, (_, i) => makeCreature(i, makeGenome({}), 50, 50));
    const terrain = generateTerrain(new RNG(1), { ...DEFAULT_PARAMS, terrainHillCount: 0 }, 50, 50);
    const taxonomy = initTaxonomy(bimodal, 0);

    // Pass 1: genuinely bimodal -- creates a pending candidate, but not enough passes yet to confirm.
    expect(updateTaxonomy(taxonomy, bimodal, terrain, DEFAULT_PARAMS, 100)).toHaveLength(0);
    expect(taxonomy.candidates.size).toBe(1);
    expect(taxonomy.species.size).toBe(1);

    // Pass 2: the population reverts to tight/unimodal (the fluctuation didn't hold) -- no split
    // is found this pass, so the candidate can't be confirmed. It must not silently promote anyway.
    expect(updateTaxonomy(taxonomy, tight, terrain, DEFAULT_PARAMS, 200)).toHaveLength(0);
    expect(taxonomy.species.size).toBe(1);
  });

  it("a pending candidate that never gets re-confirmed times out and is dropped, not left pending forever", () => {
    const dietA = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ offspringInvestment: 0.02 }), 50, 50));
    const dietB = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ offspringInvestment: 0.98 }), 52, 50));
    const bimodal = [...dietA, ...dietB];
    const tight = Array.from({ length: 20 }, (_, i) => makeCreature(i, makeGenome({}), 50, 50));
    const terrain = generateTerrain(new RNG(1), { ...DEFAULT_PARAMS, terrainHillCount: 0 }, 50, 50);
    const params = { ...DEFAULT_PARAMS, taxonomyIntervalTicks: 100, speciationCandidateTimeoutPasses: 2 };
    const taxonomy = initTaxonomy(bimodal, 0);

    updateTaxonomy(taxonomy, bimodal, terrain, params, 100);
    expect(taxonomy.candidates.size).toBe(1);

    // Three more passes with no re-detection -- past the 2-pass timeout, the candidate should age out.
    updateTaxonomy(taxonomy, tight, terrain, params, 200);
    updateTaxonomy(taxonomy, tight, terrain, params, 300);
    updateTaxonomy(taxonomy, tight, terrain, params, 400);
    expect(taxonomy.candidates.size).toBe(0);
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

    // Seed two clearly genetically-distinct founding groups, one on each side of the wall — close
    // enough to it (x=100) that it's genuinely on their shortest path. worldWidth is 200, so
    // x=30/x=170 would actually be *closer* via wraparound (60 apart) than through this wall (140
    // apart), which would make the wall irrelevant to them on a true torus.
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      // carnivory: 0 pinned alongside speed for the same reason — an isolated allopatric-split
      // test shouldn't have its outcome depend on whatever incidental value the shared base
      // genome happens to draw for a gene this test isn't studying. Found the hard way: this
      // test started failing once carnivory (SPEC.md Addendum 7) made a real difference, because
      // the fixed base genome's incidental carnivory (~0.79) triggered enough real predation to
      // collapse the founder population before a split could be confirmed.
      params: { x: 70, y: 100, spreadRadius: 15, count: 15, genome: makeGenome({ offspringInvestment: 0.05, speed: 0.4, carnivory: 0 }) },
    });
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 130, y: 100, spreadRadius: 15, count: 15, genome: makeGenome({ offspringInvestment: 0.95, speed: 0.4, carnivory: 0 }) },
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

describe("classifyMechanism: torus-aware spatial geometry", () => {
  // worldWidth=200, gridCellSize=4 -> 50 grid columns (gx 0..49), each covering 4 world units.
  const params = DEFAULT_PARAMS;

  it("does not mistake a mid-map barrier for one on the clusters' true (wrapped, short) path", () => {
    // A barrier sits in the middle of the map (world x ~88-112). Two clusters sit near opposite
    // edges (world x ~10 and ~190) -- straddling the wrap seam, so their TRUE shortest path goes
    // the other way, through x=0/200, nowhere near this barrier. A naive straight-line sample
    // from x=10 to x=190 would cross straight through it and wrongly call this allopatric.
    const terrain = makeTerrainWithBlockedColumns(50, 50, (gx) => gx >= 22 && gx <= 27);
    const spinoff = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({}), 10, 100));
    const keep = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({}), 190, 100));

    const { mechanism, evidence } = classifyMechanism(spinoff, keep, makeGenome({}), makeGenome({}), terrain, params);
    expect(mechanism).not.toBe("allopatric");
    expect(evidence.minimumBarrierPassability).toBeGreaterThanOrEqual(params.allopatricPassabilityThreshold);
  });

  it("detects a barrier sitting right at the wrap seam that a naive straight-line sample would miss entirely", () => {
    // The barrier straddles the seam itself (world x near 0 and near 200). Two clusters at world
    // x ~30 and ~170 have their TRUE shortest path going backward through that seam (distance 60,
    // vs. 140 the straight way through the middle) -- so the real barrier IS on their short path.
    // A naive straight-line sample from x=30 to x=170 stays entirely in the clean middle of the
    // map and would miss it, wrongly calling this NOT allopatric.
    const terrain = makeTerrainWithBlockedColumns(50, 50, (gx) => gx <= 2 || gx >= 47);
    const spinoff = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({}), 30, 100));
    const keep = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({}), 170, 100));

    const { mechanism, evidence } = classifyMechanism(spinoff, keep, makeGenome({}), makeGenome({}), terrain, params);
    expect(mechanism).toBe("allopatric");
    expect(evidence.minimumBarrierPassability).toBeLessThan(params.allopatricPassabilityThreshold);
  });
});
