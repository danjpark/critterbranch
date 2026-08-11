import { type Creature, createCreature, energyCapacity, isReadyToReproduce, reproduce, stepCreature } from "./creature.ts";
import { cloneConsumptionGrid, type ConsumptionGrid, decayConsumption, initConsumptionGrid } from "./consumption.ts";
import { cloneGeneFlow, type GeneFlowState, initGeneFlow, updateGeneFlow } from "./geneFlow.ts";
import { type Genome, genomeCentroid, randomGenome, sampleTraits, type TraitSample } from "./genome.ts";
import { applyNursing } from "./nursing.ts";
import type { RunConfig } from "./runConfig.ts";
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
import { flattenParams, type Params } from "../params.ts";

/**
 * Core evolutionary state: the minimum a tick actually needs to advance the simulation. Nothing
 * in here exists to feed a chart — creature.ts/world.ts/terrain.ts/intervention.ts only ever read
 * or write this half of SimState.
 */
export interface EvolutionState {
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
}

/**
 * Everything derived FROM evolution state for observation/analytics purposes — taxonomy
 * classification, charts, the competition heatmap. Nothing here feeds back into how a creature
 * forages, reproduces, or dies; it's read by render/* and recomputed by dedicated update
 * functions (updateTaxonomy, updateGeneFlow, decayConsumption, sampleTraits, samplePopulation),
 * never inlined into creature/world mechanics. That separation is what lets a new visualization
 * get added (as five of these six fields were, across this project's history) without touching
 * creature.ts at all.
 */
export interface ObservationState {
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

export interface SimState {
  evolution: EvolutionState;
  observations: ObservationState;
}

export interface SimInstance {
  state: SimState;
  rng: RNG;
  /** The seed this run was created with — combined with params and interventionLog, this is a
   * run's entire exportable identity (see sim/runConfig.ts). */
  seed: number;
  /** The exact params this run was created with — kept alongside the instance (not just used
   * once at creation and discarded) so a later export captures what actually happened, not
   * whatever DEFAULT_PARAMS happens to be by then. */
  params: Params;
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
      evolution: {
        tick: 0,
        nextId,
        creatures,
        world,
        terrain,
        foundingCentroid,
        activeTransitions: [],
        activeRegrowthOverrides: [],
      },
      observations: {
        taxonomy,
        taxonomyEvents: [],
        geneFlow: initGeneFlow(),
        populationHistory: [samplePopulation(taxonomy, 0)],
        consumptionGrid: initConsumptionGrid(cols, rows),
        traitHistory: creatures.length > 0 ? [sampleTraits(creatures.map((c) => c.genome), 0)] : [],
      },
    },
    rng,
    seed,
    params,
    interventionLog: [],
  };
}

/** Advances the sim by exactly one tick, mutating `state` in place. */
export function tick(state: SimState, rng: RNG, params: Params): void {
  const evo = state.evolution;
  const obs = state.observations;

  // Ongoing god-mode effects (a barrier still forming, a crater still recovering) must update
  // before food regrows and creatures act this tick, so both see this tick's values, not last
  // tick's.
  processActiveTransitions(evo, evo.tick);
  processRegrowthOverrides(evo, evo.tick);
  regrowFood(evo.world, evo.terrain, evo.tick, params);
  if (evo.tick % params.consumptionDecayIntervalTicks === 0) {
    decayConsumption(obs.consumptionGrid, params.consumptionRetentionPerTick ** params.consumptionDecayIntervalTicks);
  }

  const nextGeneration: Creature[] = [];
  const allocateId = () => evo.nextId++;

  for (const creature of evo.creatures) {
    stepCreature(creature, evo.world, evo.terrain, rng, params, obs.consumptionGrid);

    if (isReadyToReproduce(creature, params)) {
      nextGeneration.push(...reproduce(creature, rng, params, evo.tick, allocateId));
    }

    if (creature.energy > 0 && creature.age < params.maxAge) {
      nextGeneration.push(creature);
    }
  }

  evo.creatures = nextGeneration;
  applyNursing(evo.creatures, evo.tick, params);

  // Gene flow needs to see every tick to catch every region crossing; taxonomy is expensive
  // enough (a near-linear pass over the whole population per species) that it only runs
  // periodically — a species doesn't meaningfully drift apart within a handful of ticks anyway.
  updateGeneFlow(obs.geneFlow, evo.creatures, params, evo.tick);
  if (evo.tick % params.taxonomyIntervalTicks === 0) {
    const events = updateTaxonomy(obs.taxonomy, evo.creatures, evo.terrain, params, evo.tick);
    if (events.length > 0) obs.taxonomyEvents.push(...events);
    obs.populationHistory.push(samplePopulation(obs.taxonomy, evo.tick));
    if (evo.creatures.length > 0) {
      obs.traitHistory.push(sampleTraits(evo.creatures.map((c) => c.genome), evo.tick));
    }
  }

  evo.tick += 1;
}

/**
 * Applies a god-mode intervention right now (at the sim's current tick) and records it in the
 * log. This is what live play calls when the user uses a brush; runSimulation below is the
 * headless counterpart that replays a previously-recorded log instead.
 */
export function applyInterventionNow(instance: SimInstance, params: Params, tool: Intervention["tool"], toolParams: Intervention["params"]): void {
  const intervention = { tick: instance.state.evolution.tick, tool, params: toolParams } as Intervention;
  applyIntervention(instance.state.evolution, instance.rng, params, intervention);
  instance.interventionLog.push(intervention);
}

/** Deep clone, safe to mutate independently of the original — used for the meteor undo checkpoint. */
export function cloneSimState(state: SimState): SimState {
  const evo = state.evolution;
  const obs = state.observations;
  return {
    evolution: {
      tick: evo.tick,
      nextId: evo.nextId,
      creatures: evo.creatures.map((c) => ({ ...c, genome: { ...c.genome } })),
      world: {
        cols: evo.world.cols,
        rows: evo.world.rows,
        r: evo.world.r.slice(),
        b: evo.world.b.slice(),
        capacityR: evo.world.capacityR.slice(),
        capacityB: evo.world.capacityB.slice(),
        regrowthModifier: evo.world.regrowthModifier.slice(),
      },
      terrain: {
        cols: evo.terrain.cols,
        rows: evo.terrain.rows,
        elevation: evo.terrain.elevation.slice(),
        passability: evo.terrain.passability.slice(),
        fertility: evo.terrain.fertility.slice(),
      },
      foundingCentroid: { ...evo.foundingCentroid },
      activeTransitions: evo.activeTransitions.map((t) => ({
        ...t,
        cellIndices: [...t.cellIndices],
        fromValues: [...t.fromValues],
        toValues: [...t.toValues],
      })),
      activeRegrowthOverrides: evo.activeRegrowthOverrides.map((o) => ({ ...o, cellIndices: [...o.cellIndices] })),
    },
    observations: {
      taxonomy: cloneTaxonomy(obs.taxonomy),
      // Event objects are never mutated after being pushed (see updateTaxonomy), so a shallow
      // array copy sharing references is safe — no need to deep-clone each event.
      taxonomyEvents: [...obs.taxonomyEvents],
      geneFlow: cloneGeneFlow(obs.geneFlow),
      // Samples are never mutated after being pushed (fresh objects each time, see
      // samplePopulation), so a shallow array copy sharing references is safe here too.
      populationHistory: [...obs.populationHistory],
      consumptionGrid: cloneConsumptionGrid(obs.consumptionGrid),
      // Samples are never mutated after being pushed (fresh objects each time, see sampleTraits),
      // so a shallow array copy sharing references is safe here too.
      traitHistory: [...obs.traitHistory],
    },
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
  while (state.evolution.tick < totalTicks) {
    while (logIndex < sortedLog.length && sortedLog[logIndex].tick === state.evolution.tick) {
      applyIntervention(state.evolution, rng, params, sortedLog[logIndex]);
      logIndex++;
    }
    tick(state, rng, params);
  }

  return state;
}

/** Convenience wrapper: runs entirely from a RunConfig's own seed/params/interventionLog instead
 * of the caller having to unpack them — see sim/runConfig.ts. RunConfig stores params
 * domain-grouped (RunParams); flattenParams() converts back to the flat shape every sim function
 * actually takes. */
export function runSimulationFromConfig(config: RunConfig, totalTicks: number): SimState {
  return runSimulation(config.seed, flattenParams(config.params), config.interventionLog, totalTicks);
}
