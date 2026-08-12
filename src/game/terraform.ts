import type { Intervention } from "../sim/intervention.ts";
import { applyInterventionNow } from "../sim/sim.ts";
import type { Game } from "./game.ts";

export interface TerraformBudgetState {
  remaining: number;
}

/** Placeholder costs, not balance-tuned — just enough to make budget tradeoffs real. */
export const TERRAFORM_COSTS: Record<Intervention["tool"], number> = {
  raiseTerrain: 5,
  lowerTerrain: 5,
  dropFood: 8,
  drought: 10,
  bloom: 10,
  barrierStamp: 10,
  meteor: 30,
  seedFounders: 15,
};

export type TerraformResult = { ok: true } | { ok: false; reason: string };

/**
 * Routes a god-mode action through the game layer: phase legality, then budget, then the sim
 * intervention itself. The simulation never sees Terraform Points or phases — this is the only
 * place either concept exists. `game.budget === null` means unlimited (sandbox mode).
 */
export function applyTerraformCommand<Tool extends Intervention["tool"]>(
  game: Game,
  tool: Tool,
  params: Extract<Intervention, { tool: Tool }>["params"],
): TerraformResult {
  if (game.gameState.phase !== "terraform") {
    return { ok: false, reason: `cannot terraform during the ${game.gameState.phase} phase` };
  }

  const cost = TERRAFORM_COSTS[tool];
  if (game.budget !== null && game.budget.remaining < cost) {
    return { ok: false, reason: `insufficient terraform points (need ${cost}, have ${game.budget.remaining})` };
  }

  applyInterventionNow(game.sim, game.sim.params, tool, params);
  if (game.budget !== null) game.budget.remaining -= cost;
  return { ok: true };
}
