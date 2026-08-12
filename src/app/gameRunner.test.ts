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

  it("advanceEra enters the evolution phase immediately, without ticking yet", () => {
    const runner = new GameRunner("sandbox", 1);
    const tickBefore = runner.game.sim.state.evolution.tick;

    runner.advanceEra();

    expect(runner.game.gameState.phase).toBe("evolution");
    expect(runner.isAdvancingEra()).toBe(true);
    expect(runner.game.sim.state.evolution.tick).toBe(tickBefore);
    expect(runner.canAdvanceEra()).toBe(false);
  });

  it("stepEraAdvance ticks incrementally at the current speed and does nothing when no era is advancing", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed(10);
    runner.advanceEra();

    runner.stepEraAdvance();
    expect(runner.game.sim.state.evolution.tick).toBe(10);
    expect(runner.isAdvancingEra()).toBe(true);

    const tickBeforeNoOp = runner.game.sim.state.evolution.tick;
    const idleRunner = new GameRunner("sandbox", 1);
    idleRunner.stepEraAdvance(); // no era in progress
    expect(idleRunner.game.sim.state.evolution.tick).toBe(0);
    expect(runner.game.sim.state.evolution.tick).toBe(tickBeforeNoOp);
  });

  it("stepEraAdvance finalizes into discovery with an EraSummary once the target tick is reached", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed("max");
    runner.advanceEra();

    while (runner.isAdvancingEra()) runner.stepEraAdvance();

    expect(runner.game.gameState.phase).toBe("discovery");
    expect(runner.game.gameState.era).toBe(1);
    expect(runner.lastEraSummary).not.toBeNull();
    expect(runner.lastEraSummary!.after.tick).toBe(2000);

    runner.continueToTerraform();
    expect(runner.game.gameState.phase).toBe("terraform");
    expect(runner.lastEraSummary).toBeNull();
  });

  it("advanceEra works again directly from discovery, without a separate continueToTerraform call first (regression: button used to stay stuck)", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed("max");

    runner.advanceEra();
    while (runner.isAdvancingEra()) runner.stepEraAdvance();
    expect(runner.game.gameState.phase).toBe("discovery");
    expect(runner.canAdvanceEra()).toBe(true);

    // No continueToTerraform() call here — advanceEra() itself should auto-continue.
    runner.advanceEra();
    expect(runner.game.gameState.phase).toBe("evolution");

    while (runner.isAdvancingEra()) runner.stepEraAdvance();
    expect(runner.game.gameState.phase).toBe("discovery");
    expect(runner.game.gameState.era).toBe(2);
    expect(runner.game.sim.state.evolution.tick).toBe(4000);
  });

  it("canAdvanceEra is false only while actively animating", () => {
    const runner = new GameRunner("sandbox", 1);
    expect(runner.canAdvanceEra()).toBe(true); // terraform

    runner.advanceEra();
    expect(runner.canAdvanceEra()).toBe(false); // evolution

    runner.setSpeed("max");
    while (runner.isAdvancingEra()) runner.stepEraAdvance();
    expect(runner.canAdvanceEra()).toBe(true); // discovery
  });

  it("eraProgress reflects how far through the era's ticks stepEraAdvance has gotten", () => {
    const runner = new GameRunner("sandbox", 1);
    expect(runner.eraProgress()).toBeNull();

    runner.setSpeed(100);
    runner.advanceEra();
    expect(runner.eraProgress()).toBe(0);

    runner.stepEraAdvance();
    expect(runner.eraProgress()).toBeCloseTo(100 / 2000);

    // Nineteen more calls reaches exactly 2000/2000 and finalizes within that same call —
    // progress never lingers at a visible "1", it goes straight from <1 to null (no longer
    // advancing).
    for (let i = 0; i < 19; i++) runner.stepEraAdvance();
    expect(runner.isAdvancingEra()).toBe(false);
    expect(runner.eraProgress()).toBeNull();
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

  it("restart resets to a fresh game, including any in-progress era advance", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.advanceEra();
    expect(runner.isAdvancingEra()).toBe(true);

    runner.restart("sandbox", 2);
    expect(runner.game.gameState.era).toBe(0);
    expect(runner.game.gameState.phase).toBe("terraform");
    expect(runner.lastEraSummary).toBeNull();
    expect(runner.isAdvancingEra()).toBe(false);
  });
});

describe("GameRunner checkpoints", () => {
  it("saveCheckpoint records the current era/tick and listCheckpoints reflects it", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.saveCheckpoint("before drought");

    const checkpoints = runner.listCheckpoints();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].name).toBe("before drought");
    expect(checkpoints[0].era).toBe(0);
    expect(checkpoints[0].tick).toBe(0);
  });

  it("defaults an unnamed checkpoint to a generated name", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.saveCheckpoint("   ");
    expect(runner.listCheckpoints()[0].name).toBe("Checkpoint 1");
  });

  it("restoreCheckpoint jumps the live game back without deleting the checkpoint", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed("max");
    runner.advanceEra();
    while (runner.isAdvancingEra()) runner.stepEraAdvance();
    runner.continueToTerraform();
    runner.saveCheckpoint("after era 1");

    runner.advanceEra();
    while (runner.isAdvancingEra()) runner.stepEraAdvance();
    runner.continueToTerraform();
    expect(runner.game.gameState.era).toBe(2);

    const checkpointId = runner.listCheckpoints()[0].id;
    const restored = runner.restoreCheckpoint(checkpointId);

    expect(restored).toBe(true);
    expect(runner.game.gameState.era).toBe(1);
    expect(runner.game.gameState.phase).toBe("terraform");
    expect(runner.listCheckpoints()).toHaveLength(1); // restoring doesn't delete it
  });

  it("restoring a checkpoint is deterministic: replaying the same actions afterward reproduces the same state", () => {
    const runnerA = new GameRunner("sandbox", 7);
    runnerA.saveCheckpoint("start");
    runnerA.setActiveTool("raiseTerrain");
    runnerA.useToolAt(50, 50);
    runnerA.setSpeed("max");
    runnerA.advanceEra();
    while (runnerA.isAdvancingEra()) runnerA.stepEraAdvance();
    const afterFirstPlay = runnerA.game.sim.state.evolution.tick;

    runnerA.restoreCheckpoint(runnerA.listCheckpoints()[0].id);
    expect(runnerA.game.sim.state.evolution.tick).toBe(0);

    runnerA.setActiveTool("raiseTerrain");
    runnerA.useToolAt(50, 50);
    runnerA.setSpeed("max");
    runnerA.advanceEra();
    while (runnerA.isAdvancingEra()) runnerA.stepEraAdvance();

    expect(runnerA.game.sim.state.evolution.tick).toBe(afterFirstPlay);
    expect(runnerA.game.sim.interventionLog).toHaveLength(1);
  });

  it("restoreCheckpoint returns false for an unknown id and leaves state untouched", () => {
    const runner = new GameRunner("sandbox", 1);
    const result = runner.restoreCheckpoint("does-not-exist");
    expect(result).toBe(false);
    expect(runner.game.gameState.era).toBe(0);
  });

  it("deleteCheckpoint removes only the targeted checkpoint", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.saveCheckpoint("a");
    runner.saveCheckpoint("b");
    const [a, b] = runner.listCheckpoints();

    runner.deleteCheckpoint(a.id);

    const remaining = runner.listCheckpoints();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });

  it("restart clears all checkpoints", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.saveCheckpoint("a");
    runner.restart("sandbox", 2);
    expect(runner.listCheckpoints()).toHaveLength(0);
  });
});
