import type { Params } from "../params.ts";
import { createSimState } from "../sim/sim.ts";
import type { SimInstance } from "../sim/sim.ts";
import type { ChallengeDefinition } from "./challenges/challenge.ts";
import { createDiscoveryJournal, evaluateEraDiscoveries } from "./discovery/discoveryJournal.ts";
import type { DiscoveryJournal } from "./discovery/discoveryJournal.ts";
import { advanceEra, DEFAULT_ERA_CONFIG } from "./era.ts";
import type { EraConfig } from "./era.ts";
import { captureEraSnapshot, computeEraDelta, computeNotableTraitShifts } from "./eraSummary.ts";
import type { EraSummary } from "./eraSummary.ts";
import { acknowledgeEraSummary, createGameState } from "./gameState.ts";
import type { GameMode, GameState } from "./gameState.ts";
import type { TerraformBudgetState } from "./terraform.ts";

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
  /** null = unlimited (sandbox). Challenge mode gets one fixed total budget for the whole
   * challenge, not a per-era refresh — see terraform.ts and roadmap M1-E3-T2. */
  budget: TerraformBudgetState | null;
  /** Run-local Critterdex journal (SPEC.md Addendum 16) — deliberately not part of SimState, since
   * it observes demonstrated capability the same way SpeciesProfile does and must never feed back
   * into evolution ("Genome != Capability" extends to "Discovery != Capability" too). */
  discoveryJournal: DiscoveryJournal;
}

/** Headless entry point — no DOM/canvas/UI dependency, so this can run in a test or CLI tool. */
export function createGame(options: CreateGameOptions): Game {
  return {
    gameState: createGameState(options.mode),
    sim: createSimState(options.seed, options.params),
    eraConfig: options.eraConfig ?? DEFAULT_ERA_CONFIG,
    challenge: options.challenge ?? null,
    budget: options.mode === "challenge" ? { remaining: options.challenge?.terraformBudget ?? 0 } : null,
    discoveryJournal: createDiscoveryJournal(),
  };
}

/** Advances the game by one era and returns a summary of what changed. Leaves the game in the
 * discovery phase (mutating gameState/sim in place, matching sim.ts's tick() convention) so the
 * player can review the summary before acting again — call continueToTerraform() to proceed. */
export function advanceGameEra(game: Game): EraSummary {
  const before = captureEraSnapshot(game);
  advanceEra(game.gameState, game.sim, game.eraConfig);
  const after = captureEraSnapshot(game);
  const newDiscoveries = evaluateEraDiscoveries(game);
  return {
    before,
    after,
    delta: computeEraDelta(before, after),
    notableTraitShifts: computeNotableTraitShifts(game, before.tick, after.tick),
    // This is the blocking/headless path (era.ts's advanceEra, not app/gameRunner.ts's animated
    // stepEraAdvance) — no animation to speed up, so fast-forwarding never applies here.
    fastForwardedFromTick: null,
    newDiscoveries,
  };
}

/** The player has reviewed the Era Summary and is ready to terraform again. */
export function continueToTerraform(game: Game): void {
  acknowledgeEraSummary(game.gameState);
}
