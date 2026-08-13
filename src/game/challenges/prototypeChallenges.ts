import { DEFAULT_PARAMS } from "../../params.ts";
import { createRunConfig } from "../../sim/runConfig.ts";
import {
  createApexPredatorObjective,
  createAquaticForagerObjective,
  createBiodiversityObjective,
  createDietarySpecialistObjective,
  createDisasterRecoveryObjective,
} from "../objectives/standardObjectives.ts";
import type { ChallengeDefinition } from "./challenge.ts";

/** These exist to exercise the objective/budget/challenge systems end to end, not as tuned final
 * content — see roadmap M1-E8-T2. */

export const FORK_THE_FAMILY: ChallengeDefinition = {
  id: "fork-the-family",
  name: "Fork the Family",
  description: "Create four living species from one founding population.",
  runConfig: createRunConfig(1001, DEFAULT_PARAMS, []),
  objectives: [createBiodiversityObjective(4)],
  terraformBudget: 150,
};

/** Was removed pending part B (SPEC.md Addendum 6) — back now that carnivory/predation give
 * "dietary specialist" real meaning (fruit vs. meat, not the old R vs. B). */
export const PICKY_EATERS: ChallengeDefinition = {
  id: "picky-eaters",
  name: "Picky Eaters",
  description: "Produce a dietary specialist — a species that leans hard on one food source.",
  runConfig: createRunConfig(1002, DEFAULT_PARAMS, []),
  objectives: [createDietarySpecialistObjective()],
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

export const APEX_PREDATOR: ChallengeDefinition = {
  id: "apex-predator",
  name: "Apex Predator",
  description: "Evolve a species that sustains itself predominantly by hunting.",
  runConfig: createRunConfig(1004, DEFAULT_PARAMS, []),
  objectives: [createApexPredatorObjective()],
  terraformBudget: 150,
};

/** SPEC.md Addendum 10 (Milestone 4: water as a real niche) — named after the roadmap's own
 * "Island Hopper" ticket. The player has to actually use Raise/Lower Sea Level or Raise/Lower
 * Terrain to make water worth wading into (or worth crossing at all) — nothing about the starting
 * map hands this one to you. */
export const ISLAND_HOPPER: ChallengeDefinition = {
  id: "island-hopper",
  name: "Island Hopper",
  description: "Produce a species that spends a real share of its time in water.",
  runConfig: createRunConfig(1005, DEFAULT_PARAMS, []),
  objectives: [createAquaticForagerObjective()],
  terraformBudget: 180,
};

export const PROTOTYPE_CHALLENGES: ChallengeDefinition[] = [FORK_THE_FAMILY, PICKY_EATERS, AFTER_THE_FALL, APEX_PREDATOR, ISLAND_HOPPER];
