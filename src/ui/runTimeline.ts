import { GENE_KEYS, type Genome, type TraitSample } from "../sim/genome.ts";
import type { GeneFlowSample } from "../sim/geneFlow.ts";
import type { TaxonomyEvent } from "../sim/taxonomy.ts";

/**
 * The run timeline (SPEC.md Addendum 32) — gene flow, trait drift and the event log as three lanes
 * of ONE chart sharing ONE tick axis, spanning the full width beneath the world.
 *
 * They used to be three separate sidebar panels roughly 272px wide. Dan asked for them full-width;
 * the reason to make them a single component rather than three wide ones is that all three are
 * measurements of the same run against the same clock, and the question a player actually has is a
 * cross-lane one: *did migration collapse at the moment that trait split, and is that the tick the
 * event log recorded a speciation?* Three independently-scaled charts cannot answer that no matter
 * how wide they are. Aligned on a shared axis, it's a single vertical read.
 *
 * Drawn as one canvas rather than three stacked ones so the alignment is structural instead of
 * something three separate resize paths have to keep agreeing about.
 */

/** Lane geometry, in CSS pixels. Heights are deliberately unequal: the trait lane carries the most
 * information (a mean, a spread band, and a scale), the event lane is a ribbon of markers. */
const PAD_LEFT = 52;
const PAD_RIGHT = 14;
const PAD_TOP = 10;
const FLOW_H = 58;
const TRAIT_H = 92;
const EVENT_H = 44;
const AXIS_H = 22;
const LANE_GAP = 12;
const TOTAL_H = PAD_TOP + FLOW_H + LANE_GAP + TRAIT_H + LANE_GAP + EVENT_H + AXIS_H;

const EVENT_HIT_RADIUS = 7;

export interface RunTimelineState {
  geneFlow: GeneFlowSample[];
  traitHistory: TraitSample[];
  events: TaxonomyEvent[];
  currentTick: number;
  gene: keyof Genome;
}

export interface RunTimelineHandle {
  root: HTMLElement;
  render: (state: RunTimelineState) => void;
}

function eventTickOf(taxonomyEvent: TaxonomyEvent): number {
  return taxonomyEvent.event.tick;
}

/** "12.4k" / "1.2M" — a tick axis runs to hundreds of thousands, and full digits at every label
 * collide long before that. */
function formatTick(tick: number): string {
  if (tick >= 1_000_000) return `${(tick / 1_000_000).toFixed(tick >= 10_000_000 ? 0 : 1)}M`;
  if (tick >= 10_000) return `${Math.round(tick / 1000)}k`;
  if (tick >= 1_000) return `${(tick / 1000).toFixed(1)}k`;
  return String(tick);
}

/** A "nice" step (1/2/5 x 10^n) so axis labels land on round ticks rather than arbitrary fractions
 * of whatever the current tick happens to be. */
function niceStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const multiple of [1, 2, 5, 10]) {
    if (raw <= magnitude * multiple) return magnitude * multiple;
  }
  return magnitude * 10;
}

function describeEvent(taxonomyEvent: TaxonomyEvent): string {
  if (taxonomyEvent.type === "speciation") {
    const { tick, mechanism, dominantDivergentGene, founderCount, speciesId, parentId } = taxonomyEvent.event;
    return `Tick ${tick.toLocaleString()} — ${mechanism} split: species ${speciesId} branched from species ${parentId} (${founderCount} founders; ${dominantDivergentGene} diverged most)`;
  }
  const { tick, speciesId, lifespanTicks, peakMemberCount } = taxonomyEvent.event;
  return `Tick ${tick.toLocaleString()} — species ${speciesId} went extinct after ${lifespanTicks.toLocaleString()} ticks (peak population ${peakMemberCount.toLocaleString()})`;
}

/** Nearest sample at or before `tick` — the honest reading for a step-sampled series, and it works
 * on a compacted history where sample spacing is deliberately non-uniform. */
function sampleAt<T>(samples: T[], tick: number, tickOf: (sample: T) => number): T | null {
  if (samples.length === 0) return null;
  let low = 0;
  let high = samples.length - 1;
  if (tick < tickOf(samples[0])) return samples[0];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (tickOf(samples[mid]) <= tick) low = mid;
    else high = mid - 1;
  }
  return samples[low];
}

export function createRunTimeline(defaultGene: keyof Genome, onGeneChange: (gene: keyof Genome) => void): RunTimelineHandle {
  const root = document.createElement("section");
  root.className = "panel timeline";

  const header = document.createElement("div");
  header.className = "timeline-header";
  const heading = document.createElement("h3");
  heading.className = "panel-title";
  heading.textContent = "Run timeline";

  const geneLabel = document.createElement("label");
  geneLabel.className = "timeline-gene";
  geneLabel.textContent = "Trait ";
  const geneSelect = document.createElement("select");
  for (const key of GENE_KEYS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key;
    geneSelect.appendChild(option);
  }
  geneSelect.value = defaultGene;
  geneSelect.addEventListener("change", () => onGeneChange(geneSelect.value as keyof Genome));
  geneLabel.appendChild(geneSelect);
  header.append(heading, geneLabel);

  const plot = document.createElement("div");
  plot.className = "timeline-plot";
  const canvas = document.createElement("canvas");
  canvas.className = "timeline-canvas";
  const tooltip = document.createElement("div");
  tooltip.className = "timeline-tooltip";
  tooltip.hidden = true;
  plot.append(canvas, tooltip);

  // The selected event's full text lives in the DOM rather than being painted into the canvas:
  // it's the one piece of content here a player might want to read carefully, select or copy.
  const detail = document.createElement("div");
  detail.className = "timeline-detail";
  detail.textContent = "Hover the timeline to read any moment. Click an event marker to keep it here.";

  root.append(header, plot, detail);

  const ctx = canvas.getContext("2d")!;
  let latest: RunTimelineState | null = null;
  let widthCss = 0;
  let hoverX: number | null = null;
  let pinnedEvent: TaxonomyEvent | null = null;
  /** Cheap change signature — this renders from a 16ms loop, and repainting an unchanged chart
   * every frame is exactly the defect that kept resurfacing in the sidebar panels. */
  let lastSignature = "";

  /**
   * The shared x domain. The right edge is QUANTIZED to a round tick above the current one rather
   * than tracking it exactly, which matters for two reasons found by using this while the sim ran:
   *
   * - Every marker slid leftward on every frame, so an event was impossible to click without
   *   pausing first. Between quantization boundaries the mapping is now fixed and markers hold
   *   still; the axis jumps occasionally instead of drifting constantly.
   * - The redraw guard below keys off this, so a full-width repaint happens when a new sample
   *   lands (every taxonomyIntervalTicks) rather than on all 60 frames a second.
   *
   * The cost is up to one step of empty space on the right, which reads as headroom for a run
   * still in progress rather than as a gap.
   */
  function domain(state: RunTimelineState): { start: number; end: number } {
    const firstFlow = state.geneFlow.length > 0 ? state.geneFlow[0].tick : Infinity;
    const firstTrait = state.traitHistory.length > 0 ? state.traitHistory[0].tick : Infinity;
    const rawStart = Math.min(firstFlow, firstTrait, state.currentTick);
    const start = Number.isFinite(rawStart) ? rawStart : 0;
    // A degenerate domain (a run one tick old) would divide by zero; give it a nominal span.
    const span = Math.max(1, state.currentTick - start);
    const step = niceStep(span, 8);
    return { start, end: start + Math.max(step, Math.ceil(span / step) * step) };
  }

  function tickToX(tick: number, start: number, end: number): number {
    return PAD_LEFT + ((tick - start) / (end - start)) * (widthCss - PAD_LEFT - PAD_RIGHT);
  }

  function xToTick(x: number, start: number, end: number): number {
    const span = widthCss - PAD_LEFT - PAD_RIGHT;
    return start + ((x - PAD_LEFT) / Math.max(1, span)) * (end - start);
  }

  function eventsNear(state: RunTimelineState, x: number): TaxonomyEvent[] {
    const { start, end } = domain(state);
    return state.events.filter((e) => Math.abs(tickToX(eventTickOf(e), start, end) - x) <= EVENT_HIT_RADIUS);
  }

  function cssVar(name: string, fallback: string): string {
    return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
  }

  function draw(): void {
    const state = latest;
    if (!state || widthCss <= 0) return;

    const ink = cssVar("--ink", "#ece5d8");
    const inkMuted = cssVar("--ink-muted", "#a29883");
    const inkFaint = cssVar("--ink-faint", "#7a7161");
    const line = cssVar("--line", "#3a332a");
    const accent = cssVar("--accent", "#d8b45f");
    const sunken = cssVar("--surface-sunken", "#191510");
    const danger = cssVar("--danger", "#c96a4a");

    ctx.clearRect(0, 0, widthCss, TOTAL_H);
    const { start, end } = domain(state);
    const plotW = widthCss - PAD_LEFT - PAD_RIGHT;

    const flowTop = PAD_TOP;
    const traitTop = flowTop + FLOW_H + LANE_GAP;
    const eventTop = traitTop + TRAIT_H + LANE_GAP;
    const axisTop = eventTop + EVENT_H;

    // ---- lane backgrounds + titles ----------------------------------------------------------
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "top";
    // The explanatory half of each title is the first thing to go when there isn't room for it —
    // a clipped label is worse than a short one, and at phone width the plot is ~260px.
    const roomy = plotW >= 420;
    for (const [top, height, title] of [
      [flowTop, FLOW_H, roomy ? "GENE FLOW — migrations between halves" : "GENE FLOW"],
      [traitTop, TRAIT_H, roomy ? `TRAIT — ${state.gene} (mean, shaded ±1 std)` : `TRAIT — ${state.gene}`],
      [eventTop, EVENT_H, "EVENTS"],
    ] as const) {
      ctx.fillStyle = sunken;
      ctx.fillRect(PAD_LEFT, top, plotW, height);
      ctx.fillStyle = inkFaint;
      ctx.fillText(title, PAD_LEFT + 6, top + 5);
    }

    // ---- shared time gridlines + axis --------------------------------------------------------
    const step = niceStep(end - start, Math.max(4, Math.floor(plotW / 110)));
    const firstLabel = Math.ceil(start / step) * step;
    ctx.textAlign = "center";
    for (let tick = firstLabel; tick <= end; tick += step) {
      const x = Math.round(tickToX(tick, start, end)) + 0.5;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, flowTop);
      ctx.lineTo(x, axisTop);
      ctx.stroke();
      ctx.fillStyle = inkFaint;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(formatTick(tick), x, axisTop + 5);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = inkFaint;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("tick", PAD_LEFT - 30, axisTop + 5);

    // ---- gene flow ---------------------------------------------------------------------------
    // Plotted against TICK, not array index. The history is compacted as a run grows (older
    // samples thinned), so index-spaced drawing silently stretched sparse old data to the same
    // width as dense recent data — the axis said one thing and the pixels said another.
    if (state.geneFlow.length > 0) {
      const maxMigrations = Math.max(1, ...state.geneFlow.map((s) => s.migrations));
      ctx.fillStyle = accent;
      const barW = Math.max(1, plotW / Math.max(state.geneFlow.length, 1) - 0.5);
      for (const sample of state.geneFlow) {
        const h = (sample.migrations / maxMigrations) * (FLOW_H - 16);
        const x = tickToX(sample.tick, start, end);
        ctx.fillRect(x - barW / 2, flowTop + FLOW_H - h, barW, h);
      }
      ctx.fillStyle = inkFaint;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(maxMigrations), PAD_LEFT - 6, flowTop + 14);
      ctx.fillText("0", PAD_LEFT - 6, flowTop + FLOW_H - 12);
      ctx.textAlign = "left";
    }

    // ---- trait mean +/- std -------------------------------------------------------------------
    if (state.traitHistory.length > 0) {
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const sample of state.traitHistory) {
        yMin = Math.min(yMin, sample.mean[state.gene] - sample.std[state.gene]);
        yMax = Math.max(yMax, sample.mean[state.gene] + sample.std[state.gene]);
      }
      if (!(yMax > yMin)) {
        yMin -= 0.5;
        yMax += 0.5;
      }
      const innerTop = traitTop + 16;
      const innerH = TRAIT_H - 22;
      const valueToY = (v: number) => innerTop + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

      ctx.fillStyle = "rgb(216 180 95 / 18%)";
      ctx.beginPath();
      state.traitHistory.forEach((sample, i) => {
        const x = tickToX(sample.tick, start, end);
        const y = valueToY(sample.mean[state.gene] + sample.std[state.gene]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = state.traitHistory.length - 1; i >= 0; i--) {
        const sample = state.traitHistory[i];
        ctx.lineTo(tickToX(sample.tick, start, end), valueToY(sample.mean[state.gene] - sample.std[state.gene]));
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      state.traitHistory.forEach((sample, i) => {
        const x = tickToX(sample.tick, start, end);
        const y = valueToY(sample.mean[state.gene]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // A value scale, so "the line went up" has a magnitude attached to it.
      ctx.fillStyle = inkFaint;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(yMax.toFixed(2), PAD_LEFT - 6, innerTop - 4);
      ctx.fillText(yMin.toFixed(2), PAD_LEFT - 6, innerTop + innerH - 8);
      ctx.textAlign = "left";
    }

    // ---- event markers -------------------------------------------------------------------------
    // The whole point of the timeline framing: an event's POSITION carries its timing. In the old
    // reverse-chronological list, two events 50 ticks apart and two 20,000 ticks apart looked
    // identical.
    const markerY = eventTop + EVENT_H / 2 + 4;
    for (const taxonomyEvent of state.events) {
      const x = tickToX(eventTickOf(taxonomyEvent), start, end);
      const isSpeciation = taxonomyEvent.type === "speciation";
      const isPinned = pinnedEvent === taxonomyEvent;
      ctx.strokeStyle = isSpeciation ? accent : danger;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, eventTop + 16);
      ctx.lineTo(x, markerY);
      ctx.stroke();

      ctx.fillStyle = isSpeciation ? accent : danger;
      ctx.beginPath();
      if (isSpeciation) {
        // A split: a small upward fork-head. An extinction: a square full stop.
        ctx.arc(x, markerY, isPinned ? 5 : 3.5, 0, Math.PI * 2);
      } else {
        const s = isPinned ? 5 : 3.5;
        ctx.rect(x - s, markerY - s, s * 2, s * 2);
      }
      ctx.fill();
      if (isPinned) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    if (state.events.length === 0) {
      ctx.fillStyle = inkFaint;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("no splits or extinctions yet", PAD_LEFT + 6, markerY - 5);
    }

    // ---- hover crosshair -----------------------------------------------------------------------
    if (hoverX !== null && hoverX >= PAD_LEFT && hoverX <= widthCss - PAD_RIGHT) {
      const x = Math.round(hoverX) + 0.5;
      ctx.strokeStyle = inkMuted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, flowTop);
      ctx.lineTo(x, axisTop);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function resize(): void {
    const next = plot.clientWidth;
    if (next <= 0) return;
    widthCss = next;
    // Buffer sized to the real layout box times the device ratio. The old charts had a fixed 272px
    // buffer stretched by CSS to whatever width the panel happened to be, which was upscaled and
    // soft even in the sidebar and would be far worse across a full-width band.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(widthCss * ratio);
    canvas.height = Math.round(TOTAL_H * ratio);
    canvas.style.height = `${TOTAL_H}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  // Held in a variable rather than `new ResizeObserver(resize).observe(plot)` so the observer can't
  // be collected while its only reference is the observation itself.
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(plot);

  function showTooltipAt(clientX: number): void {
    const state = latest;
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    hoverX = x;
    if (x < PAD_LEFT || x > widthCss - PAD_RIGHT) {
      tooltip.hidden = true;
      draw();
      return;
    }

    const { start, end } = domain(state);
    const tick = Math.round(xToTick(x, start, end));
    const flow = sampleAt(state.geneFlow, tick, (s) => s.tick);
    const trait = sampleAt(state.traitHistory, tick, (s) => s.tick);
    const near = eventsNear(state, x);

    const lines = [`<strong>Tick ${tick.toLocaleString()}</strong>`];
    if (flow) lines.push(`Migrations: ${flow.migrations}`);
    if (trait) lines.push(`${state.gene}: ${trait.mean[state.gene].toFixed(3)} ±${trait.std[state.gene].toFixed(3)}`);
    for (const taxonomyEvent of near) lines.push(describeEvent(taxonomyEvent));

    tooltip.innerHTML = lines.join("<br>");
    tooltip.hidden = false;
    // Flip the tooltip to the left of the cursor near the right edge so it never runs off.
    const preferLeft = x > widthCss - 240;
    tooltip.style.left = preferLeft ? "auto" : `${x + 12}px`;
    tooltip.style.right = preferLeft ? `${widthCss - x + 12}px` : "auto";
    canvas.style.cursor = near.length > 0 ? "pointer" : "crosshair";
    draw();
  }

  canvas.addEventListener("pointermove", (event) => showTooltipAt(event.clientX));
  canvas.addEventListener("pointerleave", () => {
    hoverX = null;
    tooltip.hidden = true;
    draw();
  });
  canvas.addEventListener("click", (event) => {
    const state = latest;
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const near = eventsNear(state, event.clientX - rect.left);
    pinnedEvent = near.length > 0 ? near[near.length - 1] : null;
    detail.textContent = pinnedEvent
      ? describeEvent(pinnedEvent)
      : "Hover the timeline to read any moment. Click an event marker to keep it here.";
    draw();
  });

  return {
    root,
    render(state) {
      latest = state;
      // Don't depend on the observer having fired: this component is built before it's mounted, so
      // the first observation can land on a detached, zero-width box. Comparing against the live
      // layout width each render costs one property read on a loop that's already running, and
      // makes the buffer correct however the element got into the document.
      if (plot.clientWidth > 0 && plot.clientWidth !== widthCss) resize();
      // Events are append-only and samples grow/compact, so lengths plus the QUANTIZED domain plus
      // the selected gene fully determine the picture. Keyed off the quantized end rather than the
      // raw tick specifically so a running sim doesn't force a full-width repaint every frame —
      // that "panel driven from the 16ms loop redraws unconditionally" defect has now surfaced in
      // four separate components in this codebase.
      const { end } = domain(state);
      const signature = `${state.geneFlow.length}|${state.traitHistory.length}|${state.events.length}|${end}|${state.gene}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      // A restart drops the event list; a pinned event from the previous run no longer exists.
      if (pinnedEvent && !state.events.includes(pinnedEvent)) {
        pinnedEvent = null;
        detail.textContent = "Hover the timeline to read any moment. Click an event marker to keep it here.";
      }
      draw();
    },
  };
}
