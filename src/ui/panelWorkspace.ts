interface StoredPanelLayout {
  order: string[];
  minimized: string[];
  wide: string[];
}

const STORAGE_VERSION = 1;

function panelIdFor(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readLayout(storageKey: string): StoredPanelLayout | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredPanelLayout> & { version?: number };
    if (candidate.version !== STORAGE_VERSION) return null;
    if (!Array.isArray(candidate.order) || !Array.isArray(candidate.minimized) || !Array.isArray(candidate.wide)) return null;
    return {
      order: candidate.order.filter((value): value is string => typeof value === "string"),
      minimized: candidate.minimized.filter((value): value is string => typeof value === "string"),
      wide: candidate.wide.filter((value): value is string => typeof value === "string"),
    };
  } catch {
    return null;
  }
}

function writeLayout(storageKey: string, layout: StoredPanelLayout): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: STORAGE_VERSION, ...layout }));
  } catch {
    // Layout persistence is a convenience. The workspace remains fully usable when storage is
    // unavailable (private browsing policies, a full quota, or an embedded browser restriction).
  }
}

/**
 * Turns the existing panel list into a lightweight workspace without coupling any individual
 * panel to layout behavior. DOM order is the snapped-grid order; panel contents and callbacks are
 * left untouched. Each app mode gets its own saved layout and minimized tray.
 */
export function enablePanelWorkspace(sidebar: HTMLElement, workspaceName: string): void {
  const root = sidebar.closest<HTMLElement>(".app-mode-root");
  if (!root) return;

  const storageKey = `critterbranch.panel-workspace.${workspaceName}`;
  const panels = Array.from(sidebar.querySelectorAll<HTMLElement>(":scope > .panel"));
  const panelById = new Map<string, HTMLElement>();
  const panelTitleById = new Map<string, string>();
  const minimized = new Set<string>();
  const wide = new Set<string>();
  let draggedPanel: HTMLElement | null = null;
  let draggedHeader: HTMLElement | null = null;
  let activePointerId: number | null = null;
  let pointerStart = { x: 0, y: 0 };
  let isDragging = false;

  const workspaceBar = document.createElement("div");
  workspaceBar.className = "panel-workspace-bar";
  const workspaceHint = document.createElement("span");
  workspaceHint.textContent = "Drag panel titles to rearrange";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "panel-workspace-reset";
  resetButton.textContent = "Reset panels";
  workspaceBar.append(workspaceHint, resetButton);
  sidebar.prepend(workspaceBar);

  const tray = document.createElement("aside");
  tray.className = "panel-tray";
  tray.setAttribute("aria-label", "Minimized panels");
  const trayLabel = document.createElement("span");
  trayLabel.className = "panel-tray-label";
  trayLabel.textContent = "Minimized";
  const trayItems = document.createElement("div");
  trayItems.className = "panel-tray-items";
  tray.append(trayLabel, trayItems);
  root.appendChild(tray);

  function orderedPanels(): HTMLElement[] {
    return Array.from(sidebar.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("panel"));
  }

  function snapshot(): StoredPanelLayout {
    return {
      order: orderedPanels().map((panel) => panel.dataset.panelId!),
      minimized: Array.from(minimized),
      wide: Array.from(wide),
    };
  }

  function save(): void {
    writeLayout(storageKey, snapshot());
  }

  function renderTray(): void {
    trayItems.replaceChildren();
    for (const panel of orderedPanels()) {
      const id = panel.dataset.panelId!;
      if (!minimized.has(id)) continue;
      const restoreButton = document.createElement("button");
      restoreButton.type = "button";
      restoreButton.textContent = panelTitleById.get(id) ?? id;
      restoreButton.title = `Restore ${restoreButton.textContent}`;
      restoreButton.addEventListener("click", () => setMinimized(id, false));
      trayItems.appendChild(restoreButton);
    }
    tray.hidden = trayItems.childElementCount === 0;
  }

  function setMinimized(id: string, value: boolean, persist = true): void {
    const panel = panelById.get(id);
    if (!panel) return;
    panel.classList.toggle("panel--minimized", value);
    const button = panel.querySelector<HTMLButtonElement>(".panel-minimize-toggle");
    button?.setAttribute("aria-pressed", String(value));
    if (value) minimized.add(id);
    else minimized.delete(id);
    renderTray();
    if (persist) save();
  }

  function setWide(id: string, value: boolean, persist = true): void {
    const panel = panelById.get(id);
    if (!panel) return;
    panel.classList.toggle("panel--wide", value);
    const button = panel.querySelector<HTMLButtonElement>(".panel-size-toggle");
    button?.setAttribute("aria-pressed", String(value));
    button!.title = value ? "Use normal panel width" : "Span the full sidebar width";
    if (value) wide.add(id);
    else wide.delete(id);
    if (persist) save();
  }

  for (const panel of panels) {
    const heading = panel.querySelector<HTMLHeadingElement>(":scope > h3");
    if (!heading) continue;
    const title = heading.textContent?.trim() || "Panel";
    let id = panelIdFor(title) || `panel-${panelById.size + 1}`;
    if (panelById.has(id)) id = `${id}-${panelById.size + 1}`;
    panel.dataset.panelId = id;
    panelById.set(id, panel);
    panelTitleById.set(id, title);

    const header = document.createElement("div");
    header.className = "panel-header";
    header.title = `Drag to move ${title}`;
    heading.classList.add("panel-title");

    const actions = document.createElement("div");
    actions.className = "panel-actions";
    const sizeButton = document.createElement("button");
    sizeButton.type = "button";
    sizeButton.className = "panel-size-toggle";
    sizeButton.textContent = "↔";
    sizeButton.title = "Span the full sidebar width";
    sizeButton.setAttribute("aria-label", `Change width of ${title}`);
    sizeButton.setAttribute("aria-pressed", "false");
    sizeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setWide(id, !wide.has(id));
    });

    const minimizeButton = document.createElement("button");
    minimizeButton.type = "button";
    minimizeButton.className = "panel-minimize-toggle";
    minimizeButton.textContent = "−";
    minimizeButton.title = `Minimize ${title}`;
    minimizeButton.setAttribute("aria-label", `Minimize ${title}`);
    minimizeButton.setAttribute("aria-pressed", "false");
    minimizeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setMinimized(id, true);
    });

    actions.append(sizeButton, minimizeButton);
    header.append(heading, actions);
    panel.prepend(header);

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      draggedPanel = panel;
      draggedHeader = header;
      activePointerId = event.pointerId;
      pointerStart = { x: event.clientX, y: event.clientY };
      isDragging = false;
      header.setPointerCapture(event.pointerId);
    });

    header.addEventListener("pointermove", (event) => {
      if (!draggedPanel || activePointerId !== event.pointerId) return;
      if (!isDragging) {
        const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
        if (distance < 6) return;
        isDragging = true;
        draggedPanel.classList.add("panel--dragging");
      }
      event.preventDefault();

      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".panel");
      if (!target || target === draggedPanel || target.parentElement !== sidebar) return;
      const rect = target.getBoundingClientRect();
      const sameRow = event.clientY >= rect.top && event.clientY <= rect.bottom;
      const after = sameRow ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
      sidebar.insertBefore(draggedPanel, after ? target.nextSibling : target);
      // Persist as the snapped order changes, not only on pointerup. Some browsers cancel pointer
      // capture when the captured element moves in the DOM; saving here keeps the final visible
      // order durable even in that case.
      save();
    });

    const finishPointerDrag = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) return;
      if (draggedHeader?.hasPointerCapture(event.pointerId)) draggedHeader.releasePointerCapture(event.pointerId);
      draggedPanel?.classList.remove("panel--dragging");
      if (isDragging) {
        save();
        renderTray();
      }
      draggedPanel = null;
      draggedHeader = null;
      activePointerId = null;
      isDragging = false;
    };
    header.addEventListener("pointerup", finishPointerDrag);
    header.addEventListener("pointercancel", finishPointerDrag);
  }

  const initialOrder = panels.map((panel) => panel.dataset.panelId!).filter(Boolean);
  const saved = readLayout(storageKey);
  if (saved) {
    for (const id of saved.order) {
      const panel = panelById.get(id);
      if (panel) sidebar.appendChild(panel);
    }
    for (const id of initialOrder) {
      const panel = panelById.get(id);
      if (panel && !saved.order.includes(id)) sidebar.appendChild(panel);
    }
    for (const id of saved.wide) setWide(id, true, false);
    for (const id of saved.minimized) setMinimized(id, true, false);
  }
  renderTray();

  resetButton.addEventListener("click", () => {
    for (const id of initialOrder) {
      const panel = panelById.get(id);
      if (panel) sidebar.appendChild(panel);
      setMinimized(id, false, false);
      setWide(id, false, false);
    }
    save();
    renderTray();
  });
}
