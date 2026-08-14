import { classifySpecies } from "../observability/capabilityClassifier.ts";
import type { SpeciesProfileSet } from "../observability/speciesProfile.ts";
import type { Game } from "../game.ts";
import { computeSpeciesProfiles } from "../observability/speciesProfile.ts";
import { DISCOVERY_REGISTRY, type DiscoveryId } from "./discoveryDefinition.ts";

export interface DiscoveryMatch {
  definitionId: DiscoveryId;
  speciesId: number;
  firstQualifiedEra: number;
  confirmedEra: number;
  evidence: string;
}

export interface DiscoveryJournal {
  /** First confirming match per definition, this run only (SPEC.md Addendum 16 — no cross-run
   * persistence yet). Absent key = not yet confirmed by any species this run. */
  matches: Map<DiscoveryId, DiscoveryMatch>;
  /** `${speciesId}:${definitionId}` -> consecutive confirming eras so far, reset to 0 the moment a
   * species stops holding that capability. Not pruned when a species goes extinct — a dead
   * species's streak simply never grows again, which is harmless and avoids needing extinction
   * bookkeeping here that taxonomy.ts already owns. */
  streaks: Map<string, number>;
}

export function createDiscoveryJournal(): DiscoveryJournal {
  return { matches: new Map(), streaks: new Map() };
}

/** Consecutive era-boundary confirmations required before a held capability counts as "discovered,"
 * not just glimpsed once — mirrors taxonomy's own two-consecutive-pass philosophy (SPEC.md
 * Addendum 9's bimodality-confirmation fix). A display/classification constant, not a tuned
 * simulation parameter, so (like speciesProfile.ts's SURVIVAL_HISTORY_WINDOW) it's a local constant
 * rather than a Params field. */
export const DISCOVERY_CONFIRMATION_ERAS = 2;

function streakKey(speciesId: number, definitionId: DiscoveryId): string {
  return `${speciesId}:${definitionId}`;
}

/**
 * Advances the journal by one era's worth of observation and returns any discoveries newly
 * confirmed THIS call. Pure aside from returning a fresh journal (caller replaces its stored
 * journal with the returned one, same immutable-update convention as sim/'s clone functions) — safe
 * to call from both the headless (game.ts) and animated (app/gameRunner.ts) era-advance paths
 * without them drifting from each other.
 */
export function evaluateDiscoveries(profiles: SpeciesProfileSet, journal: DiscoveryJournal, era: number): { journal: DiscoveryJournal; newMatches: DiscoveryMatch[] } {
  const matches = new Map(journal.matches);
  const streaks = new Map(journal.streaks);
  const newMatches: DiscoveryMatch[] = [];

  for (const profile of profiles.profiles.values()) {
    const heldEvidence = new Map(classifySpecies(profile, profiles.baseline).map((c) => [c.label, c.evidence]));

    for (const definition of DISCOVERY_REGISTRY) {
      const key = streakKey(profile.speciesId, definition.id);
      if (!heldEvidence.has(definition.id)) {
        streaks.delete(key);
        continue;
      }

      const streak = (streaks.get(key) ?? 0) + 1;
      streaks.set(key, streak);

      if (streak < DISCOVERY_CONFIRMATION_ERAS) continue;
      if (matches.has(definition.id)) continue; // already earned by some species this run

      const match: DiscoveryMatch = {
        definitionId: definition.id,
        speciesId: profile.speciesId,
        firstQualifiedEra: era - (DISCOVERY_CONFIRMATION_ERAS - 1),
        confirmedEra: era,
        evidence: heldEvidence.get(definition.id) ?? "",
      };
      matches.set(definition.id, match);
      newMatches.push(match);
    }
  }

  return { journal: { matches, streaks }, newMatches };
}

/** Convenience wrapper for callers that have a Game rather than a bare SpeciesProfileSet — computes
 * fresh profiles, evaluates, and mutates game.discoveryJournal in place. Called identically from
 * game.ts's headless advanceGameEra and app/gameRunner.ts's animated stepEraAdvance so the two
 * paths can't drift (SPEC.md Addendum 16). */
export function evaluateEraDiscoveries(game: Game): DiscoveryMatch[] {
  const profiles = computeSpeciesProfiles(game.sim);
  const { journal, newMatches } = evaluateDiscoveries(profiles, game.discoveryJournal, game.gameState.era);
  game.discoveryJournal = journal;
  return newMatches;
}
