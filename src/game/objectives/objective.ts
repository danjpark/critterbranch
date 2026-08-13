import type { SimInstance } from "../../sim/sim.ts";
import type { GameState } from "../gameState.ts";

/**
 * Everything an objective is allowed to look at. Deliberately just the sim instance and game
 * state — an objective consumes observations (taxonomy, population history, creature state, and
 * now game/observability's SpeciesProfile/CapabilityClassifier — see standardObjectives.ts's
 * dietary objectives, which read real demonstrated diet share rather than a genotype proxy, the
 * same "Genome != Capability" principle SpeciesProfile itself was built around), and never
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
