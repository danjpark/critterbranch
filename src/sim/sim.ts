import { type Creature, createCreature, energyCapacity, isReadyToReproduce, reproduce, stepCreature } from "./creature.ts";
import { type Genome, genomeCentroid, randomGenome } from "./genome.ts";
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
}

export interface SimInstance {
  state: SimState;
  rng: RNG;
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

  return { state: { tick: 0, nextId, creatures, world, terrain, foundingCentroid }, rng };
}

/** Advances the sim by exactly one tick, mutating `state` in place. */
export function tick(state: SimState, rng: RNG, params: Params): void {
  regrowFood(state.world, state.tick, params);

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
