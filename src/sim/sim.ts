import { type Creature, createCreature, energyCapacity, isReadyToReproduce, reproduce, stepCreature } from "./creature.ts";
import { cloneConsumptionGrid, type ConsumptionGrid, decayConsumption, initConsumptionGrid } from "./consumption.ts";
import { cloneGeneFlow, type GeneFlowState, initGeneFlow, updateGeneFlow } from "./geneFlow.ts";
import { type Genome, genomeCentroid, randomGenome, sampleTraits, type TraitSample } from "./genome.ts";
import { applyNursing } from "./nursing.ts";
import {
  applyIntervention,
  type FieldTransition,
  type Intervention,
  processActiveTransitions,
  processRegrowthOverrides,
  type RegrowthOverride,
} from "./intervention.ts";
import { RNG } from "./rng.ts";
import {
  cloneTaxonomy,
  initTaxonomy,
  type PopulationSample,
  samplePopulation,
  type TaxonomyEvent,
  type TaxonomyState,
  updateTaxonomy,
} from "./taxonomy.ts";
import { generateTerrain, type TerrainGrid } from "./terrain.ts";
import { generateWorld, regrowFood, type World } from "./world.ts";
import type { Params } from "../params.ts";

export interface SimState {
  tick: number;
  nextId: number;
  creatures: Creature[];
  world: World;
  terrain: TerrainGrid;
  /** Mean genome of the founding population — fixed reference point for genotype-color chroma. */
  foundingCentroid: Genome;
  /** In-progress god-mode effects (barrier formation, crater recovery), processed once per tick. */
  activeTransitions: FieldTransition[];
  activeRegrowthOverrides: RegrowthOverride[];
  taxonomy: TaxonomyState;
  /** Every speciation/extinction event ever detected, in tick order — the event feed's data source. */
  taxonomyEvents: TaxonomyEvent[];
  geneFlow: GeneFlowState;
  /** Per-species population counts over time, sampled alongside each taxonomy pass — the Muller plot's data source. */
  populationHistory: PopulationSample[];
  /** Per-cell, per-species decaying food-consumption totals — the competition heatmap's data source. */
  consumptionGrid: ConsumptionGrid;
  /** Population mean +/- std per gene over time — the trait time-series chart's data source. */
  traitHistory: TraitSample[];
}

export interface SimInstance {
  state: SimState;
  rng: RNG;
  /** The seed this run was created with — combined with interventionLog, this is a run's entire
   * exportable identity (see SPEC.md: "the intervention log is also a saved scenario"). */
  seed: number;
  /** Every god-mode action applied to this run, in application order. The whole point of this
   * log is that `runSimulation(seed, params, interventionLog)` can reproduce the run exactly,
   * headlessly, with nobody present — see runSimulation below. */
  interventionLog: Intervention[];
}

export function createSimState(seed: number, params: Params): SimInstance {
  const rng = new RNG(seed);
  const cols = Math.round(params.worldWidth / params.gridCellSize);
  const rows = Math.round(params.worldHeight / params.gridCellSize);

  const terrain = generateTerrain(rng, params, cols, rows);
  const world = generateWorld(rng, params, terrain);

  const creatures: Creature[] = [];
  let nextId = 0;
  for (let i = 0; i < params.foundingPopulationSize; i++) {
    const genome = randomGenome(rng);
    // Deliberately below the lowest possible reproThreshold (0.4) so founders must forage
    // before reproducing, rather than instantly cascading off their starting endowment.
    const startEnergy = energyCapacity(genome, params) * 0.35;
    creatures.push(
      createCreature({
        id: nextId++,
        parentId: null,
        lineageId: 0,
        genome,
        x: rng.nextRange(0, params.worldWidth),
        y: rng.nextRange(0, params.worldHeight),
        energy: startEnergy,
        birthTick: 0,
        rng,
      }),
    );
  }

  const foundingCentroid = genomeCentroid(creatures.map((c) => c.genome));
  const taxonomy = initTaxonomy(creatures, 0);

  return {
    state: {
      tick: 0,
      nextId,
      creatures,
      world,
      terrain,
      foundingCentroid,
      activeTransitions: [],
      activeRegrowthOverrides: [],
      taxonomy,
      taxonomyEvents: [],
      geneFlow: initGeneFlow(),
      populationHistory: [samplePopulation(taxonomy, 0)],
      consumptionGrid: initConsumptionGrid(cols, rows),
      traitHistory: creatures.length > 0 ? [sampleTraits(creatures.map((c) => c.genome), 0)] : [],
    },
    rng,
    seed,
    interventionLog: [],
  };
}

/** Advances the sim by exactly one tick, mutating `state` in place. */
export function tick(state: SimState, rng: RNG, params: Params): void {
  // Ongoing god-mode effects (a barrier still forming, a crater still recovering) must update
  // before food regrows and creatures act this tick, so both see this tick's values, not last
  // tick's.
  processActiveTransitions(state, state.tick);
  processRegrowthOverrides(state, state.tick);
  regrowFood(state.world, state.terrain, state.tick, params);
  if (state.tick % params.consumptionDecayIntervalTicks === 0) {
    decayConsumption(state.consumptionGrid, params.consumptionRetentionPerTick ** params.consumptionDecayIntervalTicks);
  }

  const nextGeneration: Creature[] = [];
  const allocateId = () => state.nextId++;

  for (const creature of state.creatures) {
    stepCreature(creature, state.world, state.terrain, rng, params, state.consumptionGrid);

    if (isReadyToReproduce(creature, params)) {
      nextGeneration.push(...reproduce(creature, rng, params, state.tick, allocateId));
    }

    if (creature.energy > 0 && creature.age < params.maxAge) {
      nextGeneration.push(creature);
    }
  }

  state.creatures = nextGeneration;
  applyNursing(state.creatures, state.tick, params);

  // Gene flow needs to see every tick to catch every region crossing; taxonomy is expensive
  // enough (a near-linear pass over the whole population per species) that it only runs
  // periodically — a species doesn't meaningfully drift apart within a handful of ticks anyway.
  updateGeneFlow(state.geneFlow, state.creatures, params, state.tick);
  if (state.tick % params.taxonomyIntervalTicks === 0) {
    const events = updateTaxonomy(state.taxonomy, state.creatures, state.terrain, params, state.tick);
    if (events.length > 0) state.taxonomyEvents.push(...events);
    state.populationHistory.push(samplePopulation(state.taxonomy, state.tick));
    if (state.creatures.length > 0) {
      state.traitHistory.push(sampleTraits(state.creatures.map((c) => c.genome), state.tick));
    }
  }

  state.tick += 1;
}

/**
 * Applies a god-mode intervention right now (at the sim's current tick) and records it in the
 * log. This is what live play calls when the user uses a brush; runSimulation below is the
 * headless counterpart that replays a previously-recorded log instead.
 */
export function applyInterventionNow(instance: SimInstance, params: Params, tool: Intervention["tool"], toolParams: Intervention["params"]): void {
  const intervention = { tick: instance.state.tick, tool, params: toolParams } as Intervention;
  applyIntervention(instance.state, instance.rng, params, intervention);
  instance.interventionLog.push(intervention);
}

/** Deep clone, safe to mutate independently of the original — used for the meteor undo checkpoint. */
export function cloneSimState(state: SimState): SimState {
  return {
    tick: state.tick,
    nextId: state.nextId,
    creatures: state.creatures.map((c) => ({ ...c, genome: { ...c.genome } })),
    world: {
      cols: state.world.cols,
      rows: state.world.rows,
      r: state.world.r.slice(),
      b: state.world.b.slice(),
      capacityR: state.world.capacityR.slice(),
      capacityB: state.world.capacityB.slice(),
      regrowthModifier: state.world.regrowthModifier.slice(),
    },
    terrain: {
      cols: state.terrain.cols,
      rows: state.terrain.rows,
      elevation: state.terrain.elevation.slice(),
      passability: state.terrain.passability.slice(),
      fertility: state.terrain.fertility.slice(),
    },
    foundingCentroid: { ...state.foundingCentroid },
    activeTransitions: state.activeTransitions.map((t) => ({
      ...t,
      cellIndices: [...t.cellIndices],
      fromValues: [...t.fromValues],
      toValues: [...t.toValues],
    })),
    activeRegrowthOverrides: state.activeRegrowthOverrides.map((o) => ({ ...o, cellIndices: [...o.cellIndices] })),
    taxonomy: cloneTaxonomy(state.taxonomy),
    // Event objects are never mutated after being pushed (see updateTaxonomy), so a shallow
    // array copy sharing references is safe — no need to deep-clone each event.
    taxonomyEvents: [...state.taxonomyEvents],
    geneFlow: cloneGeneFlow(state.geneFlow),
    // Samples are never mutated after being pushed (fresh objects each time, see
    // samplePopulation), so a shallow array copy sharing references is safe here too.
    populationHistory: [...state.populationHistory],
    consumptionGrid: cloneConsumptionGrid(state.consumptionGrid),
    // Samples are never mutated after being pushed (fresh objects each time, see sampleTraits),
    // so a shallow array copy sharing references is safe here too.
    traitHistory: [...state.traitHistory],
  };
}

/**
 * Headless replay: same seed + params + interventionLog must always reproduce the same run,
 * with each intervention taking effect at the exact tick it was recorded at. This is what makes
 * a run reproducible/exportable as a scenario — see SPEC.md's "interventions must be logged as
 * replayable events."
 */
export function runSimulation(seed: number, params: Params, interventionLog: Intervention[], totalTicks: number): SimState {
  const { state, rng } = createSimState(seed, params);
  const sortedLog = [...interventionLog].sort((a, b) => a.tick - b.tick);

  let logIndex = 0;
  while (state.tick < totalTicks) {
    while (logIndex < sortedLog.length && sortedLog[logIndex].tick === state.tick) {
      applyIntervention(state, rng, params, sortedLog[logIndex]);
      logIndex++;
    }
    tick(state, rng, params);
  }

  return state;
}
