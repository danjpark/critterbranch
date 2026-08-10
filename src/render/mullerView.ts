import type { SimState } from "../sim/sim.ts";
import { type ColorOptions, genotypeColor } from "./color.ts";
import { layoutTree } from "./treeLayout.ts";

const MARGIN = 8;

/**
 * Stacked area chart of relative species abundance over time — SPEC.md calls this "the most
 * legible view of a takeover or split." Stacking order matches the tree's row order (same DFS),
 * so related lineages sit adjacent in the stack instead of shuffling randomly by id.
 */
export function renderMuller(ctx: CanvasRenderingContext2D, state: SimState, colorOptions: ColorOptions): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  ctx.fillStyle = "#14161a";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const history = state.populationHistory;
  if (history.length === 0) return;

  const orderedSpecies = layoutTree(state.taxonomy, state.tick).nodes;
  if (orderedSpecies.length === 0) return;

  const maxTick = Math.max(state.tick, 1);
  let maxTotal = 1;
  for (const sample of history) {
    let total = 0;
    for (const count of Object.values(sample.counts)) total += count;
    if (total > maxTotal) maxTotal = total;
  }

  const plotWidth = canvasWidth - MARGIN * 2;
  const plotHeight = canvasHeight - MARGIN * 2;
  const tickToX = (tick: number) => MARGIN + (tick / maxTick) * plotWidth;
  const valueToY = (value: number) => MARGIN + plotHeight - (value / maxTotal) * plotHeight;

  // Cumulative stack boundaries per sample, in the same species order for every sample.
  const before: number[][] = [];
  const after: number[][] = [];
  for (const sample of history) {
    let running = 0;
    const rowBefore: number[] = [];
    const rowAfter: number[] = [];
    for (const node of orderedSpecies) {
      rowBefore.push(running);
      running += sample.counts[node.speciesId] ?? 0;
      rowAfter.push(running);
    }
    before.push(rowBefore);
    after.push(rowAfter);
  }

  orderedSpecies.forEach((node, speciesIndex) => {
    ctx.fillStyle = genotypeColor(node.centroid, state.foundingCentroid, colorOptions);
    ctx.beginPath();
    history.forEach((sample, i) => {
      const x = tickToX(sample.tick);
      const y = valueToY(after[i][speciesIndex]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    for (let i = history.length - 1; i >= 0; i--) {
      ctx.lineTo(tickToX(history[i].tick), valueToY(before[i][speciesIndex]));
    }
    ctx.closePath();
    ctx.fill();
  });
}
