import type { RunConfig } from "../../sim/runConfig.ts";
import type { GameObjective } from "../objectives/objective.ts";

/**
 * Everything needed to recreate a challenge's deterministic starting conditions and evaluate its
 * win state. runConfig carries the seed/params (its interventionLog should be empty here — a
 * challenge defines a starting point for the player to act on, not a pre-scripted playthrough).
 */
export interface ChallengeDefinition {
  id: string;
  name: string;
  description?: string;
  runConfig: RunConfig;
  objectives: GameObjective[];
  terraformBudget?: number;
  maxEras?: number;
}
