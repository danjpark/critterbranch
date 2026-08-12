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

// createDietarySpecialistObjective/createDietaryGeneralistObjective lived here until SPEC.md
// Addendum 6 removed the diet trade-off axis (dietPref, two food types) entirely in favor of
// single-food-type fruit trees — "dietary specialist/generalist" has no meaning without a second
// food source to specialize against. Reinstate once part B (predation/meat) gives diet real
// meaning again, reshaped around fruit-vs-meat preference rather than R-vs-B.

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
