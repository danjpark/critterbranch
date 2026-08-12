import type { Game } from "./game.ts";
import type { ObjectiveProgress } from "./objectives/objective.ts";

export interface ChallengeStatus {
  objectiveProgress: Map<string, ObjectiveProgress>;
  allObjectivesComplete: boolean;
  eraLimitReached: boolean;
}

/** Evaluates every objective in the active challenge against the current game state. Returns
 * null in sandbox mode (or if the game somehow has no challenge) — there's no win state to track. */
export function evaluateChallenge(game: Game): ChallengeStatus | null {
  if (!game.challenge) return null;

  const objectiveProgress = new Map<string, ObjectiveProgress>();
  for (const objective of game.challenge.objectives) {
    objectiveProgress.set(objective.id, objective.evaluate({ sim: game.sim, gameState: game.gameState }));
  }

  return {
    objectiveProgress,
    allObjectivesComplete: [...objectiveProgress.values()].every((p) => p.complete),
    eraLimitReached: game.challenge.maxEras !== undefined && game.gameState.era >= game.challenge.maxEras,
  };
}
