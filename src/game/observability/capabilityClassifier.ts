import type { PopulationBaseline, SpeciesProfile } from "./speciesProfile.ts";

export type CapabilityLabel =
  | "omnivore"
  | "herbivore"
  | "carnivore"
  | "highland-adapted"
  | "lowland-adapted"
  | "aquatic-adapted"
  | "fast-mover"
  | "sedentary"
  | "r-strategist"
  | "k-strategist"
  | "resilient"
  | "fragile";

/**
 * A label plus why it was assigned — SPEC.md Addendum 5's "evidence" requirement. `confidence` is
 * scaled by the species' memberCount (a thinly-populated species could be one lucky mutation away
 * from looking like anything), not by how far the underlying value sits past its threshold — a
 * species right at a diet threshold with 200 members is still better evidence than one deep past
 * it with 3.
 */
export interface Capability {
  label: CapabilityLabel;
  displayName: string;
  confidence: number;
  evidence: string;
}

// A species with this many living members or more counts as "well-sampled" (confidence 1) —
// somewhat arbitrary, picked as a round number comfortably above the population sizes small
// founder-effect splits tend to produce.
const CONFIDENCE_SATURATION_MEMBER_COUNT = 30;

function memberConfidence(memberCount: number): number {
  return Math.min(1, memberCount / CONFIDENCE_SATURATION_MEMBER_COUNT);
}

// Matches standardObjectives.ts's createDietaryGeneralistObjective/createDietarySpecialistObjective
// thresholds (0.15 / 0.3) exactly, so a species that clears the game's own generalist/specialist
// objective is guaranteed to also carry the matching label here.
const OMNIVORE_THRESHOLD = 0.15;
const SPECIALIST_THRESHOLD = 0.3;

const HIGHLAND_MOUNTAIN_SHARE = 0.3;
const LOWLAND_SHARE = 0.7;
// Matches standardObjectives.ts's createAquaticForagerObjective's default waterShareThreshold
// (SPEC.md Addendum 12) — same reasoning as the diet thresholds above.
const AQUATIC_WATER_SHARE = 0.3;

// Movement/reproduction labels are relative to the current population's own average (see
// PopulationBaseline) — "fast" only means something next to how fast everyone else is moving this
// run, there's no fixed world-units-per-tick threshold that stays meaningful across different
// speed-gene ranges or terrain mixes.
const RELATIVE_HIGH = 1.3;
const RELATIVE_LOW = 0.7;

const VOLATILITY_RESILIENT = 0.15;
const VOLATILITY_FRAGILE = 0.4;

export function classifySpecies(profile: SpeciesProfile, baseline: PopulationBaseline): Capability[] {
  const confidence = memberConfidence(profile.memberCount);
  const capabilities: Capability[] = [];

  const dietDistance = Math.abs(profile.diet.meatShare - 0.5);
  if (profile.diet.totalConsumed > 1e-6) {
    if (dietDistance <= OMNIVORE_THRESHOLD) {
      capabilities.push({
        label: "omnivore",
        displayName: "Omnivore",
        confidence,
        evidence: `Draws ${(profile.diet.meatShare * 100).toFixed(0)}% of intake from meat, ${((1 - profile.diet.meatShare) * 100).toFixed(0)}% from fruit.`,
      });
    } else if (dietDistance >= SPECIALIST_THRESHOLD) {
      const isCarnivore = profile.diet.meatShare > 0.5;
      capabilities.push({
        label: isCarnivore ? "carnivore" : "herbivore",
        displayName: isCarnivore ? "Carnivore" : "Herbivore",
        confidence,
        evidence: `Draws ${(Math.max(profile.diet.meatShare, 1 - profile.diet.meatShare) * 100).toFixed(0)}% of intake from ${isCarnivore ? "meat" : "fruit"}.`,
      });
    }
  }

  if (profile.habitat.mountainShare >= HIGHLAND_MOUNTAIN_SHARE) {
    capabilities.push({
      label: "highland-adapted",
      displayName: "Highland-Adapted",
      confidence,
      evidence: `${(profile.habitat.mountainShare * 100).toFixed(0)}% of members observed in mountain terrain.`,
    });
  } else if (profile.habitat.lowlandShare >= LOWLAND_SHARE) {
    capabilities.push({
      label: "lowland-adapted",
      displayName: "Lowland-Adapted",
      confidence,
      evidence: `${(profile.habitat.lowlandShare * 100).toFixed(0)}% of members observed in lowland terrain.`,
    });
  }

  // Independent of the highland/lowland if-else above — a species' water/land habitat shares
  // aren't mutually exclusive at the species level the way a single member's instantaneous band
  // is, so this gets its own check rather than another else-if branch (SPEC.md Addendum 12).
  if (profile.habitat.waterShare >= AQUATIC_WATER_SHARE) {
    capabilities.push({
      label: "aquatic-adapted",
      displayName: "Aquatic-Adapted",
      confidence,
      evidence: `${(profile.habitat.waterShare * 100).toFixed(0)}% of members observed in water.`,
    });
  }

  if (baseline.averageRealizedSpeed > 1e-9) {
    const ratio = profile.movement.averageRealizedSpeed / baseline.averageRealizedSpeed;
    if (ratio >= RELATIVE_HIGH) {
      capabilities.push({
        label: "fast-mover",
        displayName: "Fast-mover",
        confidence,
        evidence: `Realized speed ${ratio.toFixed(1)}x the current population average.`,
      });
    } else if (ratio <= RELATIVE_LOW) {
      capabilities.push({
        label: "sedentary",
        displayName: "Sedentary",
        confidence,
        evidence: `Realized speed ${ratio.toFixed(1)}x the current population average.`,
      });
    }
  }

  if (baseline.averageBirthsPerCapita > 1e-9) {
    const ratio = profile.reproduction.birthsPerCapita / baseline.averageBirthsPerCapita;
    const lifespanNote = profile.reproduction.averageLifespanAtDeath !== null ? `, average lifespan ${profile.reproduction.averageLifespanAtDeath.toFixed(0)} ticks` : "";
    if (ratio >= RELATIVE_HIGH) {
      capabilities.push({
        label: "r-strategist",
        displayName: "r-strategist",
        confidence,
        evidence: `Births per capita ${ratio.toFixed(1)}x the population average${lifespanNote}.`,
      });
    } else if (ratio <= RELATIVE_LOW) {
      capabilities.push({
        label: "k-strategist",
        displayName: "K-strategist",
        confidence,
        evidence: `Births per capita ${ratio.toFixed(1)}x the population average${lifespanNote}.`,
      });
    }
  }

  if (profile.survival.volatility <= VOLATILITY_RESILIENT && profile.survival.trend !== "declining") {
    capabilities.push({
      label: "resilient",
      displayName: "Resilient",
      confidence,
      evidence: `Population volatility ${(profile.survival.volatility * 100).toFixed(0)}%, trend ${profile.survival.trend}.`,
    });
  } else if (profile.survival.volatility >= VOLATILITY_FRAGILE || profile.survival.trend === "declining") {
    capabilities.push({
      label: "fragile",
      displayName: "Fragile",
      confidence,
      evidence: `Population volatility ${(profile.survival.volatility * 100).toFixed(0)}%, trend ${profile.survival.trend}.`,
    });
  }

  return capabilities;
}
