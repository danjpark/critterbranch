import { describe, expect, it } from "vitest";
import { acknowledgeEraSummary, canTransitionPhase, createGameState, transitionPhase } from "./gameState.ts";

describe("createGameState", () => {
  it("starts at era 0 in the terraform phase", () => {
    const state = createGameState("sandbox");
    expect(state).toEqual({ mode: "sandbox", era: 0, phase: "terraform" });
  });
});

describe("canTransitionPhase", () => {
  it("allows the terraform -> evolution -> discovery -> terraform cycle", () => {
    expect(canTransitionPhase("terraform", "evolution")).toBe(true);
    expect(canTransitionPhase("evolution", "discovery")).toBe(true);
    expect(canTransitionPhase("discovery", "terraform")).toBe(true);
  });

  it("rejects skipping a phase", () => {
    expect(canTransitionPhase("terraform", "discovery")).toBe(false);
    expect(canTransitionPhase("evolution", "terraform")).toBe(false);
    expect(canTransitionPhase("discovery", "evolution")).toBe(false);
  });
});

describe("transitionPhase", () => {
  it("mutates state.phase on a legal transition", () => {
    const state = createGameState("sandbox");
    transitionPhase(state, "evolution");
    expect(state.phase).toBe("evolution");
  });

  it("throws on an illegal transition and leaves state unchanged", () => {
    const state = createGameState("sandbox");
    expect(() => transitionPhase(state, "discovery")).toThrow(/Illegal game phase transition/);
    expect(state.phase).toBe("terraform");
  });
});

describe("acknowledgeEraSummary", () => {
  it("moves from discovery back to terraform", () => {
    const state = createGameState("sandbox");
    transitionPhase(state, "evolution");
    transitionPhase(state, "discovery");
    acknowledgeEraSummary(state);
    expect(state.phase).toBe("terraform");
  });

  it("throws if not currently in discovery", () => {
    const state = createGameState("sandbox");
    expect(() => acknowledgeEraSummary(state)).toThrow(/Illegal game phase transition/);
  });
});
