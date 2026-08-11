import { describe, expect, it } from "vitest";
import { SimRunner } from "./simRunner.ts";
import { applyIntervention } from "../sim/intervention.ts";
import { createRunConfig, LEGACY_SCHEMA_VERSION, parseRunConfig, RUN_CONFIG_SCHEMA_VERSION } from "../sim/runConfig.ts";
import { hashState } from "../sim/testHash.ts";
import { createSimState, tick } from "../sim/sim.ts";
import { DEFAULT_PARAMS } from "../params.ts";

describe("parseRunConfig", () => {
  it("accepts a well-formed, fully-recorded RunConfig", () => {
    const config = createRunConfig(1, DEFAULT_PARAMS, [
      { tick: 5, tool: "meteor", params: { x: 0, y: 0, radius: 10, craterRecoveryTicks: 0 } },
    ]);
    const parsed = parseRunConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(RUN_CONFIG_SCHEMA_VERSION);
    expect(parsed!.seed).toBe(1);
    expect(parsed!.params).toEqual(DEFAULT_PARAMS);
    expect(parsed!.interventionLog).toHaveLength(1);
  });

  it("migrates a legacy scenario file (no params) onto current defaults with a legacy marker", () => {
    const parsed = parseRunConfig({ seed: 1, interventionLog: [] });
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(parsed!.params).toEqual(DEFAULT_PARAMS);
  });

  it("fills in a field missing from an older recorded config's params with the current default", () => {
    const config = createRunConfig(1, DEFAULT_PARAMS, []);
    const withMissingField = { ...config, params: { ...config.params } } as Record<string, unknown>;
    delete (withMissingField.params as Record<string, unknown>).nursingRatePerTick;

    const parsed = parseRunConfig(withMissingField);
    expect(parsed!.params.nursingRatePerTick).toBe(DEFAULT_PARAMS.nursingRatePerTick);
  });

  it("rejects garbage input", () => {
    expect(parseRunConfig(null)).toBeNull();
    expect(parseRunConfig(42)).toBeNull();
    expect(parseRunConfig({})).toBeNull();
    expect(parseRunConfig({ seed: "not a number", interventionLog: [] })).toBeNull();
    expect(parseRunConfig({ seed: 1, interventionLog: "not an array" })).toBeNull();
    expect(parseRunConfig({ seed: 1, interventionLog: [{ tick: 5 }] })).toBeNull();
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
    expect(scenario.params).toEqual(DEFAULT_PARAMS);
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
    runner.loadScenario(createRunConfig(seed, params, interventionLog));
    for (let i = 0; i < 1000; i++) runner.stepOnce();

    expect(hashState(runner.sim.state)).toBe(hashState(referenceState));
  });

  it("replays with its own recorded params, not whatever DEFAULT_PARAMS happens to be", () => {
    // A RunConfig with a param deliberately different from DEFAULT_PARAMS -- if loadScenario ever
    // regressed to silently using DEFAULT_PARAMS again, this world's dimensions (and therefore
    // its whole simulated history) would diverge from what was actually recorded.
    const customParams = { ...DEFAULT_PARAMS, worldWidth: 80, worldHeight: 80, foundingPopulationSize: 30 };
    const config = createRunConfig(5, customParams, []);

    const runner = new SimRunner(999);
    runner.loadScenario(config);

    expect(runner.sim.params.worldWidth).toBe(80);
    expect(runner.sim.params).not.toEqual(DEFAULT_PARAMS);
    expect(runner.sim.state.world.cols).toBe(80 / customParams.gridCellSize);

    for (let i = 0; i < 200; i++) runner.stepOnce();

    const reference = createSimState(5, customParams);
    for (let i = 0; i < 200; i++) tick(reference.state, reference.rng, customParams);
    expect(hashState(runner.sim.state)).toBe(hashState(reference.state));
  });

  it("does not mutate the RunConfig object passed to loadScenario", () => {
    const config = createRunConfig(3, DEFAULT_PARAMS, [
      { tick: 10, tool: "meteor", params: { x: 0, y: 0, radius: 5, craterRecoveryTicks: 0 } },
    ]);
    const snapshot = JSON.parse(JSON.stringify(config));

    const runner = new SimRunner(1);
    runner.loadScenario(config);
    for (let i = 0; i < 20; i++) runner.stepOnce();

    expect(config).toEqual(snapshot);
  });
});

describe("meteor undo", () => {
  it("undo rewinds state AND the RNG stream, so continued play matches a run where the meteor never happened", () => {
    const seed = 55;
    const N = 300;
    const M = 150;
    const K = 300;

    // Run A: advance N, checkpoint via meteor, advance M, undo, advance K.
    const runnerA = new SimRunner(seed);
    for (let i = 0; i < N; i++) runnerA.stepOnce();

    runnerA.setActiveTool("meteor");
    runnerA.brush.radius = 20;
    runnerA.useToolAt(100, 100);
    expect(runnerA.canUndoMeteor()).toBe(true);

    for (let i = 0; i < M; i++) runnerA.stepOnce();

    runnerA.undoLastMeteor();
    expect(runnerA.canUndoMeteor()).toBe(false);
    for (let i = 0; i < K; i++) runnerA.stepOnce();

    // Run B: same seed, no meteor at all, straight to N + K ticks.
    const runnerB = new SimRunner(seed);
    for (let i = 0; i < N + K; i++) runnerB.stepOnce();

    expect(runnerA.sim.state.tick).toBe(runnerB.sim.state.tick);
    expect(hashState(runnerA.sim.state)).toBe(hashState(runnerB.sim.state));
    expect(runnerA.sim.rng.snapshot()).toEqual(runnerB.sim.rng.snapshot());
    // The undone meteor must not linger in the log -- it never "really" happened.
    expect(runnerA.sim.interventionLog).toEqual(runnerB.sim.interventionLog);
  });
});
