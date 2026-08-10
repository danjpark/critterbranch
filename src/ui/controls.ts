import { FOOD_B_COLOR, FOOD_R_COLOR } from "../render/color.ts";
import type { Creature } from "../sim/creature.ts";
import { GENE_KEYS } from "../sim/genome.ts";

export type SpeedSetting = 1 | 10 | 100 | 1000 | "max";

const SPEED_OPTIONS: SpeedSetting[] = [1, 10, 100, 1000, "max"];

export interface ControlsCallbacks {
  onPlayPause: () => void;
  onStep: () => void;
  onSpeedChange: (speed: SpeedSetting) => void;
  onRestart: (seed: number) => void;
  onDeuteranopiaToggle: (enabled: boolean) => void;
}

export interface ControlsHandle {
  root: HTMLElement;
  inspectorRoot: HTMLElement;
  setPlaying: (playing: boolean) => void;
  setStatus: (tick: number, population: number) => void;
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
    setStatus(tickCount: number, population: number) {
      status.textContent = `tick ${tickCount.toLocaleString()} — population ${population.toLocaleString()}`;
    },
    setInspected(creature: Creature | null) {
      inspectorBody.replaceChildren(...renderInspector(creature));
    },
  };
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
