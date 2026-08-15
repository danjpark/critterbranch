import { describe, expect, it } from "vitest";
import { GameRunner } from "./gameRunner.ts";
import { PROTOTYPE_CHALLENGES } from "../game/challenges/prototypeChallenges.ts";
import { advanceGameEra, continueToTerraform, createGame } from "../game/game.ts";
import { DEFAULT_PARAMS } from "../params.ts";
import { hashState } from "../sim/testHash.ts";

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

  it("stepEraAdvance ticks incrementally, ramped up from a slow floor at the start of the era, and does nothing when no era is advancing", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed(10);
    runner.advanceEra();

    // First frame of the era is still inside the opening ramp window (see app/pacing.ts), so it
    // ticks at the ramp's floor speed (1), not the full chosen speed (10) yet.
    runner.stepEraAdvance();
    expect(runner.game.sim.state.evolution.tick).toBe(1);
    expect(runner.isAdvancingEra()).toBe(true);

    const tickBeforeNoOp = runner.game.sim.state.evolution.tick;
    const idleRunner = new GameRunner("sandbox", 1);
    idleRunner.stepEraAdvance(); // no era in progress
    expect(idleRunner.game.sim.state.evolution.tick).toBe(0);
    expect(runner.game.sim.state.evolution.tick).toBe(tickBeforeNoOp);
  });

  it("stepEraAdvance's ramp reaches the full chosen speed once past the opening window (see app/pacing.ts's DEFAULT_RAMP_CONFIG.rampTicks=300)", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed(10);
    runner.advanceEra();

    while (runner.game.sim.state.evolution.tick < 300) runner.stepEraAdvance();
    const tickBeforeFullSpeed = runner.game.sim.state.evolution.tick;
    runner.stepEraAdvance();
    expect(runner.game.sim.state.evolution.tick - tickBeforeFullSpeed).toBe(10);
  });

  it("a normal era (still actively growing, never reaches equilibrium) runs its full tick budget and reports fastForwardedFromTick: null", () => {
    const runner = new GameRunner("sandbox", 1);
    runner.setSpeed("max");
    runner.advanceEra();
    while (runner.isAdvancingEra()) runner.stepEraAdvance();

    expect(runner.lastEraSummary!.fastForwardedFromTick).toBeNull();
    expect(runner.lastEraSummary!.after.tick).toBe(2000);
  });

  // SPEC.md Addendum 19 — the whole point of the fix: equilibrium early-end used to leave
  // after.tick BELOW the planned target (a real divergence from headless replay of the same log).
  // Now it always reaches the exact target tick; only the animation speed for the tail changes.
  it("a later era fast-forwards through a quiet tail once the ecosystem settles into equilibrium, but still simulates every tick up to the exact target (empirically confirmed for this exact seed — see sim/equilibrium.ts's tuning note; re-swept from seed 1 to seed 7 after SPEC.md Addendum 14's carnivory fix shifted population dynamics under DEFAULT_PARAMS)", () => {
    const runner = new GameRunner("sandbox", 7);
    runner.setSpeed("max");
    for (let era = 1; era <= 3; era++) {
      runner.advanceEra();
      while (runner.isAdvancingEra()) runner.stepEraAdvance();
      if (era < 3) runner.continueToTerraform();
    }

    expect(runner.lastEraSummary!.fastForwardedFromTick).not.toBeNull();
    expect(runner.lastEraSummary!.fastForwardedFromTick!).toBeLessThan(runner.lastEraSummary!.after.tick);
    expect(runner.lastEraSummary!.after.tick).toBe(6_000); // 3 eras x 2000 ticks/era, reached exactly
  });

  // SPEC.md Addendum 19 — the actual bug this fix closes: before it, an era that fast-forwarded via
  // equilibrium early-end left the animated GameRunner's sim state with FEWER simulated ticks than
  // a headless replay of the identical seed/eraConfig would produce, silently breaking this
  // project's own "same seed + params + intervention history -> same outcome" determinism
  // guarantee. Same seed (7) and era count (3) as the fast-forward test above, which is exactly the
  // scenario that used to diverge.
  it("the animated path (with fast-forwarding) and the headless path produce byte-identical sim state for the same seed", () => {
    const animated = new GameRunner("sandbox", 7);
    animated.setSpeed("max");
    for (let era = 1; era <= 3; era++) {
      animated.advanceEra();
      while (animated.isAdvancingEra()) animated.stepEraAdvance();
      if (era < 3) animated.continueToTerraform();
    }

    const headless = createGame({ mode: "sandbox", seed: 7, params: DEFAULT_PARAMS, eraConfig: { ticksPerEra: 2000 } });
    for (let era = 1; era <= 3; era++) {
      advanceGameEra(headless);
      if (era < 3) continueToTerraform(headless);
    }

    expect(hashState(animated.game.sim.state)).toBe(hashState(headless.sim.state));
    expect(animated.game.gameState.era).toBe(headless.gameState.era);
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

    // First frame is still inside the opening ramp window (app/pacing.ts), so it ticks at the
    // ramp's floor speed (1), not the full chosen speed (100) yet — see the dedicated ramp test.
    runner.stepEraAdvance();
    expect(runner.eraProgress()).toBeCloseTo(1 / 2000);

    // Progress never lingers at a visible "1" once the era finishes — it goes straight from <1 to
    // null (no longer advancing).
    while (runner.isAdvancingEra()) runner.stepEraAdvance();
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
    const afterFirstPlay = hashState(runnerA.game.sim.state);

    runnerA.restoreCheckpoint(runnerA.listCheckpoints()[0].id);
    expect(runnerA.game.sim.state.evolution.tick).toBe(0);

    runnerA.setActiveTool("raiseTerrain");
    runnerA.useToolAt(50, 50);
    runnerA.setSpeed("max");
    runnerA.advanceEra();
    while (runnerA.isAdvancingEra()) runnerA.stepEraAdvance();

    // Compare the full hashed state, not just the tick count — a tick-only assertion passes even
    // if every creature in the replay ended up somewhere else, which is precisely the divergence
    // this test exists to rule out.
    expect(hashState(runnerA.game.sim.state)).toBe(afterFirstPlay);
    expect(runnerA.game.sim.interventionLog).toHaveLength(1);
  });

  // A checkpoint is a BRANCH, not an undo (see restoreCheckpoint's doc) — so everything the
  // abandoned branch accumulated has to come back to what it was, not just the sim state. The
  // Critterdex journal was the field that didn't: it was neither captured nor restored, so
  // rewinding to era 1 left the player holding discoveries earned in eras they'd just rewound out
  // of, with no way to lose them again.
  it("restoreCheckpoint rewinds the discovery journal along with the sim", () => {
    const runner = new GameRunner("sandbox", 7);
    runner.setSpeed("max");
    const advance = () => {
      runner.advanceEra();
      while (runner.isAdvancingEra()) runner.stepEraAdvance();
      runner.continueToTerraform();
    };

    advance();
    runner.saveCheckpoint("after era 1");
    const streaksAtCheckpoint = new Map(runner.game.discoveryJournal.streaks);
    const matchesAtCheckpoint = new Map(runner.game.discoveryJournal.matches);
    // Guard against a vacuous assertion: the journal has to actually be carrying something by now,
    // otherwise "restored correctly" would pass on two empty maps.
    expect(streaksAtCheckpoint.size).toBeGreaterThan(0);

    advance();
    advance();
    expect(runner.game.discoveryJournal.matches.size).toBeGreaterThan(matchesAtCheckpoint.size);

    runner.restoreCheckpoint(runner.listCheckpoints()[0].id);

    expect(runner.game.discoveryJournal.streaks).toEqual(streaksAtCheckpoint);
    expect(runner.game.discoveryJournal.matches).toEqual(matchesAtCheckpoint);
  });

  // Regression: fastForwardFromTick was the one piece of in-flight era-advance state
  // restoreCheckpoint didn't clear alongside eraTargetTick/eraBeforeSnapshot. Left set, the next
  // advanceEra() takes stepEraAdvance's "already fast-forwarding" branch on its very first frame
  // and burns the whole era at the max-speed budget, ignoring the player's speed setting.
  //
  // Checked structurally rather than through observable ticking: the flag is only ever set in the
  // one-frame window between equilibrium firing and the next stepEraAdvance() call finishing the
  // era, and that window can't be held open from outside the class. The invariant being asserted
  // is "restoreCheckpoint leaves NO in-flight era-advance state behind," which is exactly a
  // statement about these private fields.
  it("restoreCheckpoint clears every piece of in-flight era-advance state", () => {
    const runner = new GameRunner("sandbox", 7);
    runner.setSpeed("max");
    runner.advanceEra();
    while (runner.isAdvancingEra()) runner.stepEraAdvance();
    runner.continueToTerraform();
    runner.saveCheckpoint("after era 1");

    const inFlight = runner as unknown as {
      eraTargetTick: number | null;
      eraBeforeSnapshot: unknown;
      fastForwardFromTick: number | null;
    };
    runner.advanceEra();
    inFlight.fastForwardFromTick = runner.game.sim.state.evolution.tick;

    runner.restoreCheckpoint(runner.listCheckpoints()[0].id);

    expect(runner.isAdvancingEra()).toBe(false);
    expect(inFlight.eraTargetTick).toBeNull();
    expect(inFlight.eraBeforeSnapshot).toBeNull();
    expect(inFlight.fastForwardFromTick).toBeNull();
    expect(runner.lastTerraformError).toBeNull();
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
