import { computeSpeciesProfiles } from "../observability/speciesProfile.ts";
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

const MIN_DIET_EVIDENCE = 1e-3;

/**
 * Reads real demonstrated diet share (game/observability's SpeciesProfile — Genome != Capability,
 * same principle that layer was built around) rather than a genotype proxy. Removed by Addendum 6
 * when the diet axis went away entirely; back per Addendum 7 reshaped around fruit vs. meat.
 */
function mostDietSpecializedLivingSpecies(context: GameEvaluationContext, minPopulation: number): { speciesId: number; distanceFromBalanced: number } | null {
  const { profiles } = computeSpeciesProfiles(context.sim);
  let best: { speciesId: number; distanceFromBalanced: number } | null = null;
  for (const profile of profiles.values()) {
    if (profile.memberCount < minPopulation || profile.diet.totalConsumed < MIN_DIET_EVIDENCE) continue;
    const distanceFromBalanced = Math.abs(profile.diet.meatShare - 0.5);
    if (!best || distanceFromBalanced > best.distanceFromBalanced) {
      best = { speciesId: profile.speciesId, distanceFromBalanced };
    }
  }
  return best;
}

/** Produce a species whose diet strongly favors one food source over the other. */
export function createDietarySpecialistObjective(minPopulation = 20, threshold = 0.3): GameObjective {
  return {
    id: "dietary-specialist",
    description: "Produce a species whose diet strongly favors one food source (fruit or meat).",
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const best = mostDietSpecializedLivingSpecies(context, minPopulation);
      const complete = best !== null && best.distanceFromBalanced >= threshold;
      return {
        complete,
        currentValue: best?.distanceFromBalanced ?? 0,
        targetValue: threshold,
        message: complete ? `Species ${best!.speciesId} specializes in one food source.` : undefined,
      };
    },
  };
}

/** Produce a species that draws roughly balanced calories from both fruit and meat. */
export function createDietaryGeneralistObjective(minPopulation = 20, threshold = 0.15): GameObjective {
  return {
    id: "dietary-generalist",
    description: "Produce a species whose diet draws roughly evenly from fruit and meat.",
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const { profiles } = computeSpeciesProfiles(context.sim);
      let best: { speciesId: number; distanceFromBalanced: number } | null = null;
      for (const profile of profiles.values()) {
        if (profile.memberCount < minPopulation || profile.diet.totalConsumed < MIN_DIET_EVIDENCE) continue;
        const distanceFromBalanced = Math.abs(profile.diet.meatShare - 0.5);
        if (!best || distanceFromBalanced < best.distanceFromBalanced) {
          best = { speciesId: profile.speciesId, distanceFromBalanced };
        }
      }
      const complete = best !== null && best.distanceFromBalanced <= threshold;
      return {
        complete,
        currentValue: best?.distanceFromBalanced ?? Infinity,
        targetValue: threshold,
        message: complete ? `Species ${best!.speciesId} draws roughly evenly from fruit and meat.` : undefined,
      };
    },
  };
}

/** Produce a species that sustains itself predominantly by hunting, not just an opportunistic kill
 * or two — a real, ongoing carnivore population, not a fluke. */
export function createApexPredatorObjective(minPopulation = 20, meatShareThreshold = 0.7): GameObjective {
  return {
    id: "apex-predator",
    description: `Produce a species of at least ${minPopulation} that draws most of its diet from hunting.`,
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const { profiles } = computeSpeciesProfiles(context.sim);
      let best: { speciesId: number; meatShare: number } | null = null;
      for (const profile of profiles.values()) {
        if (profile.memberCount < minPopulation || profile.diet.totalConsumed < MIN_DIET_EVIDENCE) continue;
        if (!best || profile.diet.meatShare > best.meatShare) {
          best = { speciesId: profile.speciesId, meatShare: profile.diet.meatShare };
        }
      }
      const complete = best !== null && best.meatShare >= meatShareThreshold;
      return {
        complete,
        currentValue: best?.meatShare ?? 0,
        targetValue: meatShareThreshold,
        message: complete ? `Species ${best!.speciesId} sustains a population of ${minPopulation}+ predominantly by hunting.` : undefined,
      };
    },
  };
}

/** Produce a species that spends a real share of its time in water — SPEC.md Addendum 10
 * (Milestone 4: water as a real niche). Reads SpeciesProfile.habitat.waterShare, the same live
 * demonstrated-behavior sample every other habitat label already uses (no decayed-evidence gate
 * the way diet has MIN_DIET_EVIDENCE — habitat is a fresh per-call sample of current creature
 * positions, not an accumulator that can sit at zero evidence). */
export function createAquaticForagerObjective(minPopulation = 20, waterShareThreshold = 0.3): GameObjective {
  return {
    id: "aquatic-forager",
    description: `Produce a species of at least ${minPopulation} that spends a real share of its time in water.`,
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const { profiles } = computeSpeciesProfiles(context.sim);
      let best: { speciesId: number; waterShare: number } | null = null;
      for (const profile of profiles.values()) {
        if (profile.memberCount < minPopulation) continue;
        if (!best || profile.habitat.waterShare > best.waterShare) {
          best = { speciesId: profile.speciesId, waterShare: profile.habitat.waterShare };
        }
      }
      const complete = best !== null && best.waterShare >= waterShareThreshold;
      return {
        complete,
        currentValue: best?.waterShare ?? 0,
        targetValue: waterShareThreshold,
        message: complete ? `Species ${best!.speciesId} sustains a population of ${minPopulation}+ with a real presence in the water.` : undefined,
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

/** Cause a speciation event driven by the amphibious trade-off itself — SPEC.md Addendum 12
 * (Milestone 6), the flagship payoff of the whole water arc. Structurally identical to
 * createGeographicSpeciationObjective above, just matching a different field on the same event:
 * taxonomy's bimodality detector already picks up aquaticAdaptation automatically (it's just
 * another entry in GENE_WEIGHTS) and dominantDivergentGene is already recorded on every promoted
 * split — nothing new to build there, only a new objective reading a field that already exists. */
export function createAmphibiousSpeciationObjective(): GameObjective {
  return {
    id: "amphibious-speciation",
    description: "Cause a speciation event driven by the land/water trade-off — watch one population split into a land branch and a water branch.",
    evaluate(context: GameEvaluationContext): ObjectiveProgress {
      const event = context.sim.state.observations.taxonomyEvents.find(
        (e) => e.type === "speciation" && e.event.dominantDivergentGene === "aquaticAdaptation",
      );
      return {
        complete: event !== undefined,
        message:
          event && event.type === "speciation"
            ? `Species ${event.event.speciesId} split from species ${event.event.parentId}, diverging on land/water adaptation.`
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
