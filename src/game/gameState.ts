/**
 * The game-domain layer's own state, distinct from SimState (sim/sim.ts). This module must never
 * be imported from sim/* — see the dependency-direction check in architectureBoundary.test.ts.
 * sim/* knows nothing about eras, phases, objectives, or challenges.
 */

export type GameMode = "sandbox" | "challenge";

/** terraform: player may intervene. evolution: sim is advancing, no interventions accepted.
 * discovery: era just ended, player reviews the Era Summary before returning to terraform. */
export type GamePhase = "terraform" | "evolution" | "discovery";

export interface GameState {
  mode: GameMode;
  era: number;
  phase: GamePhase;
}

export function createGameState(mode: GameMode): GameState {
  return { mode, era: 0, phase: "terraform" };
}

const LEGAL_TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  terraform: ["evolution"],
  evolution: ["discovery"],
  discovery: ["terraform"],
};

export function canTransitionPhase(from: GamePhase, to: GamePhase): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Mutates state.phase. Throws on an illegal transition rather than silently ignoring it — a
 * caller trying to terraform mid-evolution is a bug, not a no-op. */
export function transitionPhase(state: GameState, to: GamePhase): void {
  if (!canTransitionPhase(state.phase, to)) {
    throw new Error(`Illegal game phase transition: ${state.phase} -> ${to}`);
  }
  state.phase = to;
}

/** The player has reviewed the Era Summary and is ready to intervene again. */
export function acknowledgeEraSummary(state: GameState): void {
  transitionPhase(state, "terraform");
}
