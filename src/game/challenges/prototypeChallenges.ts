import { DEFAULT_PARAMS } from "../../params.ts";
import { createRunConfig } from "../../sim/runConfig.ts";
import { createBiodiversityObjective, createDisasterRecoveryObjective } from "../objectives/standardObjectives.ts";
import type { ChallengeDefinition } from "./challenge.ts";

/** These exist to exercise the objective/budget/challenge systems end to end, not as tuned final
 * content — see roadmap M1-E8-T2.
 *
 * "Picky Eaters" (dietary-specialist objective) is removed for now, not forgotten — SPEC.md
 * Addendum 6 removed the diet trade-off axis entirely (one food type, fruit trees, until
 * predation). Reinstate a diet-specialist-style challenge once part B (predation/meat) gives
 * "dietary specialist" real meaning again. */

export const FORK_THE_FAMILY: ChallengeDefinition = {
  id: "fork-the-family",
  name: "Fork the Family",
  description: "Create four living species from one founding population.",
  runConfig: createRunConfig(1001, DEFAULT_PARAMS, []),
  objectives: [createBiodiversityObjective(4)],
  terraformBudget: 150,
};

export const AFTER_THE_FALL: ChallengeDefinition = {
  id: "after-the-fall",
  name: "After the Fall",
  description: "Trigger a population collapse, then recover biodiversity.",
  runConfig: createRunConfig(1003, DEFAULT_PARAMS, []),
  objectives: [createDisasterRecoveryObjective()],
  terraformBudget: 200,
};

export const PROTOTYPE_CHALLENGES: ChallengeDefinition[] = [FORK_THE_FAMILY, AFTER_THE_FALL];
