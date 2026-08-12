import { type ColorOptions, FOOD_B_COLOR, FOOD_R_COLOR, genotypeColor } from "../render/color.ts";
import type { Creature } from "../sim/creature.ts";
import type { GeneFlowSample } from "../sim/geneFlow.ts";
import { GENE_KEYS, type Genome, type TraitSample } from "../sim/genome.ts";
import type { Species, SpeciationMechanism, TaxonomyEvent } from "../sim/taxonomy.ts";
import type { ChallengeDefinition } from "../game/challenges/challenge.ts";
import type { ChallengeStatus } from "../game/challengeRuntime.ts";
import type { EraSummary } from "../game/eraSummary.ts";
import type { GameMode, GamePhase } from "../game/gameState.ts";
import type { GameObjective } from "../game/objectives/objective.ts";
import type { Capability } from "../game/observability/capabilityClassifier.ts";

export type SpeedSetting = 1 | 10 | 100 | 1000 | "max";

const SPEED_OPTIONS: SpeedSetting[] = [1, 10, 100, 1000, "max"];

export type GodTool =
  | "raiseTerrain"
  | "lowerTerrain"
  | "barrierStamp"
  | "dropFoodR"
  | "dropFoodB"
  | "drought"
  | "bloom"
  | "meteor"
  | "seedFounders";

const GOD_TOOL_LABELS: Record<GodTool, string> = {
  raiseTerrain: "Raise terrain",
  lowerTerrain: "Lower terrain",
  barrierStamp: "Barrier (click twice)",
  dropFoodR: "Drop food R",
  dropFoodB: "Drop food B",
  drought: "Drought",
  bloom: "Bloom",
  meteor: "Meteor",
  seedFounders: "Seed founders",
};

const GOD_TOOL_HINTS: Record<GodTool, string> = {
  raiseTerrain: "Click the map to raise terrain there.",
  lowerTerrain: "Click the map to lower terrain there.",
  barrierStamp: "Click one point, then another — draws a barrier between them.",
  dropFoodR: "Click the map to add food (type R) there.",
  dropFoodB: "Click the map to add food (type B) there.",
  drought: "Click a region to suppress its regrowth for a while.",
  bloom: "Click a region to boost its regrowth for a while.",
  meteor: "Click to strike — kills everything in range and craters the ground. Undo below if you regret it.",
  seedFounders: "Click to drop new creatures with random genomes there.",
};

const GOD_TOOLS: GodTool[] = [
  "raiseTerrain",
  "lowerTerrain",
  "barrierStamp",
  "dropFoodR",
  "dropFoodB",
  "drought",
  "bloom",
  "meteor",
  "seedFounders",
];

export interface ScenarioCallbacks {
  onExport: () => void;
  onLoad: (file: File) => void;
  onLoadExample: (name: "barrier-split" | "meteor-radiation") => void;
}

export interface ScenarioHandle {
  root: HTMLElement;
}

export function createScenarioPanel(callbacks: ScenarioCallbacks): ScenarioHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Scenario"));

  const hint = document.createElement("div");
  hint.className = "godmode-hint";
  hint.textContent = "A scenario is a seed plus every god-mode action, replayed at the exact ticks they happened — export one to save or share a run, load one to watch it play out.";

  const exportButton = document.createElement("button");
  exportButton.textContent = "Export scenario (.json)";
  exportButton.addEventListener("click", callbacks.onExport);
  const exportRow = document.createElement("div");
  exportRow.className = "row";
  exportRow.appendChild(exportButton);

  const loadInput = document.createElement("input");
  loadInput.type = "file";
  loadInput.accept = "application/json";
  loadInput.id = "scenario-load-input";
  loadInput.className = "scenario-file-input";
  loadInput.addEventListener("change", () => {
    const file = loadInput.files?.[0];
    if (file) callbacks.onLoad(file);
    loadInput.value = "";
  });
  const loadLabel = document.createElement("label");
  loadLabel.setAttribute("for", "scenario-load-input");
  loadLabel.className = "scenario-file-label";
  loadLabel.textContent = "Load scenario…";
  const loadRow = document.createElement("div");
  loadRow.className = "row";
  loadRow.append(loadInput, loadLabel);

  const barrierExampleButton = document.createElement("button");
  barrierExampleButton.textContent = "Example: barrier split";
  barrierExampleButton.addEventListener("click", () => callbacks.onLoadExample("barrier-split"));

  const meteorExampleButton = document.createElement("button");
  meteorExampleButton.textContent = "Example: meteor radiation";
  meteorExampleButton.addEventListener("click", () => callbacks.onLoadExample("meteor-radiation"));

  const exampleRow = document.createElement("div");
  exampleRow.className = "row";
  exampleRow.append(barrierExampleButton, meteorExampleButton);

  root.append(hint, exportRow, loadRow, exampleRow);
  return { root };
}

export interface ControlsCallbacks {
  onPlayPause: () => void;
  onStep: () => void;
  onSpeedChange: (speed: SpeedSetting) => void;
  onRestart: (seed: number) => void;
  onDeuteranopiaToggle: (enabled: boolean) => void;
  onCompetitionHeatmapToggle: (enabled: boolean) => void;
}

export interface ControlsHandle {
  root: HTMLElement;
  inspectorRoot: HTMLElement;
  setPlaying: (playing: boolean) => void;
  setStatus: (tick: number, population: number, livingSpeciesCount: number) => void;
  setInspected: (creature: Creature | null) => void;
}

export function createControls(callbacks: ControlsCallbacks): ControlsHandle {
  const root = document.createElement("div");
  root.className = "panel controls";

  const playPauseButton = document.createElement("button");
  playPauseButton.textContent = "Play";
  playPauseButton.addEventListener("click", callbacks.onPlayPause);

  const stepButton = document.createElement("button");
  stepButton.textContent = "Step";
  stepButton.addEventListener("click", callbacks.onStep);

  const playbackRow = document.createElement("div");
  playbackRow.className = "row";
  playbackRow.append(playPauseButton, stepButton);

  const speedRow = document.createElement("div");
  speedRow.className = "row";
  const speedButtons = new Map<SpeedSetting, HTMLButtonElement>();
  for (const speed of SPEED_OPTIONS) {
    const btn = document.createElement("button");
    btn.textContent = speed === "max" ? "max" : `${speed}x`;
    btn.addEventListener("click", () => {
      for (const b of speedButtons.values()) b.classList.remove("active");
      btn.classList.add("active");
      callbacks.onSpeedChange(speed);
    });
    speedButtons.set(speed, btn);
    speedRow.appendChild(btn);
  }
  speedButtons.get(1)?.classList.add("active");

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = "12345";
  seedInput.className = "seed-input";

  const restartButton = document.createElement("button");
  restartButton.textContent = "Restart with seed";
  restartButton.addEventListener("click", () => callbacks.onRestart(Number(seedInput.value) || 0));

  const seedRow = document.createElement("div");
  seedRow.className = "row";
  seedRow.append(seedInput, restartButton);

  const deuteranopiaLabel = document.createElement("label");
  deuteranopiaLabel.className = "row";
  const deuteranopiaCheckbox = document.createElement("input");
  deuteranopiaCheckbox.type = "checkbox";
  deuteranopiaCheckbox.addEventListener("change", () => callbacks.onDeuteranopiaToggle(deuteranopiaCheckbox.checked));
  deuteranopiaLabel.append(deuteranopiaCheckbox, document.createTextNode("Deuteranopia-safe hues"));

  const heatmapLabel = document.createElement("label");
  heatmapLabel.className = "row";
  const heatmapCheckbox = document.createElement("input");
  heatmapCheckbox.type = "checkbox";
  heatmapCheckbox.addEventListener("change", () => callbacks.onCompetitionHeatmapToggle(heatmapCheckbox.checked));
  heatmapLabel.append(heatmapCheckbox, document.createTextNode("Competition heatmap (World view)"));

  const status = document.createElement("div");
  status.className = "status";

  root.append(
    sectionTitle("Playback"),
    playbackRow,
    speedRow,
    sectionTitle("Seed"),
    seedRow,
    sectionTitle("Display"),
    deuteranopiaLabel,
    heatmapLabel,
    status,
  );

  const inspectorRoot = document.createElement("div");
  inspectorRoot.className = "panel inspector";
  inspectorRoot.append(sectionTitle("Inspector"));
  const inspectorBody = document.createElement("div");
  inspectorBody.className = "inspector-body";
  inspectorBody.textContent = "Click a creature to inspect it.";
  inspectorRoot.appendChild(inspectorBody);

  return {
    root,
    inspectorRoot,
    setPlaying(playing: boolean) {
      playPauseButton.textContent = playing ? "Pause" : "Play";
    },
    setStatus(tickCount: number, population: number, livingSpeciesCount: number) {
      status.textContent = `tick ${tickCount.toLocaleString()} — population ${population.toLocaleString()} — ${livingSpeciesCount.toLocaleString()} species`;
    },
    setInspected(creature: Creature | null) {
      inspectorBody.replaceChildren(...renderInspector(creature));
    },
  };
}

export interface GodModeCallbacks {
  onToolSelect: (tool: GodTool | null) => void;
  onRadiusChange: (radius: number) => void;
  onStrengthChange: (strength: number) => void;
  onDurationChange: (durationTicks: number) => void;
  onSeedCountChange: (count: number) => void;
  onUndoMeteor: () => void;
}

export interface GodModeHandle {
  root: HTMLElement;
  setActiveTool: (tool: GodTool | null) => void;
  setUndoEnabled: (enabled: boolean) => void;
}

export function createGodModePanel(callbacks: GodModeCallbacks, showUndo = true): GodModeHandle {
  const root = document.createElement("div");
  root.className = "panel godmode";
  root.append(sectionTitle("God mode"));

  const hint = document.createElement("div");
  hint.className = "godmode-hint";
  hint.textContent = "Select a tool, then click the map.";

  const toolRow = document.createElement("div");
  toolRow.className = "row";
  const toolButtons = new Map<GodTool, HTMLButtonElement>();

  const noneButton = document.createElement("button");
  noneButton.textContent = "None (inspect)";
  noneButton.classList.add("active");
  noneButton.addEventListener("click", () => {
    setActive(null);
    callbacks.onToolSelect(null);
  });
  toolRow.appendChild(noneButton);

  function setActive(tool: GodTool | null): void {
    noneButton.classList.toggle("active", tool === null);
    for (const [t, btn] of toolButtons) btn.classList.toggle("active", t === tool);
    hint.textContent = tool ? GOD_TOOL_HINTS[tool] : "Select a tool, then click the map.";
  }

  for (const tool of GOD_TOOLS) {
    const btn = document.createElement("button");
    btn.textContent = GOD_TOOL_LABELS[tool];
    btn.addEventListener("click", () => {
      setActive(tool);
      callbacks.onToolSelect(tool);
    });
    toolButtons.set(tool, btn);
    toolRow.appendChild(btn);
  }

  const radiusRow = sliderRow("Radius / width", 2, 60, 15, 1, (v) => callbacks.onRadiusChange(v));
  const strengthRow = sliderRow("Strength", 0, 1, 0.5, 0.05, (v) => callbacks.onStrengthChange(v));
  const durationRow = sliderRow("Duration (ticks, 0 = instant)", 0, 2000, 0, 50, (v) => callbacks.onDurationChange(v));

  const seedCountRow = document.createElement("div");
  seedCountRow.className = "row";
  const seedCountLabel = document.createElement("span");
  seedCountLabel.textContent = "Seed count";
  const seedCountInput = document.createElement("input");
  seedCountInput.type = "number";
  seedCountInput.value = "20";
  seedCountInput.min = "1";
  seedCountInput.className = "seed-input";
  seedCountInput.addEventListener("change", () => callbacks.onSeedCountChange(Number(seedCountInput.value) || 1));
  seedCountRow.append(seedCountLabel, seedCountInput);

  const undoButton = document.createElement("button");
  undoButton.textContent = "Undo last meteor";
  undoButton.disabled = true;
  undoButton.addEventListener("click", callbacks.onUndoMeteor);
  const undoRow = document.createElement("div");
  undoRow.className = "row";
  undoRow.appendChild(undoButton);

  root.append(hint, toolRow, radiusRow.row, strengthRow.row, durationRow.row, seedCountRow);
  if (showUndo) root.appendChild(undoRow);

  return {
    root,
    setActiveTool: setActive,
    setUndoEnabled(enabled: boolean) {
      undoButton.disabled = !enabled;
    },
  };
}

export interface ScatterPanelCallbacks {
  onXGeneChange: (gene: keyof Genome) => void;
  onYGeneChange: (gene: keyof Genome) => void;
}

export interface ScatterPanelHandle {
  root: HTMLElement;
}

/**
 * Axis pickers for the gene-space scatter. No color key here — per SPEC.md, the scatter plot
 * itself *is* the legend, since every point already sits at its own genome position wearing its
 * own color. This panel only needs to pick which two genes become x/y.
 */
export function createScatterPanel(defaultXGene: keyof Genome, defaultYGene: keyof Genome, callbacks: ScatterPanelCallbacks): ScatterPanelHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Gene-space scatter"));

  const xRow = geneSelectRow("X axis", defaultXGene, callbacks.onXGeneChange);
  const yRow = geneSelectRow("Y axis", defaultYGene, callbacks.onYGeneChange);
  root.append(xRow, yRow);

  return { root };
}

function geneSelectRow(label: string, initial: keyof Genome, onChange: (gene: keyof Genome) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const select = document.createElement("select");
  for (const key of GENE_KEYS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key;
    if (key === initial) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value as keyof Genome));

  row.append(labelEl, select);
  return row;
}

function sliderRow(
  label: string,
  min: number,
  max: number,
  initial: number,
  step: number,
  onChange: (value: number) => void,
): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement("div");
  row.className = "row slider-row";

  const labelEl = document.createElement("span");
  labelEl.className = "slider-label";
  labelEl.textContent = label;

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);

  const valueEl = document.createElement("span");
  valueEl.className = "slider-value";
  valueEl.textContent = String(initial);

  input.addEventListener("input", () => {
    valueEl.textContent = input.value;
    onChange(Number(input.value));
  });

  row.append(labelEl, input, valueEl);
  return { row, input };
}

export function createLegend(): HTMLElement {
  const root = document.createElement("div");
  root.className = "panel legend";
  root.append(sectionTitle("Legend"));

  const entries: [HTMLElement, string][] = [
    [squareSwatch(FOOD_R_COLOR), "Food, type R — square size shows how much is left there"],
    [squareSwatch(FOOD_B_COLOR), "Food, type B — same, other food type"],
    [dotSwatch(), "A creature — dot color encodes its genome (diet, foraging style, life history). Click one to inspect it."],
  ];
  for (const [swatch, text] of entries) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const label = document.createElement("span");
    label.textContent = text;
    row.append(swatch, label);
    root.appendChild(row);
  }

  return root;
}

function squareSwatch(color: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "legend-swatch";
  el.style.background = color;
  return el;
}

function dotSwatch(): HTMLElement {
  const el = document.createElement("span");
  el.className = "legend-swatch legend-swatch--dot";
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("h3");
  el.textContent = text;
  return el;
}

function renderInspector(creature: Creature | null): HTMLElement[] {
  if (!creature) {
    const empty = document.createElement("div");
    empty.textContent = "Click a creature to inspect it.";
    return [empty];
  }

  const table = document.createElement("table");
  const rows: [string, string][] = [
    ["id", String(creature.id)],
    ["species", String(creature.lineageId)],
    ["parentId", creature.parentId === null ? "—" : String(creature.parentId)],
    ["birthTick", String(creature.birthTick)],
    ["age", String(creature.age)],
    ["energy", creature.energy.toFixed(2)],
    ...GENE_KEYS.map((key): [string, string] => [key, creature.genome[key].toFixed(3)]),
  ];
  for (const [label, value] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    table.appendChild(tr);
  }

  return [table];
}

export interface EventFeedHandle {
  root: HTMLElement;
  setEvents: (events: TaxonomyEvent[]) => void;
}

const MAX_FEED_ENTRIES = 100;

export function createEventFeed(): EventFeedHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Event feed"));

  const list = document.createElement("div");
  list.className = "event-feed-list";
  list.textContent = "Nothing has happened yet.";
  root.appendChild(list);

  let lastRenderedCount = 0;

  return {
    root,
    setEvents(events) {
      if (events.length === lastRenderedCount) return;
      lastRenderedCount = events.length;
      if (events.length === 0) {
        // A restart or freshly-loaded scenario resets the log to empty — without this the old
        // entries from the previous run would linger on screen since replaceChildren below never runs.
        list.textContent = "Nothing has happened yet.";
        return;
      }
      // Newest first, capped so the DOM doesn't grow without bound over a very long run.
      const recent = events.slice(-MAX_FEED_ENTRIES).reverse();
      list.replaceChildren(...recent.map(describeTaxonomyEvent));
    },
  };
}

function describeTaxonomyEvent(taxonomyEvent: TaxonomyEvent): HTMLElement {
  const el = document.createElement("div");
  el.className = "event-feed-entry";
  if (taxonomyEvent.type === "speciation") {
    const { tick: eventTick, mechanism, dominantDivergentGene, founderCount, speciesId, parentId } = taxonomyEvent.event;
    el.textContent = `Tick ${eventTick.toLocaleString()} — ${mechanism} split: species ${speciesId} branched from species ${parentId} (${founderCount} founders; ${dominantDivergentGene} diverged most)`;
  } else {
    const { tick: eventTick, speciesId, lifespanTicks, peakMemberCount } = taxonomyEvent.event;
    el.textContent = `Tick ${eventTick.toLocaleString()} — species ${speciesId} went extinct after ${lifespanTicks.toLocaleString()} ticks (peak population ${peakMemberCount.toLocaleString()})`;
  }
  return el;
}

export interface GeneFlowChartHandle {
  root: HTMLElement;
  render: (history: GeneFlowSample[]) => void;
}

export function createGeneFlowChart(): GeneFlowChartHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Gene flow"));

  const hint = document.createElement("div");
  hint.className = "godmode-hint";
  hint.textContent = "Migrations between the west and east halves of the map, per window. This dropping to zero is speciation happening in real time.";

  const canvas = document.createElement("canvas");
  canvas.width = 272;
  canvas.height = 60;
  canvas.className = "gene-flow-canvas";

  root.append(hint, canvas);
  const ctx = canvas.getContext("2d")!;

  return {
    root,
    render(history) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (history.length === 0) return;

      const recent = history.slice(-60);
      const maxValue = Math.max(1, ...recent.map((sample) => sample.migrations));
      const barWidth = canvas.width / recent.length;

      ctx.fillStyle = "#4a7dd9";
      recent.forEach((sample, i) => {
        const barHeight = (sample.migrations / maxValue) * (canvas.height - 4);
        ctx.fillRect(i * barWidth, canvas.height - barHeight, Math.max(barWidth - 1, 1), barHeight);
      });
    },
  };
}

export interface TraitChartHandle {
  root: HTMLElement;
  render: (history: TraitSample[], gene: keyof Genome) => void;
}

/** Population mean (line) +/- std (shaded band) for one selectable gene over time. */
export function createTraitChart(defaultGene: keyof Genome, onGeneChange: (gene: keyof Genome) => void): TraitChartHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Trait over time"));
  root.append(geneSelectRow("Gene", defaultGene, onGeneChange));

  const canvas = document.createElement("canvas");
  canvas.width = 272;
  canvas.height = 80;
  canvas.className = "gene-flow-canvas";
  root.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  return {
    root,
    render(history, gene) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (history.length === 0) return;

      const recent = history.slice(-150);
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const sample of recent) {
        yMin = Math.min(yMin, sample.mean[gene] - sample.std[gene]);
        yMax = Math.max(yMax, sample.mean[gene] + sample.std[gene]);
      }
      if (yMax <= yMin) {
        yMin -= 0.5;
        yMax += 0.5;
      }

      const w = canvas.width;
      const h = canvas.height;
      const tickToX = (i: number) => (i / Math.max(1, recent.length - 1)) * w;
      const valueToY = (v: number) => h - ((v - yMin) / (yMax - yMin)) * h;

      ctx.fillStyle = "rgba(74, 125, 217, 0.25)";
      ctx.beginPath();
      recent.forEach((sample, i) => {
        const x = tickToX(i);
        const y = valueToY(sample.mean[gene] + sample.std[gene]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = recent.length - 1; i >= 0; i--) {
        ctx.lineTo(tickToX(i), valueToY(recent[i].mean[gene] - recent[i].std[gene]));
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#4a7dd9";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      recent.forEach((sample, i) => {
        const x = tickToX(i);
        const y = valueToY(sample.mean[gene]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    },
  };
}

const ALL_MECHANISMS: SpeciationMechanism[] = ["founder-population", "allopatric", "sympatric", "founder"];
const MECHANISM_LABELS: Record<SpeciationMechanism, string> = {
  "founder-population": "Founding population",
  allopatric: "Allopatric (barrier)",
  sympatric: "Sympatric (disruptive selection)",
  founder: "Founder effect (drift)",
};

export interface TreePanelCallbacks {
  onMechanismFilterChange: (filter: Set<SpeciationMechanism>) => void;
  onFilterToLineage: () => void;
  onClearLineageFilter: () => void;
}

export interface TreePanelHandle {
  root: HTMLElement;
  setSelectedSpecies: (
    species: Species | null,
    currentTick: number,
    colorOptions: ColorOptions,
    foundingCentroid: Genome,
    capabilities: Capability[],
  ) => void;
  setLineageFilterActive: (active: boolean) => void;
}

export function createTreePanel(callbacks: TreePanelCallbacks): TreePanelHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Tree filters"));

  const activeMechanisms = new Set<SpeciationMechanism>(ALL_MECHANISMS);
  const filterColumn = document.createElement("div");
  for (const mechanism of ALL_MECHANISMS) {
    const label = document.createElement("label");
    label.className = "row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) activeMechanisms.add(mechanism);
      else activeMechanisms.delete(mechanism);
      callbacks.onMechanismFilterChange(new Set(activeMechanisms));
    });
    label.append(checkbox, document.createTextNode(MECHANISM_LABELS[mechanism]));
    filterColumn.appendChild(label);
  }
  root.appendChild(filterColumn);

  const cardRoot = document.createElement("div");
  cardRoot.className = "panel species-card";
  cardRoot.append(sectionTitle("Selected species"));
  const cardBody = document.createElement("div");
  cardBody.className = "inspector-body";
  cardBody.textContent = "Click a branch in the tree to inspect it.";
  cardRoot.appendChild(cardBody);

  const filterButton = document.createElement("button");
  filterButton.textContent = "Show only this lineage in World view";
  filterButton.disabled = true;
  filterButton.addEventListener("click", callbacks.onFilterToLineage);
  const clearButton = document.createElement("button");
  clearButton.textContent = "Clear filter";
  clearButton.addEventListener("click", callbacks.onClearLineageFilter);
  const filterRow = document.createElement("div");
  filterRow.className = "row";
  filterRow.append(filterButton, clearButton);
  cardRoot.appendChild(filterRow);

  root.appendChild(cardRoot);

  return {
    root,
    setSelectedSpecies(species, currentTick, colorOptions, foundingCentroid, capabilities) {
      filterButton.disabled = species === null;
      if (!species) {
        cardBody.textContent = "Click a branch in the tree to inspect it.";
        return;
      }

      const founderSwatch = squareSwatch(genotypeColor(species.foundingCentroid, foundingCentroid, colorOptions));
      const currentSwatch = squareSwatch(genotypeColor(species.centroid, foundingCentroid, colorOptions));
      const swatchRow = document.createElement("div");
      swatchRow.className = "legend-row";
      swatchRow.append(
        document.createTextNode("founding "),
        founderSwatch,
        document.createTextNode(" → current "),
        currentSwatch,
      );

      const table = document.createElement("table");
      const status = species.extinctTick === null ? "alive" : `extinct at tick ${species.extinctTick.toLocaleString()}`;
      const lifespan = (species.extinctTick ?? currentTick) - species.originTick;
      const rows: [string, string][] = [
        ["species", String(species.id)],
        ["parent", species.parentId === null ? "— (founding population)" : String(species.parentId)],
        ["origin tick", species.originTick.toLocaleString()],
        ["status", status],
        ["lifespan so far", `${lifespan.toLocaleString()} ticks`],
        ["peak population", species.peakMemberCount.toLocaleString()],
        ["current population", species.extinctTick === null ? species.memberCount.toLocaleString() : "0"],
        ["mechanism", MECHANISM_LABELS[species.mechanism]],
        ["dominant divergent gene", species.dominantDivergentGene ?? "—"],
      ];
      for (const [label, value] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(th, td);
        table.appendChild(tr);
      }

      const capabilitiesSection = document.createElement("div");
      capabilitiesSection.className = "capability-list";
      if (capabilities.length === 0) {
        const empty = document.createElement("div");
        empty.className = "capability-empty";
        empty.textContent = "No demonstrated capabilities detected yet — needs more observed behavior.";
        capabilitiesSection.appendChild(empty);
      } else {
        for (const capability of capabilities) {
          const chip = document.createElement("span");
          chip.className = "capability-chip";
          chip.title = capability.evidence;
          chip.textContent = `${capability.displayName} (${Math.round(capability.confidence * 100)}%)`;
          capabilitiesSection.appendChild(chip);
        }
      }

      cardBody.replaceChildren(swatchRow, table, capabilitiesSection);
    },
    setLineageFilterActive(active) {
      clearButton.disabled = !active;
    },
  };
}

const GAME_PHASE_LABELS: Record<GamePhase, string> = {
  terraform: "Terraform — act now",
  evolution: "Evolution running…",
  discovery: "Discovery — review the era",
};

export interface GameControlsCallbacks {
  onRestart: (seed: number, mode: GameMode, challengeId: string | null) => void;
  onAdvanceEra: () => void;
  onContinue: () => void;
  onSpeedChange: (speed: SpeedSetting) => void;
}

export interface GameControlsHandle {
  root: HTMLElement;
  setStatus: (era: number, phase: GamePhase, tick: number, population: number, livingSpeciesCount: number) => void;
  setBudget: (remaining: number | null) => void;
  setAdvanceEnabled: (enabled: boolean) => void;
  setContinueEnabled: (enabled: boolean) => void;
  setTerraformError: (message: string | null) => void;
  /** null hides/idles the bar (no era advancing); 0-1 fills it proportionally. */
  setProgress: (fraction: number | null) => void;
}

/** Mode/seed/era-advancement controls for Game Mode — the terraform -> evolution -> discovery
 * loop (see src/game/), distinct from the classic sandbox's continuous play/pause/speed controls. */
export function createGameControlsPanel(challenges: ChallengeDefinition[], callbacks: GameControlsCallbacks): GameControlsHandle {
  const root = document.createElement("div");
  root.className = "panel controls";
  root.append(sectionTitle("Game"));

  const modeSelect = document.createElement("select");
  const sandboxOption = document.createElement("option");
  sandboxOption.value = "sandbox";
  sandboxOption.textContent = "Sandbox";
  modeSelect.appendChild(sandboxOption);
  for (const challenge of challenges) {
    const option = document.createElement("option");
    option.value = challenge.id;
    option.textContent = `Challenge: ${challenge.name}`;
    modeSelect.appendChild(option);
  }
  const modeRow = document.createElement("div");
  modeRow.className = "row";
  modeRow.appendChild(modeSelect);

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = "12345";
  seedInput.className = "seed-input";
  const restartButton = document.createElement("button");
  restartButton.textContent = "Restart";
  restartButton.addEventListener("click", () => {
    const value = modeSelect.value;
    const mode: GameMode = value === "sandbox" ? "sandbox" : "challenge";
    callbacks.onRestart(Number(seedInput.value) || 0, mode, mode === "challenge" ? value : null);
  });
  const seedRow = document.createElement("div");
  seedRow.className = "row";
  seedRow.append(seedInput, restartButton);

  const advanceButton = document.createElement("button");
  advanceButton.textContent = "Advance Era";
  advanceButton.addEventListener("click", callbacks.onAdvanceEra);
  const continueButton = document.createElement("button");
  continueButton.textContent = "Continue to terraform";
  continueButton.disabled = true;
  continueButton.addEventListener("click", callbacks.onContinue);
  const actionRow = document.createElement("div");
  actionRow.className = "row";
  actionRow.append(advanceButton, continueButton);

  // Fills as stepEraAdvance() ticks toward the era's target, so "how much longer" is visible at
  // a glance instead of only the tick count in the status line below.
  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar";
  const progressFill = document.createElement("div");
  progressFill.className = "progress-bar-fill";
  progressBar.appendChild(progressFill);

  // Same speed vocabulary as the classic sandbox's playback controls — how fast an era's ticks
  // fly by while advancing, so you can actually watch terrain/creatures change instead of only
  // seeing the before/after result (see app/gameRunner.ts's stepEraAdvance).
  const speedRow = document.createElement("div");
  speedRow.className = "row";
  const speedButtons = new Map<SpeedSetting, HTMLButtonElement>();
  for (const speed of SPEED_OPTIONS) {
    const btn = document.createElement("button");
    btn.textContent = speed === "max" ? "max" : `${speed}x`;
    btn.addEventListener("click", () => {
      for (const b of speedButtons.values()) b.classList.remove("active");
      btn.classList.add("active");
      callbacks.onSpeedChange(speed);
    });
    speedButtons.set(speed, btn);
    speedRow.appendChild(btn);
  }
  speedButtons.get(10)?.classList.add("active");

  const status = document.createElement("div");
  status.className = "status";
  const budgetStatus = document.createElement("div");
  budgetStatus.className = "status";
  const errorLine = document.createElement("div");
  errorLine.className = "godmode-hint game-error";

  root.append(sectionTitle("Mode"), modeRow, sectionTitle("Seed"), seedRow, actionRow, progressBar, sectionTitle("Era speed"), speedRow, status, budgetStatus, errorLine);

  return {
    root,
    setStatus(era, phase, tick, population, livingSpeciesCount) {
      status.textContent = `Era ${era} — ${GAME_PHASE_LABELS[phase]} — tick ${tick.toLocaleString()} — population ${population.toLocaleString()} — ${livingSpeciesCount} species`;
    },
    setBudget(remaining) {
      budgetStatus.textContent = remaining === null ? "Terraform points: unlimited (sandbox)" : `Terraform points: ${remaining}`;
    },
    setProgress(fraction) {
      progressFill.style.width = fraction === null ? "0%" : `${Math.round(fraction * 100)}%`;
    },
    setAdvanceEnabled(enabled) {
      advanceButton.disabled = !enabled;
    },
    setContinueEnabled(enabled) {
      continueButton.disabled = !enabled;
    },
    setTerraformError(message) {
      errorLine.textContent = message ?? "";
    },
  };
}

export interface EraSummaryHandle {
  root: HTMLElement;
  setSummary: (summary: EraSummary | null) => void;
}

export function createEraSummaryPanel(): EraSummaryHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Era summary"));

  const body = document.createElement("div");
  body.className = "inspector-body";
  body.textContent = "Advance an era to see what changed.";
  root.appendChild(body);

  return {
    root,
    setSummary(summary) {
      if (!summary) {
        body.textContent = "Advance an era to see what changed.";
        return;
      }

      const { before, after, delta, notableTraitShifts } = summary;
      const lines: string[] = [
        `Era ${after.era} complete (tick ${before.tick.toLocaleString()} → ${after.tick.toLocaleString()})`,
        `Population: ${before.totalPopulation.toLocaleString()} → ${after.totalPopulation.toLocaleString()} (${delta.populationChange >= 0 ? "+" : ""}${delta.populationChange.toLocaleString()})`,
        `Species: ${delta.livingSpeciesCountBefore} → ${delta.livingSpeciesCountAfter}`,
      ];
      if (delta.newSpeciesIds.length > 0) lines.push(`New species: ${delta.newSpeciesIds.join(", ")}`);
      if (delta.extinctSpeciesIds.length > 0) lines.push(`Extinct: ${delta.extinctSpeciesIds.join(", ")}`);
      if (notableTraitShifts.length > 0) {
        lines.push("Major trait changes:");
        for (const shift of notableTraitShifts.slice(0, 5)) {
          const pct = (shift.fractionChange * 100).toFixed(0);
          lines.push(`  ${shift.gene}: ${shift.fractionChange >= 0 ? "+" : ""}${pct}%`);
        }
      }

      body.replaceChildren(
        ...lines.map((line) => {
          const el = document.createElement("div");
          el.textContent = line;
          return el;
        }),
      );
    },
  };
}

export interface ObjectivesHandle {
  root: HTMLElement;
  setChallenge: (objectives: GameObjective[], status: ChallengeStatus | null) => void;
}

export function createObjectivesPanel(): ObjectivesHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Objectives"));

  const body = document.createElement("div");
  body.className = "inspector-body";
  body.textContent = "Sandbox mode has no objectives — free play.";
  root.appendChild(body);

  return {
    root,
    setChallenge(objectives, status) {
      if (objectives.length === 0 || !status) {
        body.textContent = "Sandbox mode has no objectives — free play.";
        return;
      }

      const list = document.createElement("div");
      for (const objective of objectives) {
        const progress = status.objectiveProgress.get(objective.id);
        const row = document.createElement("div");
        row.className = "legend-row";
        row.textContent = `${progress?.complete ? "[x]" : "[ ]"} ${objective.description}`;
        list.appendChild(row);
      }
      if (status.allObjectivesComplete) {
        const banner = document.createElement("div");
        banner.className = "game-win-banner";
        banner.textContent = "Challenge complete!";
        list.appendChild(banner);
      } else if (status.eraLimitReached) {
        const banner = document.createElement("div");
        banner.className = "godmode-hint";
        banner.textContent = "Era limit reached — challenge over.";
        list.appendChild(banner);
      }
      body.replaceChildren(list);
    },
  };
}

/** Structurally matches app/gameRunner.ts's GameCheckpoint — duplicated rather than imported so
 * ui/ never depends on app/ (app already depends on ui/; the reverse would be a cycle). */
export interface CheckpointSummary {
  id: string;
  name: string;
  era: number;
  tick: number;
  createdAt: number;
}

export interface CheckpointsCallbacks {
  onSave: (name: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

export interface CheckpointsHandle {
  root: HTMLElement;
  setCheckpoints: (checkpoints: CheckpointSummary[]) => void;
}

/** Named, session-only save points the player can jump back to — restoring one never deletes any
 * other, so they behave like git branches: explicit save points, explicit "Delete" to collapse
 * one you're done with. */
export function createCheckpointsPanel(callbacks: CheckpointsCallbacks): CheckpointsHandle {
  const root = document.createElement("div");
  root.className = "panel";
  root.append(sectionTitle("Checkpoints"));

  const hint = document.createElement("div");
  hint.className = "godmode-hint";
  hint.textContent = "Save a named point in time, then jump back to it later — restoring one doesn't delete the others.";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Checkpoint name";
  nameInput.className = "seed-input checkpoint-name-input";
  const saveButton = document.createElement("button");
  saveButton.textContent = "Save Checkpoint";
  saveButton.addEventListener("click", () => {
    callbacks.onSave(nameInput.value);
    nameInput.value = "";
  });
  const saveRow = document.createElement("div");
  saveRow.className = "row";
  saveRow.append(nameInput, saveButton);

  const list = document.createElement("div");
  list.className = "event-feed-list";
  list.textContent = "No checkpoints saved yet.";

  root.append(hint, saveRow, list);

  return {
    root,
    setCheckpoints(checkpoints) {
      if (checkpoints.length === 0) {
        list.textContent = "No checkpoints saved yet.";
        return;
      }

      list.replaceChildren(
        ...checkpoints.map((checkpoint) => {
          const row = document.createElement("div");
          row.className = "event-feed-entry checkpoint-entry";

          const label = document.createElement("span");
          label.textContent = `${checkpoint.name} — era ${checkpoint.era}, tick ${checkpoint.tick.toLocaleString()}`;

          const restoreButton = document.createElement("button");
          restoreButton.textContent = "Restore";
          restoreButton.addEventListener("click", () => callbacks.onRestore(checkpoint.id));

          const deleteButton = document.createElement("button");
          deleteButton.textContent = "Delete";
          deleteButton.addEventListener("click", () => callbacks.onDelete(checkpoint.id));

          row.append(label, restoreButton, deleteButton);
          return row;
        }),
      );
    },
  };
}
