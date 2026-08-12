import { DEFAULT_PARAMS } from "../../params.ts";
import { createRunConfig } from "../../sim/runConfig.ts";
import {
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

export const PICKY_EATERS: ChallengeDefinition = {
  id: "picky-eaters",
  name: "Picky Eaters",
  description: "Produce a dietary specialist — a species that leans hard on one food type.",
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

export const PROTOTYPE_CHALLENGES: ChallengeDefinition[] = [FORK_THE_FAMILY, PICKY_EATERS, AFTER_THE_FALL];
