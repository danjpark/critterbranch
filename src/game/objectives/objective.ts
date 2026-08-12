import type { SimInstance } from "../../sim/sim.ts";
import type { GameState } from "../gameState.ts";

/**
 * Everything an objective is allowed to look at. Deliberately just the sim instance and game
 * state — an objective consumes observations (taxonomy, population history, creature state),
 * never anything from a future SpeciesProfile/capability layer that doesn't exist yet, and never
 * reaches into UI or render/* state.
 */
export interface GameEvaluationContext {
  sim: SimInstance;
  gameState: GameState;
}

export interface ObjectiveProgress {
  complete: boolean;
  progress?: number;
  currentValue?: number;
  targetValue?: number;
  message?: string;
}

export interface GameObjective {
  id: string;
  description: string;
  evaluate(context: GameEvaluationContext): ObjectiveProgress;
}
