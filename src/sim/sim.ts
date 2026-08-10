import { type Creature, createCreature, energyCapacity, stepCreature } from "./creature.ts";
import { mutate, randomGenome } from "./genome.ts";
import { RNG } from "./rng.ts";
import { generateTerrain, type TerrainGrid } from "./terrain.ts";
import { lerp, wrap } from "./util.ts";
import { generateWorld, regrowFood, type World } from "./world.ts";
import type { Params } from "../ui/params.ts";

export interface SimState {
  tick: number;
  nextId: number;
  creatures: Creature[];
  world: World;
  terrain: TerrainGrid;
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
    const x = rng.nextRange(0, params.worldWidth);
    const y = rng.nextRange(0, params.worldHeight);
    // Deliberately below the lowest possible reproThreshold (0.4) so founders must forage
    // before reproducing, rather than instantly cascading off their starting endowment.
    const startEnergy = energyCapacity(genome, params) * 0.35;
    creatures.push(createCreature(nextId++, null, 0, genome, x, y, startEnergy, 0, rng));
  }

  return { state: { tick: 0, nextId, creatures, world, terrain }, rng };
}

/** Advances the sim by exactly one tick, mutating `state` in place. */
export function tick(state: SimState, rng: RNG, params: Params): void {
  regrowFood(state.world, state.tick, params);

  const survivors: Creature[] = [];
  const newborns: Creature[] = [];

  for (const creature of state.creatures) {
    stepCreature(creature, state.world, state.terrain, rng, params);

    const capacity = energyCapacity(creature.genome, params);
    if (creature.energy >= creature.genome.reproThreshold * capacity) {
      const numOffspring = Math.max(1, Math.round(lerp(params.maxOffspringCount, 1, creature.genome.offspringInvestment)));
      const investmentFraction = lerp(
        params.offspringEnergyFractionMin,
        params.offspringEnergyFractionMax,
        creature.genome.offspringInvestment,
      );

      const childGenomes = Array.from({ length: numOffspring }, () => mutate(creature.genome, rng));
      const childEnergies = childGenomes.map((g) => investmentFraction * energyCapacity(g, params));
      const totalCost = childEnergies.reduce((sum, e) => sum + e, 0);

      // Never let reproduction push the parent below zero, even if a lucky mutation
      // briefly inflated a child's capacity beyond what the parent can actually fund.
      const affordableFraction = totalCost > 0 ? Math.min(1, creature.energy / totalCost) : 1;
      creature.energy -= totalCost * affordableFraction;

      for (let i = 0; i < numOffspring; i++) {
        const cx = wrap(creature.x + rng.nextRange(-1, 1), params.worldWidth);
        const cy = wrap(creature.y + rng.nextRange(-1, 1), params.worldHeight);
        newborns.push(
          createCreature(
            state.nextId++,
            creature.id,
            creature.lineageId,
            childGenomes[i],
            cx,
            cy,
            childEnergies[i] * affordableFraction,
            state.tick,
            rng,
          ),
        );
      }
    }

    if (creature.energy > 0 && creature.age < params.maxAge) {
      survivors.push(creature);
    }
  }

  state.creatures = survivors.concat(newborns);
  state.tick += 1;
}
