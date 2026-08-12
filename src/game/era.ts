import { tick } from "../sim/sim.ts";
import type { SimInstance } from "../sim/sim.ts";
import { transitionPhase } from "./gameState.ts";
import type { GameState } from "./gameState.ts";

export interface EraConfig {
  ticksPerEra: number;
}

/** A configurable default, not a scientific constant — challenges may override it. */
export const DEFAULT_ERA_CONFIG: EraConfig = { ticksPerEra: 10_000 };

/** Enters the evolution phase — the first half of advancing an era. Split out from advanceEra()
 * so a caller that wants to animate the ticking (see app/gameRunner.ts's stepEraAdvance) can
 * enter evolution immediately and tick incrementally across render frames instead of blocking. */
export function beginEraEvolution(gameState: GameState): void {
  transitionPhase(gameState, "evolution");
}

/** Increments era and enters discovery — the tail end of advancing an era, after ticking (however
 * it happened) is done. Shared by advanceEra() below and app/gameRunner.ts's animated stepper. */
export function finishEra(gameState: GameState): void {
  gameState.era += 1;
  transitionPhase(gameState, "discovery");
}

/**
 * Advances a game by exactly one era: enters the evolution phase, runs exactly
 * eraConfig.ticksPerEra simulation ticks, increments era, then enters discovery. Mutates
 * gameState and sim in place, matching sim.ts's tick() convention. Throws if gameState isn't
 * currently in the terraform phase — advancing an era mid-evolution or mid-discovery is a bug,
 * not a valid action.
 */
export function advanceEra(gameState: GameState, sim: SimInstance, eraConfig: EraConfig): void {
  beginEraEvolution(gameState);

  for (let i = 0; i < eraConfig.ticksPerEra; i++) {
    tick(sim.state, sim.rng, sim.params);
  }

  finishEra(gameState);
}
