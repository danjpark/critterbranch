import { DISCOVERY_REGISTRY, type DiscoveryCategory, type DiscoveryDefinition } from "./discoveryDefinition.ts";
import { bestStreakFor, DISCOVERY_CONFIRMATION_ERAS, type DiscoveryJournal, type DiscoveryMatch } from "./discoveryJournal.ts";

/**
 * The read model behind the browsable Critterdex (SPEC.md Addendum 24) — "what have I found, what
 * is left, and what is close." Pure: a function of the journal and the registry, computed on
 * demand rather than maintained as state, exactly like game/observability's SpeciesProfile. The
 * journal stays the single source of truth; nothing here feeds back into it.
 *
 * Kept separate from discoveryJournal.ts, which owns advancing and mutating the journal. This
 * module only ever reads it.
 */

/** locked: nothing has ever held it and nothing holds it now. in-progress: some species is part of
 * the way through the consecutive-era confirmation it needs. unlocked: earned, permanently, by the
 * first species to confirm it this run. */
export type CritterdexStatus = "unlocked" | "in-progress" | "locked";

export interface CritterdexEntry {
  definition: DiscoveryDefinition;
  status: CritterdexStatus;
  /** The confirming match, when unlocked — carries the evidence and the era it was earned. */
  match: DiscoveryMatch | null;
  /** Consecutive confirming eras the closest species currently has, 0 when nobody holds it. Stays
   * 0 for an unlocked entry: progress is only meaningful while something is still being earned. */
  streak: number;
  /** How many consecutive eras confirmation takes — carried per entry rather than left for the UI
   * to import, so a future per-discovery requirement doesn't have to change every consumer. */
  requiredStreak: number;
  /** The species currently building that streak, when in-progress. */
  streakSpeciesId: number | null;
}

export interface CritterdexCategoryGroup {
  category: DiscoveryCategory;
  entries: CritterdexEntry[];
  unlockedCount: number;
}

export interface CritterdexSummary {
  entries: CritterdexEntry[];
  /** Registry order, grouped — see summarizeCritterdex for why this is derived rather than a fixed
   * list of category names. */
  groups: CritterdexCategoryGroup[];
  unlockedCount: number;
  totalCount: number;
}

/**
 * Builds the full Critterdex view for a run.
 *
 * Categories are DERIVED from the registry in first-appearance order, never enumerated here. The
 * registry is the one place that decides what discoveries exist and how they're grouped, so adding
 * a category (or a discovery in a new one) shows up in the UI with no change to this module or its
 * consumers. That is the only forward-looking allowance made here: no persistence hooks, no
 * filtering, no non-capability discovery plumbing — Addendum 16 deliberately left those unbuilt,
 * and speculatively building for them now would be inventing requirements.
 */
export function summarizeCritterdex(journal: DiscoveryJournal): CritterdexSummary {
  const entries: CritterdexEntry[] = DISCOVERY_REGISTRY.map((definition) => {
    const match = journal.matches.get(definition.id) ?? null;
    if (match) {
      return { definition, status: "unlocked" as const, match, streak: 0, requiredStreak: DISCOVERY_CONFIRMATION_ERAS, streakSpeciesId: null };
    }
    const best = bestStreakFor(journal, definition.id);
    if (best && best.streak > 0) {
      return {
        definition,
        status: "in-progress" as const,
        match: null,
        streak: best.streak,
        requiredStreak: DISCOVERY_CONFIRMATION_ERAS,
        streakSpeciesId: best.speciesId,
      };
    }
    return { definition, status: "locked" as const, match: null, streak: 0, requiredStreak: DISCOVERY_CONFIRMATION_ERAS, streakSpeciesId: null };
  });

  const groups: CritterdexCategoryGroup[] = [];
  const groupByCategory = new Map<DiscoveryCategory, CritterdexCategoryGroup>();
  for (const entry of entries) {
    let group = groupByCategory.get(entry.definition.category);
    if (!group) {
      group = { category: entry.definition.category, entries: [], unlockedCount: 0 };
      groupByCategory.set(entry.definition.category, group);
      groups.push(group);
    }
    group.entries.push(entry);
    if (entry.status === "unlocked") group.unlockedCount++;
  }

  return {
    entries,
    groups,
    unlockedCount: entries.filter((entry) => entry.status === "unlocked").length,
    totalCount: entries.length,
  };
}
