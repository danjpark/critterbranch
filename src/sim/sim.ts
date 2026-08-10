import { type Creature, createCreature, energyCapacity, isReadyToReproduce, reproduce, stepCreature } from "./creature.ts";
import { type Genome, genomeCentroid, randomGenome } from "./genome.ts";
import {
  applyIntervention,
  type FieldTransition,
  type Intervention,
  processActiveTransitions,
  processRegrowthOverrides,
  type RegrowthOverride,
} from "./intervention.ts";
import { RNG } from "./rng.ts";
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

  const nextGeneration: Creature[] = [];
  const allocateId = () => state.nextId++;

  for (const creature of state.creatures) {
    stepCreature(creature, state.world, state.terrain, rng, params);

    if (isReadyToReproduce(creature, params)) {
      nextGeneration.push(...reproduce(creature, rng, params, state.tick, allocateId));
    }

    if (creature.energy > 0 && creature.age < params.maxAge) {
      nextGeneration.push(creature);
    }
  }

  state.creatures = nextGeneration;
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
