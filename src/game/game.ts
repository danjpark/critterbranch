import type { Params } from "../params.ts";
import { createSimState } from "../sim/sim.ts";
import type { SimInstance } from "../sim/sim.ts";
import type { ChallengeDefinition } from "./challenges/challenge.ts";
import { advanceEra, DEFAULT_ERA_CONFIG } from "./era.ts";
import type { EraConfig } from "./era.ts";
import { acknowledgeEraSummary, createGameState } from "./gameState.ts";
import type { GameMode, GameState } from "./gameState.ts";

export interface CreateGameOptions {
  mode: GameMode;
  seed: number;
  params: Params;
  eraConfig?: EraConfig;
  challenge?: ChallengeDefinition;
}

/** The full headless orchestration unit: game-domain state plus the sim instance it drives. */
export interface Game {
  gameState: GameState;
  sim: SimInstance;
  eraConfig: EraConfig;
  challenge: ChallengeDefinition | null;
}

/** Headless entry point — no DOM/canvas/UI dependency, so this can run in a test or CLI tool. */
export function createGame(options: CreateGameOptions): Game {
  return {
    gameState: createGameState(options.mode),
    sim: createSimState(options.seed, options.params),
    eraConfig: options.eraConfig ?? DEFAULT_ERA_CONFIG,
    challenge: options.challenge ?? null,
  };
}

/** Advances the game by one era, then returns it to the terraform phase — the point at which the
 * player next intervenes. Mutates `game` in place, matching sim.ts's tick() convention. */
export function advanceGameEra(game: Game): void {
  advanceEra(game.gameState, game.sim, game.eraConfig);
  acknowledgeEraSummary(game.gameState);
}
