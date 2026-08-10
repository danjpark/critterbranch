import type { SimState } from "../sim/sim.ts";
import type { SpeciationMechanism } from "../sim/taxonomy.ts";
import { type ColorOptions, genotypeColor } from "./color.ts";
import { layoutTree, type TreeLayout } from "./treeLayout.ts";

export interface TreeRenderOptions {
  colorOptions: ColorOptions;
  selectedSpeciesId: number | null;
  /** null = show every mechanism; otherwise only branches whose mechanism is in the set are drawn. */
  mechanismFilter: Set<SpeciationMechanism> | null;
}

const ROW_HEIGHT = 22;
const LEFT_MARGIN = 14;
const RIGHT_MARGIN = 14;
const TOP_MARGIN = 16;

const MECHANISM_ICONS: Record<SpeciationMechanism, string> = {
  "founder-population": "●", // ●
  allopatric: "▲", // ▲
  sympatric: "◆", // ◆
  founder: "○", // ○
};

interface TreeScales {
  tickToX: (tick: number) => number;
  rowToY: (row: number) => number;
}

function computeScales(canvasWidth: number, maxTick: number): TreeScales {
  const plotWidth = canvasWidth - LEFT_MARGIN - RIGHT_MARGIN;
  const safeMaxTick = Math.max(maxTick, 1);
  return {
    tickToX: (tick) => LEFT_MARGIN + (tick / safeMaxTick) * plotWidth,
    rowToY: (row) => TOP_MARGIN + row * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
}

/** Draws the tree and returns the layout it drew, so callers don't have to lay it out twice for hit-testing on a fresh frame. */
export function renderTree(ctx: CanvasRenderingContext2D, state: SimState, options: TreeRenderOptions): TreeLayout {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  ctx.fillStyle = "#14161a";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const layout = layoutTree(state.taxonomy, state.tick);
  if (layout.nodes.length === 0) return layout;

  const { tickToX, rowToY } = computeScales(canvasWidth, state.tick);
  const nodeById = new Map(layout.nodes.map((n) => [n.speciesId, n]));

  for (const node of layout.nodes) {
    if (options.mechanismFilter && !options.mechanismFilter.has(node.mechanism)) continue;
    if (rowToY(node.row) > canvasHeight) continue;

    const x1 = tickToX(node.originTick);
    const x2 = tickToX(node.endTick);
    const y = rowToY(node.row);
    const color = genotypeColor(node.centroid, state.foundingCentroid, options.colorOptions);
    const isSelected = options.selectedSpeciesId === node.speciesId;

    ctx.save();
    if (node.isExtinct) ctx.globalAlpha = 0.5;

    if (node.parentId !== null) {
      const parent = nodeById.get(node.parentId);
      if (parent) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, rowToY(parent.row));
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 4.5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();

    if (isSelected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    }

    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#e6e6e6";
    ctx.textBaseline = "middle";
    ctx.fillText(MECHANISM_ICONS[node.mechanism], x1 + 2, y - 8);

    if (node.dominantDivergentGene) {
      ctx.font = "9px sans-serif";
      ctx.fillStyle = "#9aa0aa";
      ctx.fillText(node.dominantDivergentGene, x1 + 2, y + 9);
    }

    ctx.restore();
  }

  return layout;
}

const HIT_TOLERANCE_Y = 8;
const HIT_TOLERANCE_X = 4;

/** Which species (if any) a click at canvas coordinates landed on. Recomputes the layout fresh — cheap, since species count stays small even over a long run. */
export function findBranchAt(state: SimState, canvasWidth: number, canvasX: number, canvasY: number): number | null {
  const layout = layoutTree(state.taxonomy, state.tick);
  const { tickToX, rowToY } = computeScales(canvasWidth, state.tick);

  for (const node of layout.nodes) {
    if (Math.abs(canvasY - rowToY(node.row)) > HIT_TOLERANCE_Y) continue;
    const x1 = tickToX(node.originTick);
    const x2 = tickToX(node.endTick);
    if (canvasX >= x1 - HIT_TOLERANCE_X && canvasX <= x2 + HIT_TOLERANCE_X) return node.speciesId;
  }
  return null;
}
