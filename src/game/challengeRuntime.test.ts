import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createRunConfig } from "../sim/runConfig.ts";
import { PROTOTYPE_CHALLENGES } from "./challenges/prototypeChallenges.ts";
import { evaluateChallenge } from "./challengeRuntime.ts";
import { createGame } from "./game.ts";
import { createBiodiversityObjective } from "./objectives/standardObjectives.ts";

const TEST_ERA_CONFIG = { ticksPerEra: 50 };

describe("evaluateChallenge", () => {
  it("returns null in sandbox mode", () => {
    const game = createGame({ mode: "sandbox", seed: 1, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });
    expect(evaluateChallenge(game)).toBeNull();
  });

  it("reports incomplete progress for an unmet objective, then complete once satisfied", () => {
    const game = createGame({
      mode: "challenge",
      seed: 1,
      params: DEFAULT_PARAMS,
      eraConfig: TEST_ERA_CONFIG,
      challenge: {
        id: "t",
        name: "t",
        runConfig: createRunConfig(1, DEFAULT_PARAMS, []),
        objectives: [createBiodiversityObjective(2)],
      },
    });

    // The founding population starts as exactly one living species (id 0), so a target of 2 is
    // initially unmet — this only checks evaluateChallenge aggregates correctly, not biology.
    const before = evaluateChallenge(game)!;
    expect(before.allObjectivesComplete).toBe(false);

    const founder = game.sim.state.observations.taxonomy.species.get(0)!;
    game.sim.state.observations.taxonomy.species.set(1, { ...founder, id: 1 });
    const after = evaluateChallenge(game)!;
    expect(after.allObjectivesComplete).toBe(true);
    expect(after.objectiveProgress.get("biodiversity")?.complete).toBe(true);
  });

  it("reports the era limit once reached", () => {
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
        maxEras: 0,
      },
    });
    expect(evaluateChallenge(game)!.eraLimitReached).toBe(true);
  });
});

describe("PROTOTYPE_CHALLENGES", () => {
  it("each challenge is internally consistent and evaluable", () => {
    for (const challenge of PROTOTYPE_CHALLENGES) {
      const game = createGame({ mode: "challenge", seed: challenge.runConfig.seed, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG, challenge });
      expect(game.budget?.remaining).toBe(challenge.terraformBudget);
      const status = evaluateChallenge(game);
      expect(status).not.toBeNull();
      expect(status!.objectiveProgress.size).toBe(challenge.objectives.length);
    }
  });
});
