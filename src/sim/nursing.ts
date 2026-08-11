import type { Creature } from "./creature.ts";
import type { Params } from "../params.ts";

/**
 * Ongoing parental care: each tick, a dependent child still within its nursingUntilTick window
 * receives a fixed-rate energy transfer from its still-living parent, on top of whatever it forages
 * for itself (there's no juvenile/adult behavior gate in this sim — nursing is a subsidy, not a
 * requirement). This is the second half of the life-history axis's r/K trade-off alongside the
 * one-time birth investment offspringInvestment already controls: nursingDuration decides *how
 * long* a parent keeps paying, this function decides *how much* each tick.
 *
 * Decision (see SPEC.md): if the parent dies mid-nursing, the child simply stops receiving care
 * and continues on its own — it does not die with the parent. A hard "dependent dies too" rule
 * would add a second, harsher death mechanic stacked on top of ordinary starvation, and this sim
 * already has enough ways to go extinct; losing your parent's subsidy early is itself a real cost
 * without needing to be a death sentence.
 */
export function applyNursing(creatures: Creature[], tick: number, params: Params): void {
  const dependents = creatures.filter((c) => c.parentId !== null && tick < c.nursingUntilTick);
  if (dependents.length === 0) return;

  const byId = new Map<number, Creature>();
  for (const c of creatures) byId.set(c.id, c);

  for (const child of dependents) {
    const parent = byId.get(child.parentId!);
    if (!parent) {
      // Parent no longer among the living — stop looking for it every subsequent tick.
      child.nursingUntilTick = tick;
      continue;
    }
    const transfer = Math.min(params.nursingRatePerTick, parent.energy);
    if (transfer <= 0) continue;
    parent.energy -= transfer;
    child.energy += transfer;
  }
}
