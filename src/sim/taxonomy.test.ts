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

    // Positioned close enough to the wall (x=100) that it's genuinely on their shortest path —
    // worldWidth is 200, so x=20/x=180 would actually be *closer* via wraparound (40 apart) than
    // through this wall (160 apart), which would make the wall irrelevant to them on a true torus.
    const left = Array.from({ length: 10 }, (_, i) => makeCreature(i, makeGenome({ dietPref: 0.02, speed: 0.3 }), 70, 100));
    const right = Array.from({ length: 10 }, (_, i) => makeCreature(i + 100, makeGenome({ dietPref: 0.98, speed: 0.3 }), 130, 100));
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

    // Seed two clearly genetically-distinct founding groups, one on each side of the wall — close
    // enough to it (x=100) that it's genuinely on their shortest path. worldWidth is 200, so
    // x=30/x=170 would actually be *closer* via wraparound (60 apart) than through this wall (140
    // apart), which would make the wall irrelevant to them on a true torus.
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 70, y: 100, spreadRadius: 15, count: 15, genome: makeGenome({ dietPref: 0.05, speed: 0.4 }) },
    });
    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 130, y: 100, spreadRadius: 15, count: 15, genome: makeGenome({ dietPref: 0.95, speed: 0.4 }) },
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

    const mechanism = classifyMechanism(spinoff, keep, makeGenome({}), makeGenome({}), terrain, params);
    expect(mechanism).not.toBe("allopatric");
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

    const mechanism = classifyMechanism(spinoff, keep, makeGenome({}), makeGenome({}), terrain, params);
    expect(mechanism).toBe("allopatric");
  });
});
