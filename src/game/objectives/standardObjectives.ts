import type { GameEvaluationContext, GameObjective, ObjectiveProgress } from "./objective.ts";

/** Maintain at least `minSpecies` living species at the same time. */
export function createBiodiversityObjective(minSpecies = 4): GameObjective {
  return {
    id: "biodiversity",
    description: `Maintain at least ${minSpecies} living species simultaneously.`,
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      let living = 0;
      for (const species of context.sim.state.observations.taxonomy.species.values()) {
        if (species.extinctTick === null) living++;
      }
      return {
        complete: living >= minSpecies,
        currentValue: living,
        targetValue: minSpecies,
        progress: Math.min(1, living / minSpecies),
      };
    },
  };
}

/**
 * dietPref (a gene already aggregated per-species as Species.centroid) is the existing biology
 * that determines realized diet: gainPerUnit() in sim/creature.ts pays off food type R at
 * (1-dietPref)^k and food type B at dietPref^k, so a centroid near 0 or 1 means a species is
 * realistically extracting most of its calories from a single food type. Using the centroid
 * directly — rather than building new per-species consumption-by-food-type tracking — is the
 * "smallest possible observation extension" the roadmap calls for at this milestone; real
 * calorie-share tracking is Milestone 2's SpeciesProfile.
 */
function mostDietSpecializedLivingSpecies(
  context: GameEvaluationContext,
  minPopulation: number,
): { speciesId: number; distanceFromBalanced: number } | null {
  let best: { speciesId: number; distanceFromBalanced: number } | null = null;
  for (const species of context.sim.state.observations.taxonomy.species.values()) {
    if (species.extinctTick !== null || species.memberCount < minPopulation) continue;
    const distanceFromBalanced = Math.abs(species.centroid.dietPref - 0.5);
    if (!best || distanceFromBalanced > best.distanceFromBalanced) {
      best = { speciesId: species.id, distanceFromBalanced };
    }
  }
  return best;
}

/** Produce a species whose diet strongly favors one food type over the other. */
export function createDietarySpecialistObjective(minPopulation = 20, threshold = 0.3): GameObjective {
  return {
    id: "dietary-specialist",
    description: "Produce a species whose diet strongly favors one food type.",
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const best = mostDietSpecializedLivingSpecies(context, minPopulation);
      const complete = best !== null && best.distanceFromBalanced >= threshold;
      return {
        complete,
        currentValue: best?.distanceFromBalanced ?? 0,
        targetValue: threshold,
        message: complete ? `Species ${best!.speciesId} specializes in one food type.` : undefined,
      };
    },
  };
}

/** Produce a species that draws roughly balanced calories from both food types. */
export function createDietaryGeneralistObjective(minPopulation = 20, threshold = 0.15): GameObjective {
  return {
    id: "dietary-generalist",
    description: "Produce a species whose diet draws roughly evenly from both food types.",
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      let best: { speciesId: number; distanceFromBalanced: number } | null = null;
      for (const species of context.sim.state.observations.taxonomy.species.values()) {
        if (species.extinctTick !== null || species.memberCount < minPopulation) continue;
        const distanceFromBalanced = Math.abs(species.centroid.dietPref - 0.5);
        if (!best || distanceFromBalanced < best.distanceFromBalanced) {
          best = { speciesId: species.id, distanceFromBalanced };
        }
      }
      const complete = best !== null && best.distanceFromBalanced <= threshold;
      return {
        complete,
        currentValue: best?.distanceFromBalanced ?? Infinity,
        targetValue: threshold,
        message: complete ? `Species ${best!.speciesId} generalizes across both food types.` : undefined,
      };
    },
  };
}

/** Cause a geography-driven (allopatric) speciation event — a barrier separating two populations. */
export function createGeographicSpeciationObjective(): GameObjective {
  return {
    id: "geographic-speciation",
    description: "Cause an allopatric (geography-driven) speciation event.",
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const event = context.sim.state.observations.taxonomyEvents.find(
        (e) => e.type === "speciation" && e.event.mechanism === "allopatric",
      );
      return {
        complete: event !== undefined,
        message:
          event && event.type === "speciation"
            ? `Species ${event.event.speciesId} split allopatrically from species ${event.event.parentId}.`
            : undefined,
      };
    },
  };
}

/** Survive a significant decline in living-species count, then recover to at least `minSpecies`. */
export function createDisasterRecoveryObjective(minSpecies = 4, declineFraction = 0.4): GameObjective {
  return {
    id: "disaster-recovery",
    description: `Recover to at least ${minSpecies} species after losing at least ${Math.round(declineFraction * 100)}% of living species from a peak.`,
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const history = context.sim.state.observations.populationHistory;
      let peak = 0;
      let sawQualifyingDecline = false;
      let current = 0;
      for (const sample of history) {
        current = Object.keys(sample.counts).length;
        if (current > peak) {
          peak = current;
        } else if (peak > 0 && current <= peak * (1 - declineFraction)) {
          sawQualifyingDecline = true;
        }
      }
      return {
        complete: sawQualifyingDecline && current >= minSpecies,
        currentValue: current,
        targetValue: minSpecies,
        message: sawQualifyingDecline ? undefined : "No qualifying decline observed yet.",
      };
    },
  };
}
