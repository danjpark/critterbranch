/**
 * Per-grid-cell, per-species running total of food consumed — the data behind the competition
 * heatmap overlay (SPEC.md: "the one to build. It turns 'they compete for food' from an
 * assertion in the code into something on screen."). Sparse by species: most species only ever
 * touch a fraction of the grid, so a dense `[species][cell]` matrix would waste far more memory
 * than the Map costs.
 */
export interface ConsumptionGrid {
  cols: number;
  rows: number;
  bySpecies: Map<number, Float64Array>;
}

export function initConsumptionGrid(cols: number, rows: number): ConsumptionGrid {
  return { cols, rows, bySpecies: new Map() };
}

export function cloneConsumptionGrid(grid: ConsumptionGrid): ConsumptionGrid {
  const bySpecies = new Map<number, Float64Array>();
  for (const [speciesId, cells] of grid.bySpecies) bySpecies.set(speciesId, cells.slice());
  return { cols: grid.cols, rows: grid.rows, bySpecies };
}

export function recordConsumption(grid: ConsumptionGrid, lineageId: number, cellIndex: number, amount: number): void {
  if (amount <= 0) return;
  let cells = grid.bySpecies.get(lineageId);
  if (!cells) {
    cells = new Float64Array(grid.cols * grid.rows);
    grid.bySpecies.set(lineageId, cells);
  }
  cells[cellIndex] += amount;
}

// Below this, a species' remaining trace in a cell is imperceptible (at the default 0.985
// retention it's ~300 ticks old) — dropping it keeps bySpecies from accumulating an
// ever-growing tail of long-extinct species still holding a full-size, all-but-zero array.
const PRUNE_THRESHOLD = 1e-4;

/** `retention` is the fraction kept for this call, already exponentiated for however many ticks
 * have elapsed since the last decay pass — see sim.ts, which batches these calls (an O(cells)
 * scan per tracked species is too expensive to run every single tick). */
export function decayConsumption(grid: ConsumptionGrid, retention: number): void {
  for (const [speciesId, cells] of grid.bySpecies) {
    let max = 0;
    for (let i = 0; i < cells.length; i++) {
      cells[i] *= retention;
      if (cells[i] > max) max = cells[i];
    }
    if (max < PRUNE_THRESHOLD) grid.bySpecies.delete(speciesId);
  }
}
