import type { Creature } from "../sim/creature.ts";
import { GENE_RANGES, type Genome } from "../sim/genome.ts";
import type { SimState } from "../sim/sim.ts";
import { cachedGenotypeColor, type ColorOptions } from "./color.ts";

export interface ScatterOptions {
  xGene: keyof Genome;
  yGene: keyof Genome;
  colorOptions: ColorOptions;
  selectedCreatureId: number | null;
  lineageFilter: Set<number> | null;
}

const MARGIN_LEFT = 44;
const MARGIN_BOTTOM = 30;
const MARGIN_TOP = 12;
const MARGIN_RIGHT = 12;

/**
 * Gene-space scatter: one point per living creature, positioned by two selectable genes and
 * colored by the same genotypeColor function as every other view. Per SPEC.md, this plot doubles
 * as the color legend — there is no separate widget explaining hue/chroma/lightness, because every
 * point here already sits at its own genome position wearing its own color. Watch one blob become
 * two: this is where a speciation event is visible as it happens, not just after the fact in the
 * event feed.
 */
export function renderScatter(ctx: CanvasRenderingContext2D, state: SimState, options: ScatterOptions): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  ctx.fillStyle = "#14161a";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const plotLeft = MARGIN_LEFT;
  const plotTop = MARGIN_TOP;
  const plotWidth = canvasWidth - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = canvasHeight - MARGIN_TOP - MARGIN_BOTTOM;

  const [xMin, xMax] = GENE_RANGES[options.xGene];
  const [yMin, yMax] = GENE_RANGES[options.yGene];

  drawAxes(ctx, plotLeft, plotTop, plotWidth, plotHeight, options.xGene, options.yGene, xMin, xMax, yMin, yMax);

  const radius = 3;
  for (const creature of state.creatures) {
    if (options.lineageFilter && !options.lineageFilter.has(creature.lineageId)) continue;

    const { cx, cy } = plotPosition(creature.genome, options, plotLeft, plotTop, plotWidth, plotHeight, xMin, xMax, yMin, yMax);
    const fill = cachedGenotypeColor(creature, state.foundingCentroid, options.colorOptions);

    ctx.beginPath();
    ctx.arc(cx, cy, radius + 0.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    if (options.selectedCreatureId === creature.id) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function plotPosition(
  genome: Genome,
  options: { xGene: keyof Genome; yGene: keyof Genome },
  plotLeft: number,
  plotTop: number,
  plotWidth: number,
  plotHeight: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): { cx: number; cy: number } {
  const xFrac = xMax > xMin ? (genome[options.xGene] - xMin) / (xMax - xMin) : 0.5;
  const yFrac = yMax > yMin ? (genome[options.yGene] - yMin) / (yMax - yMin) : 0.5;
  return {
    cx: plotLeft + xFrac * plotWidth,
    cy: plotTop + plotHeight - yFrac * plotHeight,
  };
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  plotLeft: number,
  plotTop: number,
  plotWidth: number,
  plotHeight: number,
  xGene: keyof Genome,
  yGene: keyof Genome,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): void {
  ctx.strokeStyle = "#3a3f47";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotTop + plotHeight);
  ctx.lineTo(plotLeft + plotWidth, plotTop + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#9aa1ab";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(xMin.toFixed(2), plotLeft, plotTop + plotHeight + 4);
  ctx.textAlign = "right";
  ctx.fillText(xMax.toFixed(2), plotLeft + plotWidth, plotTop + plotHeight + 4);

  ctx.textAlign = "center";
  ctx.fillText(xGene, plotLeft + plotWidth / 2, plotTop + plotHeight + 16);

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(yMax.toFixed(2), plotLeft - 4, plotTop + 10);
  ctx.textBaseline = "top";
  ctx.fillText(yMin.toFixed(2), plotLeft - 4, plotTop + plotHeight - 10);

  ctx.save();
  ctx.translate(12, plotTop + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(yGene, 0, 0);
  ctx.restore();
}

/** Nearest plotted creature to a canvas-space click, or null if nothing is close enough. */
export function findPointAt(
  state: SimState,
  options: Pick<ScatterOptions, "xGene" | "yGene" | "lineageFilter">,
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
): Creature | null {
  const plotLeft = MARGIN_LEFT;
  const plotTop = MARGIN_TOP;
  const plotWidth = canvasWidth - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = canvasHeight - MARGIN_TOP - MARGIN_BOTTOM;
  const [xMin, xMax] = GENE_RANGES[options.xGene];
  const [yMin, yMax] = GENE_RANGES[options.yGene];

  const pickRadius = 8;
  let closest: Creature | null = null;
  let closestDist = pickRadius;

  for (const creature of state.creatures) {
    if (options.lineageFilter && !options.lineageFilter.has(creature.lineageId)) continue;

    const { cx, cy } = plotPosition(creature.genome, options, plotLeft, plotTop, plotWidth, plotHeight, xMin, xMax, yMin, yMax);
    const dx = cx - canvasX;
    const dy = cy - canvasY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = creature;
    }
  }

  return closest;
}
