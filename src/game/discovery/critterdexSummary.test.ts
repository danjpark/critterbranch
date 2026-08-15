import { describe, expect, it } from "vitest";
import { DISCOVERY_REGISTRY } from "./discoveryDefinition.ts";
import { createDiscoveryJournal, DISCOVERY_CONFIRMATION_ERAS, type DiscoveryJournal, type DiscoveryMatch } from "./discoveryJournal.ts";
import { summarizeCritterdex } from "./critterdexSummary.ts";

function match(definitionId: DiscoveryMatch["definitionId"], speciesId = 1): DiscoveryMatch {
  return { definitionId, speciesId, firstQualifiedEra: 2, confirmedEra: 3, evidence: "measured evidence" };
}

/** Mirrors how evaluateDiscoveries keys its streak table, without reaching into that encoding from
 * the test — a journal built through the public shape, so this stays honest if the key changes. */
function journalWith(options: { matches?: DiscoveryMatch[]; streaks?: [number, string, number][] } = {}): DiscoveryJournal {
  const journal = createDiscoveryJournal();
  for (const m of options.matches ?? []) journal.matches.set(m.definitionId, m);
  for (const [speciesId, definitionId, streak] of options.streaks ?? []) journal.streaks.set(`${speciesId}:${definitionId}`, streak);
  return journal;
}

describe("summarizeCritterdex", () => {
  it("reports every registry entry as locked for a fresh run", () => {
    const summary = summarizeCritterdex(createDiscoveryJournal());
    expect(summary.totalCount).toBe(DISCOVERY_REGISTRY.length);
    expect(summary.unlockedCount).toBe(0);
    expect(summary.entries.every((entry) => entry.status === "locked")).toBe(true);
  });

  it("marks a confirmed discovery unlocked and carries its match through", () => {
    const summary = summarizeCritterdex(journalWith({ matches: [match("herbivore", 4)] }));
    const entry = summary.entries.find((e) => e.definition.id === "herbivore")!;
    expect(entry.status).toBe("unlocked");
    expect(entry.match?.speciesId).toBe(4);
    expect(entry.match?.evidence).toBe("measured evidence");
    expect(summary.unlockedCount).toBe(1);
  });

  it("marks a partial streak in-progress, naming the species building it", () => {
    const summary = summarizeCritterdex(journalWith({ streaks: [[7, "carnivore", 1]] }));
    const entry = summary.entries.find((e) => e.definition.id === "carnivore")!;
    expect(entry.status).toBe("in-progress");
    expect(entry.streak).toBe(1);
    expect(entry.streakSpeciesId).toBe(7);
    expect(entry.requiredStreak).toBe(DISCOVERY_CONFIRMATION_ERAS);
  });

  it("reports the furthest-along species when several are racing for the same discovery", () => {
    const summary = summarizeCritterdex(journalWith({ streaks: [[2, "fast-mover", 1], [9, "fast-mover", 3], [5, "fast-mover", 2]] }));
    const entry = summary.entries.find((e) => e.definition.id === "fast-mover")!;
    expect(entry.streak).toBe(3);
    expect(entry.streakSpeciesId).toBe(9);
  });

  // Otherwise the named holder flickers between equally-advanced species as Map order shifts,
  // which reads as a bug in a panel that re-renders every frame.
  it("breaks a tie deterministically rather than by map order", () => {
    const forward = summarizeCritterdex(journalWith({ streaks: [[3, "resilient", 1], [8, "resilient", 1]] }));
    const reversed = summarizeCritterdex(journalWith({ streaks: [[8, "resilient", 1], [3, "resilient", 1]] }));
    const idOf = (s: ReturnType<typeof summarizeCritterdex>) => s.entries.find((e) => e.definition.id === "resilient")!.streakSpeciesId;
    expect(idOf(forward)).toBe(idOf(reversed));
  });

  it("prefers unlocked over a lingering streak — an earned entry never reverts to in-progress", () => {
    const summary = summarizeCritterdex(journalWith({ matches: [match("omnivore")], streaks: [[6, "omnivore", 1]] }));
    const entry = summary.entries.find((e) => e.definition.id === "omnivore")!;
    expect(entry.status).toBe("unlocked");
    expect(entry.streak).toBe(0);
  });

  it("ignores a zeroed streak rather than showing it as progress", () => {
    const summary = summarizeCritterdex(journalWith({ streaks: [[1, "sedentary", 0]] }));
    expect(summary.entries.find((e) => e.definition.id === "sedentary")!.status).toBe("locked");
  });

  it("groups by category in registry order, covering every entry exactly once", () => {
    const summary = summarizeCritterdex(createDiscoveryJournal());
    const grouped = summary.groups.flatMap((group) => group.entries);
    expect(grouped).toHaveLength(summary.totalCount);
    expect(new Set(grouped.map((e) => e.definition.id)).size).toBe(summary.totalCount);

    const expectedOrder: string[] = [];
    for (const definition of DISCOVERY_REGISTRY) {
      if (!expectedOrder.includes(definition.category)) expectedOrder.push(definition.category);
    }
    expect(summary.groups.map((group) => group.category)).toEqual(expectedOrder);
  });

  // The grouping is derived from the registry rather than a hardcoded category list, so a
  // discovery added in a brand-new category appears without touching critterdexSummary.ts.
  it("derives its categories from the registry, not a fixed list", () => {
    const summary = summarizeCritterdex(createDiscoveryJournal());
    const categoriesInRegistry = new Set(DISCOVERY_REGISTRY.map((d) => d.category));
    expect(new Set(summary.groups.map((g) => g.category))).toEqual(categoriesInRegistry);
  });

  it("counts unlocked entries per category as well as overall", () => {
    const summary = summarizeCritterdex(journalWith({ matches: [match("herbivore"), match("carnivore")] }));
    const diet = summary.groups.find((group) => group.category === "diet")!;
    expect(diet.unlockedCount).toBe(2);
    expect(summary.unlockedCount).toBe(2);
    for (const group of summary.groups) {
      if (group.category !== "diet") expect(group.unlockedCount).toBe(0);
    }
  });
});
