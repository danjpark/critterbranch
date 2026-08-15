import type { DiscoveryMatch } from "../game/discovery/discoveryJournal.ts";
import { DISCOVERY_REGISTRY } from "../game/discovery/discoveryDefinition.ts";

/**
 * Non-blocking Critterdex notifications (SPEC.md Addendum 23). A discovery is the payoff moment of
 * the whole observability stack — a lineage demonstrably held a capability for long enough to
 * count — and until now it only ever appeared as a line buried in the Era Summary panel, which is
 * easy to scroll past and gone the moment you continue.
 *
 * Deliberately does NOT pause the simulation. Dan's framing: the game keeps running, but the
 * player is told they *can* pause, and clicking takes them to the creature that earned it. An
 * automatic pause would make discoveries feel like interruptions rather than invitations.
 */

/** Long enough to notice and read mid-play, short enough that a burst of discoveries at one era
 * boundary doesn't wall off the view. Hovering suspends it (see below) so this is a floor on how
 * long it's readable, not a deadline. */
const TOAST_LIFETIME_MS = 14_000;

/** Beyond this the stack starts covering the world it's pointing at; the oldest is retired early
 * to make room rather than letting them pile up off-screen. */
const MAX_VISIBLE_TOASTS = 3;

export interface DiscoveryToastCallbacks {
  /** The player clicked a toast: fly to the species and explain it. */
  onInspect: (match: DiscoveryMatch) => void;
  /** The player used the toast's own pause affordance. */
  onPause: () => void;
  /** Whether the sim is currently running, so the toast can label its pause control honestly
   * instead of offering to pause something already paused. */
  isPlaying: () => boolean;
}

export interface DiscoveryToastLayer {
  root: HTMLElement;
  /** Shows one toast per match. Safe to call with an empty array (the common case — most eras
   * confirm nothing). */
  show: (matches: DiscoveryMatch[]) => void;
  /** Re-reads `isPlaying()` and shows or hides each visible toast's Pause control accordingly.
   * Call from the render loop: whether there's anything to pause changes independently of the
   * toasts (an era finishes, or the player starts the next one while a toast is still up), and a
   * control whose availability was frozen at creation time would be lying within a second. */
  syncPlayState: () => void;
  /** Drops every visible toast without firing callbacks — for a restart or checkpoint restore,
   * where the discoveries they refer to no longer belong to the timeline being played. */
  clear: () => void;
}

const displayNameById = new Map(DISCOVERY_REGISTRY.map((definition) => [definition.id, definition.displayName]));
const hintById = new Map(DISCOVERY_REGISTRY.map((definition) => [definition.id, definition.hint]));

export function discoveryDisplayName(match: DiscoveryMatch): string {
  return displayNameById.get(match.definitionId) ?? match.definitionId;
}

export function discoveryHint(match: DiscoveryMatch): string {
  return hintById.get(match.definitionId) ?? "";
}

export interface DiscoveryDetailCard {
  root: HTMLElement;
  /** Shows the full explanation for one discovery, or hides the card when passed null. */
  setMatch: (match: DiscoveryMatch | null, confirmationEras: number) => void;
}

/**
 * The "why and how did I earn this" card, shown next to the world after the camera flies to the
 * species that earned it. Every line here is evidence the run actually produced — the measured
 * behavior the classifier read, and the era span it had to hold it for — rather than a generic
 * achievement blurb, because the whole point of the Critterdex is that a discovery is a claim
 * about what a lineage demonstrably DID (SPEC.md Addendum 16's "Genome != Capability").
 */
export function createDiscoveryDetailCard(onClose: () => void): DiscoveryDetailCard {
  const root = document.createElement("div");
  root.className = "discovery-detail";
  root.hidden = true;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "discovery-detail-close";
  close.textContent = "×";
  close.title = "Close";
  close.addEventListener("click", onClose);

  const kicker = document.createElement("span");
  kicker.className = "discovery-detail-kicker";
  const title = document.createElement("h4");
  title.className = "discovery-detail-title";
  const meaning = document.createElement("p");
  meaning.className = "discovery-detail-meaning";
  const list = document.createElement("dl");
  list.className = "discovery-detail-list";

  root.append(close, kicker, title, meaning, list);

  function row(term: string, detail: string): void {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = detail;
    list.append(dt, dd);
  }

  return {
    root,
    setMatch: (match, confirmationEras) => {
      if (!match) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      kicker.textContent = "Critterdex entry";
      title.textContent = discoveryDisplayName(match);
      meaning.textContent = discoveryHint(match);

      list.replaceChildren();
      row("Earned by", `Species ${match.speciesId}`);
      row("Evidence", match.evidence || "demonstrated over the confirming eras");
      row(
        "How it was earned",
        `Held this capability for ${confirmationEras} consecutive era boundaries — first seen at era ${match.firstQualifiedEra}, confirmed at era ${match.confirmedEra}. A single era holding it is not enough; it has to persist.`,
      );
    },
  };
}

export function createDiscoveryToastLayer(callbacks: DiscoveryToastCallbacks): DiscoveryToastLayer {
  const root = document.createElement("div");
  root.className = "discovery-toasts";
  root.setAttribute("aria-live", "polite");

  const timers = new Map<HTMLElement, number>();

  function dismiss(toast: HTMLElement): void {
    const timer = timers.get(toast);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(toast);
    toast.classList.add("discovery-toast--leaving");
    // Let the CSS transition finish before removing, but don't depend on transitionend firing —
    // a toast removed while the tab is backgrounded would otherwise leak.
    window.setTimeout(() => toast.remove(), 220);
  }

  function scheduleDismiss(toast: HTMLElement): void {
    const existing = timers.get(toast);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.set(toast, window.setTimeout(() => dismiss(toast), TOAST_LIFETIME_MS));
  }

  function buildToast(match: DiscoveryMatch): HTMLElement {
    const toast = document.createElement("div");
    toast.className = "discovery-toast";

    const kicker = document.createElement("span");
    kicker.className = "discovery-toast-kicker";
    kicker.textContent = "Critterdex entry unlocked";

    const title = document.createElement("strong");
    title.className = "discovery-toast-title";
    title.textContent = discoveryDisplayName(match);

    const body = document.createElement("span");
    body.className = "discovery-toast-body";
    body.textContent = `Species ${match.speciesId} — ${discoveryHint(match)}`;

    const actions = document.createElement("div");
    actions.className = "discovery-toast-actions";

    const inspect = document.createElement("button");
    inspect.type = "button";
    inspect.className = "discovery-toast-inspect";
    inspect.textContent = "Show me";
    inspect.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onInspect(match);
      dismiss(toast);
    });

    const pause = document.createElement("button");
    pause.type = "button";
    pause.className = "discovery-toast-pause";
    pause.textContent = "Pause to look";
    pause.hidden = !callbacks.isPlaying();
    pause.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onPause();
      pause.hidden = true;
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "discovery-toast-close";
    close.textContent = "×";
    close.title = "Dismiss";
    close.setAttribute("aria-label", `Dismiss ${discoveryDisplayName(match)} notification`);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      dismiss(toast);
    });

    actions.append(inspect, pause);
    toast.append(close, kicker, title, body, actions);

    // Clicking anywhere on the card does what the primary action does — the whole toast is the
    // target, the button is just the visible affordance.
    toast.addEventListener("click", () => {
      callbacks.onInspect(match);
      dismiss(toast);
    });

    // Reading shouldn't race a timer: hovering holds the toast open, leaving restarts its clock.
    toast.addEventListener("pointerenter", () => {
      const timer = timers.get(toast);
      if (timer !== undefined) window.clearTimeout(timer);
    });
    toast.addEventListener("pointerleave", () => scheduleDismiss(toast));

    return toast;
  }

  return {
    root,
    show: (matches) => {
      for (const match of matches) {
        const toast = buildToast(match);
        root.appendChild(toast);
        scheduleDismiss(toast);
      }
      // Counted over toasts that AREN'T already on their way out. dismiss() only marks a toast as
      // leaving and removes it a transition later, so counting raw children here would never see
      // the count drop and would spin forever.
      const liveToasts = (): HTMLElement[] =>
        Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains("discovery-toast--leaving"));
      let live = liveToasts();
      while (live.length > MAX_VISIBLE_TOASTS) {
        dismiss(live[0]);
        live = liveToasts();
      }
    },
    syncPlayState: () => {
      const playing = callbacks.isPlaying();
      for (const button of root.querySelectorAll<HTMLButtonElement>(".discovery-toast-pause")) {
        button.hidden = !playing;
      }
    },
    clear: () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      root.replaceChildren();
    },
  };
}
