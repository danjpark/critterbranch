import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createRunConfig } from "../sim/runConfig.ts";
import { runSimulationFromConfig } from "../sim/sim.ts";
import { hashState } from "../sim/testHash.ts";
import type { ChallengeDefinition } from "./challenges/challenge.ts";
import { advanceGameEra, continueToTerraform, createGame, type Game } from "./game.ts";
import type { GameEvaluationContext, GameObjective, ObjectiveProgress } from "./objectives/objective.ts";
import { applyTerraformCommand } from "./terraform.ts";

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
  it("terraform -> advance era -> discovery -> evaluate objective -> continue -> serialize -> replay deterministically", () => {
    const game = createGame({ mode: "sandbox", seed: 7, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });

    const result = applyTerraformCommand(game, "raiseTerrain", {
      x: DEFAULT_PARAMS.worldWidth / 2,
      y: DEFAULT_PARAMS.worldHeight / 2,
      radius: 20,
      strength: 0.5,
    });
    expect(result).toEqual({ ok: true });

    const summary = advanceGameEra(game);

    expect(game.gameState.era).toBe(1);
    expect(game.gameState.phase).toBe("discovery");
    expect(summary.after.tick).toBe(TEST_ERA_CONFIG.ticksPerEra);

    const progress = survivedOneEra.evaluate({ sim: game.sim, gameState: game.gameState });
    expect(progress.complete).toBe(true);

    continueToTerraform(game);
    expect(game.gameState.phase).toBe("terraform");

    const runConfig = createRunConfig(game.sim.seed, game.sim.params, game.sim.interventionLog);
    const replayed = runSimulationFromConfig(runConfig, game.sim.state.evolution.tick);

    expect(hashState(replayed)).toBe(hashState(game.sim.state));
  });
});

describe("challenge mode determinism", () => {
  it("replaying the same terraform actions against a fresh game reproduces identical sim state AND budget", () => {
    const seed = 42;
    const challenge: ChallengeDefinition = {
      id: "t",
      name: "t",
      runConfig: createRunConfig(seed, DEFAULT_PARAMS, []),
      objectives: [],
      terraformBudget: 100,
    };

    function playThrough(): Game {
      const game = createGame({ mode: "challenge", seed, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG, challenge });
      // All three interventions recorded at tick 0, well before the era's final tick — an
      // intervention recorded at exactly totalTicks would be excluded by
      // runSimulationFromConfig's replay loop (ticks < totalTicks, matching tick()'s own
      // before-this-tick semantics), which isn't what this test is checking.
      applyTerraformCommand(game, "raiseTerrain", { x: 50, y: 50, radius: 20, strength: 0.5 });
      applyTerraformCommand(game, "plantTree", { x: 80, y: 80, radius: 10, count: 3 });
      applyTerraformCommand(game, "lowerTerrain", { x: 30, y: 30, radius: 15, strength: 0.3 });
      advanceGameEra(game);
      continueToTerraform(game);
      return game;
    }

    const gameA = playThrough();
    const gameB = playThrough();

    // Not just the raw sim state -- the game-layer bookkeeping (budget, era) that makes this a
    // "challenge" must reconstruct identically too, since that's what M1's replay guarantee
    // actually needs to cover for challenge mode specifically (sandbox mode has no budget to
    // diverge on, which is why this needed its own test).
    expect(hashState(gameA.sim.state)).toBe(hashState(gameB.sim.state));
    expect(gameA.budget).toEqual(gameB.budget);
    expect(gameA.gameState).toEqual(gameB.gameState);
    expect(gameA.budget!.remaining).toBe(100 - 5 - 8 - 5); // raiseTerrain + plantTree + lowerTerrain costs

    // And the underlying sim state matches an independent, config-driven replay too, exactly
    // like the sandbox test above -- proving the sim layer doesn't know or care that this was a
    // "challenge."
    const runConfig = createRunConfig(gameA.sim.seed, gameA.sim.params, gameA.sim.interventionLog);
    const replayed = runSimulationFromConfig(runConfig, gameA.sim.state.evolution.tick);
    expect(hashState(replayed)).toBe(hashState(gameA.sim.state));
  });
});
