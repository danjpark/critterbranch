import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createSimState } from "../sim/sim.ts";
import { hashState } from "../sim/testHash.ts";
import { advanceEra } from "./era.ts";
import { createGameState } from "./gameState.ts";

const TEST_ERA_CONFIG = { ticksPerEra: 200 };

describe("advanceEra", () => {
  it("runs exactly ticksPerEra sim ticks and ends in the discovery phase", () => {
    const gameState = createGameState("sandbox");
    const sim = createSimState(1, DEFAULT_PARAMS);

    advanceEra(gameState, sim, TEST_ERA_CONFIG);

    expect(sim.state.evolution.tick).toBe(TEST_ERA_CONFIG.ticksPerEra);
    expect(gameState.era).toBe(1);
    expect(gameState.phase).toBe("discovery");
  });

  it("throws if the game isn't in the terraform phase", () => {
    const gameState = createGameState("sandbox");
    const sim = createSimState(1, DEFAULT_PARAMS);
    advanceEra(gameState, sim, TEST_ERA_CONFIG);

    expect(() => advanceEra(gameState, sim, TEST_ERA_CONFIG)).toThrow(/Illegal game phase transition/);
  });

  it("is deterministic: same seed produces the same sim state after one era", () => {
    const gameStateA = createGameState("sandbox");
    const simA = createSimState(42, DEFAULT_PARAMS);
    advanceEra(gameStateA, simA, TEST_ERA_CONFIG);

    const gameStateB = createGameState("sandbox");
    const simB = createSimState(42, DEFAULT_PARAMS);
    advanceEra(gameStateB, simB, TEST_ERA_CONFIG);

    expect(hashState(simA.state)).toBe(hashState(simB.state));
  });
});
