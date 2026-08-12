import { tick } from "../sim/sim.ts";
import type { SimInstance } from "../sim/sim.ts";
import { transitionPhase } from "./gameState.ts";
import type { GameState } from "./gameState.ts";

export interface EraConfig {
  ticksPerEra: number;
}

/** A configurable default, not a scientific constant — challenges may override it. */
export const DEFAULT_ERA_CONFIG: EraConfig = { ticksPerEra: 10_000 };

/**
 * Advances a game by exactly one era: enters the evolution phase, runs exactly
 * eraConfig.ticksPerEra simulation ticks, increments era, then enters discovery. Mutates
 * gameState and sim in place, matching sim.ts's tick() convention. Throws if gameState isn't
 * currently in the terraform phase — advancing an era mid-evolution or mid-discovery is a bug,
 * not a valid action.
 */
export function advanceEra(gameState: GameState, sim: SimInstance, eraConfig: EraConfig): void {
  transitionPhase(gameState, "evolution");

  for (let i = 0; i < eraConfig.ticksPerEra; i++) {
    tick(sim.state, sim.rng, sim.params);
  }

  gameState.era += 1;
  transitionPhase(gameState, "discovery");
}
