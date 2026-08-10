import { describe, expect, it } from "vitest";
import { isScenario, SimRunner } from "./simRunner.ts";
import { applyIntervention } from "../sim/intervention.ts";
import { hashState } from "../sim/testHash.ts";
import { createSimState, tick } from "../sim/sim.ts";
import { DEFAULT_PARAMS } from "../params.ts";

describe("isScenario", () => {
  it("accepts a well-formed scenario", () => {
    expect(isScenario({ seed: 1, interventionLog: [] })).toBe(true);
    expect(
      isScenario({
        seed: 1,
        interventionLog: [{ tick: 5, tool: "meteor", params: { x: 0, y: 0, radius: 10, craterRecoveryTicks: 0 } }],
      }),
    ).toBe(true);
  });

  it("rejects garbage input", () => {
    expect(isScenario(null)).toBe(false);
    expect(isScenario(42)).toBe(false);
    expect(isScenario({})).toBe(false);
    expect(isScenario({ seed: "not a number", interventionLog: [] })).toBe(false);
    expect(isScenario({ seed: 1, interventionLog: "not an array" })).toBe(false);
    expect(isScenario({ seed: 1, interventionLog: [{ tick: 5 }] })).toBe(false);
  });
});

describe("SimRunner scenario load/export", () => {
  it("exports the exact seed and log that were applied live", () => {
    const runner = new SimRunner(7);
    runner.setActiveTool("meteor");
    runner.brush.radius = 20;
    runner.brush.durationTicks = 50;
    runner.useToolAt(50, 50);

    const scenario = runner.exportScenario();
    expect(scenario.seed).toBe(7);
    expect(scenario.interventionLog).toHaveLength(1);
    expect(scenario.interventionLog[0].tool).toBe("meteor");
  });

  it("loading a scenario and playing it forward reproduces the same state as applying the interventions directly", () => {
    const seed = 21;
    const params = DEFAULT_PARAMS;

    // Reference run: apply the intervention directly via the headless sim.
    const { state: referenceState, rng: referenceRng } = createSimState(seed, params);
    for (let i = 0; i < 500; i++) tick(referenceState, referenceRng, params);
    const interventionLog = [
      { tick: 500, tool: "seedFounders" as const, params: { x: 80, y: 80, spreadRadius: 3, count: 5, genome: "random" as const } },
    ];
    // Apply it the same way the scenario player will (see SimRunner.stepOneTick).
    applyIntervention(referenceState, referenceRng, params, interventionLog[0]);
    for (let i = 0; i < 500; i++) tick(referenceState, referenceRng, params);

    // Scenario run: load it into a fresh SimRunner and drive it forward via stepOnce, exactly
    // like a user pressing Step (or Play) would.
    const runner = new SimRunner(999); // seed here should be fully overridden by loadScenario
    runner.loadScenario({ seed, interventionLog });
    for (let i = 0; i < 1000; i++) runner.stepOnce();

    expect(hashState(runner.sim.state)).toBe(hashState(referenceState));
  });
});
