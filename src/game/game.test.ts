import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createRunConfig } from "../sim/runConfig.ts";
import { applyInterventionNow, runSimulationFromConfig } from "../sim/sim.ts";
import { hashState } from "../sim/testHash.ts";
import { advanceGameEra, createGame } from "./game.ts";
import type { GameEvaluationContext, GameObjective, ObjectiveProgress } from "./objectives/objective.ts";

const TEST_ERA_CONFIG = { ticksPerEra: 150 };

/** Trivial objective proving the GameObjective contract can be evaluated headlessly, without
 * depending on any biology-specific observation infrastructure (that's Milestone 2's job). */
const survivedOneEra: GameObjective = {
  id: "survived-one-era",
  description: "Survive to the end of era 1 with at least one creature alive.",
  evaluate(context: GameEvaluationContext): ObjectiveProgress {
    const population = context.sim.state.evolution.creatures.length;
    return {
      complete: context.gameState.era >= 1 && population > 0,
      currentValue: population,
    };
  },
};

describe("createGame", () => {
  it("initializes headlessly at era 0 in the terraform phase", () => {
    const game = createGame({ mode: "sandbox", seed: 7, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });
    expect(game.gameState).toEqual({ mode: "sandbox", era: 0, phase: "terraform" });
    expect(game.sim.state.evolution.tick).toBe(0);
    expect(game.challenge).toBeNull();
  });
});

describe("full headless lifecycle", () => {
  it("terraform -> advance era -> evaluate objective -> serialize -> replay deterministically", () => {
    const game = createGame({ mode: "sandbox", seed: 7, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });

    // Terraform phase: apply a god-mode intervention, the way live play will eventually route
    // through the game layer (Milestone 1's terraform command layer).
    applyInterventionNow(game.sim, game.sim.params, "raiseTerrain", {
      x: DEFAULT_PARAMS.worldWidth / 2,
      y: DEFAULT_PARAMS.worldHeight / 2,
      radius: 20,
      strength: 0.5,
    });

    advanceGameEra(game);

    expect(game.gameState.era).toBe(1);
    expect(game.gameState.phase).toBe("terraform");

    const progress = survivedOneEra.evaluate({ sim: game.sim, gameState: game.gameState });
    expect(progress.complete).toBe(true);

    const runConfig = createRunConfig(game.sim.seed, game.sim.params, game.sim.interventionLog);
    const replayed = runSimulationFromConfig(runConfig, game.sim.state.evolution.tick);

    expect(hashState(replayed)).toBe(hashState(game.sim.state));
  });
});
