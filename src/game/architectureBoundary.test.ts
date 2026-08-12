import { describe, expect, it } from "vitest";

// Uses Vite's import.meta.glob (already typed via the "vite/client" types this project's
// tsconfig includes) rather than node:fs, so this test needs no Node type dependency the rest of
// src/ doesn't already have — scripts/ has its own tsconfig for that.
const simFiles = import.meta.glob("../sim/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * Enforces the one architectural rule Milestone 0 exists to establish: sim/* must know nothing
 * about the game layer (challenges, objectives, eras, victory conditions). If this test fails,
 * something in sim/* has started importing from game/ — that dependency must be inverted, not
 * silenced.
 */
describe("dependency direction", () => {
  it("sim/ never imports from game/", () => {
    expect(Object.keys(simFiles).length).toBeGreaterThan(0);

    const offenders = Object.entries(simFiles)
      .filter(([, contents]) => [...contents.matchAll(/from\s+["']([^"']+)["']/g)].some((m) => m[1].includes("/game/") || m[1].startsWith("../game") || m[1].startsWith("./game")))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
