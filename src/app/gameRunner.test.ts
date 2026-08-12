import { describe, expect, it } from "vitest";
import { GameRunner } from "./gameRunner.ts";
import { PROTOTYPE_CHALLENGES } from "../game/challenges/prototypeChallenges.ts";

describe("GameRunner", () => {
  it("starts in sandbox mode with an unlimited budget, era 0, terraform phase", () => {
    const runner = new GameRunner("sandbox", 1);
    expect(runner.game.budget).toBeNull();
    expect(runner.game.gameState.era).toBe(0);
    expect(runner.game.gameState.phase).toBe("terraform");
  });

  it("useToolAt applies the active tool through the terraform command layer", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setActiveTool("raiseTerrain");
    const result = runner.useToolAt(50, 50);
    expect(result).toEqual({ ok: true });
    expect(runner.game.sim.interventionLog).toHaveLength(1);
  });

  it("barrierStamp needs two clicks before applying", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setActiveTool("barrierStamp");
    expect(runner.useToolAt(10, 10)).toBeNull();
    expect(runner.isDraggingBarrier()).toBe(true);
    const result = runner.useToolAt(90, 90);
    expect(result).toEqual({ ok: true });
    expect(runner.isDraggingBarrier()).toBe(false);
  });

  it("advanceEra moves to discovery and populates lastEraSummary; continueToTerraform returns to terraform", () => {
    const runner = new GameRunner("sandbox", 1);
    expect(runner.canAdvanceEra()).toBe(true);

    runner.advanceEra();
    expect(runner.game.gameState.phase).toBe("discovery");
    expect(runner.lastEraSummary).not.toBeNull();
    expect(runner.canAdvanceEra()).toBe(false);

    runner.continueToTerraform();
    expect(runner.game.gameState.phase).toBe("terraform");
    expect(runner.lastEraSummary).toBeNull();
  });

  it("challenge mode tracks a fixed budget and reports objective progress", () => {
    const challenge = PROTOTYPE_CHALLENGES[0];
    const runner = new GameRunner("challenge", challenge.runConfig.seed, challenge);
    expect(runner.game.budget).toEqual({ remaining: challenge.terraformBudget });

    const status = runner.challengeStatus();
    expect(status).not.toBeNull();
    expect(status!.objectiveProgress.size).toBe(challenge.objectives.length);
  });

  it("rejects terraforming once the challenge budget is exhausted", () => {
    const runner = new GameRunner("challenge", 1, {
      id: "t",
      name: "t",
      runConfig: PROTOTYPE_CHALLENGES[0].runConfig,
      objectives: [],
      terraformBudget: 1,
    });
    runner.setActiveTool("raiseTerrain"); // costs 5
    const result = runner.useToolAt(10, 10);
    expect(result?.ok).toBe(false);
    expect(runner.lastTerraformError).not.toBeNull();
  });

  it("restart resets to a fresh game", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.advanceEra();
    runner.restart("sandbox", 2);
    expect(runner.game.gameState.era).toBe(0);
    expect(runner.game.gameState.phase).toBe("terraform");
    expect(runner.lastEraSummary).toBeNull();
  });
});
