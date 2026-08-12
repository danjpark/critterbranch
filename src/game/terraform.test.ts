import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createRunConfig } from "../sim/runConfig.ts";
import { advanceGameEra, createGame } from "./game.ts";
import { applyTerraformCommand, TERRAFORM_COSTS } from "./terraform.ts";

const TEST_ERA_CONFIG = { ticksPerEra: 50 };
const A_RAISE_TERRAIN = { x: 50, y: 50, radius: 20, strength: 0.5 } as const;

describe("applyTerraformCommand", () => {
  it("applies the intervention and logs it when in the terraform phase", () => {
    const game = createGame({ mode: "sandbox", seed: 1, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });
    const result = applyTerraformCommand(game, "raiseTerrain", A_RAISE_TERRAIN);
    expect(result).toEqual({ ok: true });
    expect(game.sim.interventionLog).toHaveLength(1);
  });

  it("rejects terraforming outside the terraform phase", () => {
    const game = createGame({ mode: "sandbox", seed: 1, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });
    advanceGameEra(game); // leaves the game in the discovery phase
    const result = applyTerraformCommand(game, "raiseTerrain", A_RAISE_TERRAIN);
    expect(result.ok).toBe(false);
    expect(game.sim.interventionLog).toHaveLength(0);
  });

  it("sandbox mode (budget: null) never runs out of terraform points", () => {
    const game = createGame({ mode: "sandbox", seed: 1, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });
    expect(game.budget).toBeNull();
    for (let i = 0; i < 50; i++) {
      expect(applyTerraformCommand(game, "raiseTerrain", A_RAISE_TERRAIN)).toEqual({ ok: true });
    }
  });

  it("challenge mode deducts cost from the fixed budget and rejects once it's exhausted", () => {
    const game = createGame({
      mode: "challenge",
      seed: 1,
      params: DEFAULT_PARAMS,
      eraConfig: TEST_ERA_CONFIG,
      challenge: {
        id: "t",
        name: "t",
        runConfig: createRunConfig(1, DEFAULT_PARAMS, []),
        objectives: [],
        terraformBudget: TERRAFORM_COSTS.raiseTerrain,
      },
    });
    expect(game.budget).toEqual({ remaining: TERRAFORM_COSTS.raiseTerrain });

    const first = applyTerraformCommand(game, "raiseTerrain", A_RAISE_TERRAIN);
    expect(first).toEqual({ ok: true });
    expect(game.budget).toEqual({ remaining: 0 });

    const second = applyTerraformCommand(game, "raiseTerrain", A_RAISE_TERRAIN);
    expect(second.ok).toBe(false);
    expect(game.sim.interventionLog).toHaveLength(1);
  });
});
