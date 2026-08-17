import { describe, expect, it } from "vitest";
import { SimRunner } from "./simRunner.ts";
import { applyIntervention } from "../sim/intervention.ts";
import { createRunConfig, LEGACY_SCHEMA_VERSION, parseRunConfig, RUN_CONFIG_SCHEMA_VERSION } from "../sim/runConfig.ts";
import { hashState } from "../sim/testHash.ts";
import { createSimState, runSimulationFromConfig, tick } from "../sim/sim.ts";
import { DEFAULT_PARAMS, DEFAULT_RUN_PARAMS } from "../params.ts";

describe("parseRunConfig", () => {
  it("accepts a well-formed, fully-recorded RunConfig", () => {
    const config = createRunConfig(1, DEFAULT_PARAMS, [
      { tick: 5, tool: "meteor", params: { x: 0, y: 0, radius: 10, craterRecoveryTicks: 0 } },
    ]);
    const parsed = parseRunConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(RUN_CONFIG_SCHEMA_VERSION);
    expect(parsed!.seed).toBe(1);
    expect(parsed!.params).toEqual(DEFAULT_RUN_PARAMS);
    expect(parsed!.interventionLog).toHaveLength(1);
  });

  it("migrates a legacy scenario file (no params) onto current defaults with a legacy marker", () => {
    const parsed = parseRunConfig({ seed: 1, interventionLog: [] });
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(parsed!.params).toEqual(DEFAULT_RUN_PARAMS);
  });

  it("migrates a schema-1 (flat params) config by grouping it", () => {
    const flatConfig = { schemaVersion: 1, engineVersion: "0.6.0", seed: 1, params: DEFAULT_PARAMS, interventionLog: [] };
    const parsed = parseRunConfig(flatConfig);
    expect(parsed).not.toBeNull();
    expect(parsed!.params).toEqual(DEFAULT_RUN_PARAMS);
  });

  it("fills in a field missing from an older recorded config's params with the current default", () => {
    const config = createRunConfig(1, DEFAULT_PARAMS, []);
    const withMissingField = { ...config, params: { ...config.params, reproduction: { ...config.params.reproduction } } } as Record<string, unknown>;
    delete (withMissingField.params as { reproduction: Record<string, unknown> }).reproduction.nursingRatePerTick;

    const parsed = parseRunConfig(withMissingField);
    expect(parsed!.params.reproduction.nursingRatePerTick).toBe(DEFAULT_PARAMS.nursingRatePerTick);
  });

  it("rejects garbage input", () => {
    expect(parseRunConfig(null)).toBeNull();
    expect(parseRunConfig(42)).toBeNull();
    expect(parseRunConfig({})).toBeNull();
    expect(parseRunConfig({ seed: "not a number", interventionLog: [] })).toBeNull();
    expect(parseRunConfig({ seed: 1, interventionLog: "not an array" })).toBeNull();
    expect(parseRunConfig({ seed: 1, interventionLog: [{ tick: 5 }] })).toBeNull();
  });

  // Shape-checking every field is present says nothing about whether its VALUE can be run. These
  // are the values that used to sail straight through into the sim and break it silently rather
  // than loudly — see params.ts's sanitizeParams for what each one does downstream.
  it("repairs individually-dangerous param VALUES that a shape check alone lets through", () => {
    const config = createRunConfig(1, DEFAULT_PARAMS, []);
    const poisoned = {
      ...config,
      params: {
        ...config.params,
        // NaN through every fruit cell, then every creature's energy, then a total silent extinction.
        world: { ...config.params.world, regrowthCyclePeriod: 0 },
        // `tick % 0` is NaN, which never equals 0 — speciation detection and all history sampling
        // simply never run again, with nothing on screen to say so.
        taxonomy: { ...config.params.taxonomy, taxonomyIntervalTicks: 0 },
      },
    };

    const parsed = parseRunConfig(JSON.parse(JSON.stringify(poisoned)));

    expect(parsed).not.toBeNull();
    expect(parsed!.params.world.regrowthCyclePeriod).toBeGreaterThan(0);
    expect(parsed!.params.taxonomy.taxonomyIntervalTicks).toBeGreaterThan(0);
  });

  it("runs a repaired config to completion instead of NaN-poisoning the whole population", () => {
    const config = createRunConfig(1, DEFAULT_PARAMS, []);
    const poisoned = { ...config, params: { ...config.params, world: { ...config.params.world, regrowthCyclePeriod: 0 } } };

    const parsed = parseRunConfig(JSON.parse(JSON.stringify(poisoned)))!;
    const state = runSimulationFromConfig(parsed, 200);

    expect(state.evolution.creatures.length).toBeGreaterThan(0);
    expect(Array.from(state.evolution.world.fruit).every((f) => Number.isFinite(f))).toBe(true);
    expect(state.evolution.creatures.every((c) => Number.isFinite(c.energy))).toBe(true);
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
    expect(scenario.params).toEqual(DEFAULT_RUN_PARAMS);
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
    applyIntervention(referenceState.evolution, referenceRng, params, interventionLog[0]);
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
    expect(runner.sim.state.evolution.world.cols).toBe(80 / customParams.gridCellSize);

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

describe("SimRunner autoPace", () => {
  it("defaults to off, leaving isFastForwarding() false regardless of sim state", () => {
    const runner = new SimRunner(1);
    expect(runner.autoPace).toBe(false);
    expect(runner.isFastForwarding()).toBe(false);
  });

  it("ramps up from the floor speed right after construction when enabled", () => {
    const runner = new SimRunner(1);
    runner.setAutoPace(true);
    runner.setSpeed(10);
    runner.playing = true;

    runner.advance();
    expect(runner.sim.state.evolution.tick).toBe(1); // DEFAULT_RAMP_CONFIG.floorSpeedTicks
  });

  it("ramps back down to the floor right after a fresh intervention, not just at construction", () => {
    const runner = new SimRunner(1);
    runner.setAutoPace(true);
    runner.setSpeed(10);
    runner.playing = true;
    for (let i = 0; i < 50; i++) runner.advance(); // well past the ramp window

    runner.setActiveTool("plantTree");
    runner.useToolAt(50, 50);
    const tickAfterIntervention = runner.sim.state.evolution.tick;

    runner.advance();
    expect(runner.sim.state.evolution.tick - tickAfterIntervention).toBe(1);
  });

  // Empirically confirmed for this exact seed — see sim/equilibrium.ts's tuning note, same
  // underlying data as gameRunner.test.ts's early-end test. Re-swept from seed 1 to seed 7 after
  // SPEC.md Addendum 14's carnivory fix shifted population dynamics under DEFAULT_PARAMS. Window
  // moved from 5000/5700 to 3000/5000 after sim/trees.ts's per-cell regrowth fix: seed 7 now
  // settles at tick 4901 rather than ~5700, so the old "still changing" checkpoint at 5000 had
  // fallen on the far side of equilibrium. The seed and the contract are unchanged — a stable
  // ecosystem still has to read unstable while it's genuinely still moving, then stable once it
  // isn't. The 3000-tick lower bound is well past DEFAULT_RAMP_CONFIG.rampTicks (300), so it tests
  // the equilibrium check itself, not the opening ramp.
  it("fast-forwards once the ecosystem has been stable for a while, and not before", () => {
    // Re-swept from seed 7 to seed 3 after SPEC.md Addendum 31 quadrupled the world: a 400x400 map
    // supports a far larger carrying capacity and takes correspondingly longer to reach it, so most
    // seeds are still climbing well past the old 5,000-tick horizon. Measured directly over seeds
    // 1/3/5/7 out to 16,000 ticks: only seed 3 settles at all (tick 6,501); 1, 5 and 7 never do,
    // with seed 7 still growing at 3,314 creatures when the probe ended. See the summary in
    // Addendum 31 — that the fast-forward now rarely fires is a balance consequence of the resize,
    // not a defect in the detector, whose tolerances are all fractional and so scale-invariant.
    const runner = new SimRunner(3);
    for (let i = 0; i < 3000; i++) runner.stepOnce();

    runner.setAutoPace(true);
    runner.setSpeed(10);
    expect(runner.isFastForwarding()).toBe(false); // still actively changing this early

    for (let i = 0; i < 4500; i++) runner.stepOnce();
    expect(runner.isFastForwarding()).toBe(true);

    // Fast-forwarding routes through the same time-boxed budget "max" speed uses (see advance()),
    // not the ramped/flat per-frame count — the exact tick delta a single call produces depends on
    // machine speed, so isFastForwarding() above (a deterministic read of the same decision
    // advance() makes) is the real behavioral assertion here.
    runner.playing = true;
    const before = runner.sim.state.evolution.tick;
    runner.advance();
    expect(runner.sim.state.evolution.tick).toBeGreaterThan(before);
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

    expect(runnerA.sim.state.evolution.tick).toBe(runnerB.sim.state.evolution.tick);
    expect(hashState(runnerA.sim.state)).toBe(hashState(runnerB.sim.state));
    expect(runnerA.sim.rng.snapshot()).toEqual(runnerB.sim.rng.snapshot());
    // The undone meteor must not linger in the log -- it never "really" happened.
    expect(runnerA.sim.interventionLog).toEqual(runnerB.sim.interventionLog);
  });
});
