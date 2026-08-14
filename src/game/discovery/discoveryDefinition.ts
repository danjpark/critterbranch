import type { CapabilityLabel } from "../observability/capabilityClassifier.ts";

/**
 * SPEC.md Addendum 16. V1's finite collectible ID space is exactly CapabilityLabel — every
 * discovery this pass is "a capability, held persistently," not an independent concept yet. Loosen
 * this to a plain string the moment a non-capability-backed discovery (e.g. morphology-based, once
 * that system exists) is actually designed; don't loosen it preemptively.
 */
export type DiscoveryId = CapabilityLabel;

export type DiscoveryCategory = "diet" | "habitat" | "movement" | "life-history" | "survival";

export interface DiscoveryDefinition {
  id: DiscoveryId;
  displayName: string;
  category: DiscoveryCategory;
  /** Authored, player-facing direction while locked — deliberately doesn't name exact gene
   * thresholds (SPEC.md Addendum 16's own "don't leak hidden numbers" principle, matching the
   * mega-doc's discovery-ontology guidance even though this pass has no locked-state UI yet). */
  hint: string;
}

/** One entry per CapabilityLabel, in the same order capabilityClassifier.ts checks them. Kept as a
 * flat literal array (not derived from CapabilityLabel programmatically) so each entry gets a real
 * authored displayName/hint — discoveryJournal.test.ts's registry-validation test is what actually
 * enforces the 1:1 correspondence stays exact as CapabilityLabel evolves. */
export const DISCOVERY_REGISTRY: DiscoveryDefinition[] = [
  { id: "herbivore", displayName: "Herbivore", category: "diet", hint: "A lineage that draws nearly all its energy from fruit." },
  { id: "carnivore", displayName: "Carnivore", category: "diet", hint: "A lineage that draws nearly all its energy from hunting." },
  { id: "omnivore", displayName: "Omnivore", category: "diet", hint: "A lineage that eats a real mix of fruit and meat, neither dominant." },
  { id: "highland-adapted", displayName: "Highland-Adapted", category: "habitat", hint: "A lineage that spends most of its life in mountain terrain." },
  { id: "lowland-adapted", displayName: "Lowland-Adapted", category: "habitat", hint: "A lineage that spends most of its life on low, flat ground." },
  { id: "aquatic-adapted", displayName: "Aquatic-Adapted", category: "habitat", hint: "A lineage that spends a real share of its life in water." },
  { id: "fast-mover", displayName: "Fast-mover", category: "movement", hint: "A lineage that covers noticeably more ground than its neighbors." },
  { id: "sedentary", displayName: "Sedentary", category: "movement", hint: "A lineage that covers noticeably less ground than its neighbors." },
  { id: "r-strategist", displayName: "r-strategist", category: "life-history", hint: "A lineage that breeds fast and cheap, favoring quantity over investment." },
  { id: "k-strategist", displayName: "K-strategist", category: "life-history", hint: "A lineage that breeds slow, investing heavily in fewer offspring." },
  { id: "resilient", displayName: "Resilient", category: "survival", hint: "A lineage whose population holds steady through pressure." },
  { id: "fragile", displayName: "Fragile", category: "survival", hint: "A lineage whose population swings wildly or keeps declining." },
];
