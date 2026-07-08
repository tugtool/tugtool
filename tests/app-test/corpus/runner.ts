/**
 * runner.ts — shared driving helpers for corpus resume legs.
 *
 * Owns the picker mount-seed flow (NEVER Tab/Tab/Enter — the picker's
 * Enter fall-through opens a NEW session; see at0182's lore), the
 * reveal-chain sampler, and the per-class budgets. Consumed by the
 * baseline leg (at0185) and the optimization re-measure legs.
 */

import { expect } from "bun:test";
import type { App } from "../_harness";
import type { SeededCorpusSession } from "./resolve";
import type { SelectedSnapshot } from "./harvest";

export const PICKER_FORM = ".dev-card-picker-form";
export const RECENTS = '[data-tug-focus-key="dev-picker-cycle:1"]';
export const OPEN = '[data-tug-focus-key="dev-picker-cycle:5"]';
export const USER_ROWS =
  '[data-card-id="A"] [data-testid="dev-card-transcript-user-body"]';
export const TRANSCRIPT =
  '[data-card-id="A"] [data-testid="dev-card-transcript"]';
export const RESTORING = '[data-testid="dev-card-restoring"]';

export const rowSel = (id: string): string => `[data-session-id="${id}"]`;

/** A sampling gap longer than this is recorded as a main-thread stall. */
export const STALL_THRESHOLD_MS = 250;

export interface ClassBudgets {
  listTimeoutMs: number;
  settleTimeoutMs: number;
  tolerateIncomplete: boolean;
}

export function budgetsFor(snap: SelectedSnapshot): ClassBudgets {
  switch (snap.class) {
    case "typical":
      return {
        listTimeoutMs: 30_000,
        settleTimeoutMs: 60_000,
        tolerateIncomplete: false,
      };
    case "heavy":
      return {
        listTimeoutMs: 60_000,
        settleTimeoutMs: 180_000,
        tolerateIncomplete: false,
      };
    case "whale":
      return {
        listTimeoutMs: 180_000,
        settleTimeoutMs: 300_000,
        tolerateIncomplete: true,
      };
  }
}

export function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

export function clickElement(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return false;
      el.scrollIntoView({ block: "nearest" });
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
}

export const PROGRESS_STRIP = '[data-testid="dev-replay-progress"]';

export interface UiSample {
  restoring: boolean;
  transcript: boolean;
  replaying: boolean;
  /** The replay progress strip is mounted. */
  affordance: boolean;
  /**
   * The prompt entry exists and is INTERACTIVE — its root is not
   * `inert`, or its content DOM is contenteditable (caret-capable).
   */
  entryEditable: boolean;
  rows: number;
  perfDone: boolean;
}

export const SAMPLE_SCRIPT = `(function(){
  var perfDone = false;
  try {
    var p = window.__tug.getSessionPerf("A");
    perfDone = p.lastReplay !== null;
  } catch (e) {}
  var host = document.querySelector(${JSON.stringify(TRANSCRIPT)});
  return {
    restoring: document.querySelector(${JSON.stringify(RESTORING)}) !== null,
    transcript: host !== null,
    replaying: host !== null && host.hasAttribute("data-replaying"),
    affordance: document.querySelector(${JSON.stringify(PROGRESS_STRIP)}) !== null,
    entryEditable: (function(){
      var root = document.querySelector('[data-card-id="A"] [data-slot="tug-prompt-entry"]');
      if (root === null) return false;
      if (!root.hasAttribute("inert")) return true;
      var c = root.querySelector(".cm-content");
      return c !== null && c.getAttribute("contenteditable") === "true";
    })(),
    rows: document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length,
    perfDone: perfDone
  };
})()`;

export interface RevealTimeline {
  placeholderFirstMs: number | null;
  placeholderGoneMs: number | null;
  firstTranscriptMs: number | null;
  firstRowsMs: number | null;
  replayingClearedMs: number | null;
  /** First sample with the replay progress strip mounted. */
  affordanceFirstMs: number | null;
  /**
   * Longest run of consecutive BLANK samples — no placeholder, no
   * progress strip, no mounted rows. The feedback criterion: a user
   * staring at the card always sees something honest.
   */
  maxBlankRunMs: number;
  /**
   * A sample taken while the replay window was still open (ingest not
   * yet complete) observed an INTERACTIVE prompt entry — the whole
   * entry must be inert until the restore completes. Checked against
   * `perfDone` (window completion), not settle, so the progress
   * strip's post-completion dismissal dwell cannot false-positive.
   */
  entryEditableDuringReplay: boolean;
  perfDoneMs: number | null;
  settledMs: number | null;
  stalls: { atMs: number; ms: number }[];
  samples: number;
}

/**
 * Sample the reveal chain in a tight RPC loop until the resume settles
 * (ingest window closed AND ≥1 user row mounted — windowed-aware) or
 * the deadline passes. Each loop iteration's wall-clock gap doubles as
 * the stall detector: a frozen main thread cannot answer `evalJS`.
 */
export async function auditReveal(
  app: App,
  openedAt: number,
  deadlineMs: number,
): Promise<RevealTimeline> {
  const tl: RevealTimeline = {
    placeholderFirstMs: null,
    placeholderGoneMs: null,
    firstTranscriptMs: null,
    firstRowsMs: null,
    replayingClearedMs: null,
    affordanceFirstMs: null,
    maxBlankRunMs: 0,
    entryEditableDuringReplay: false,
    perfDoneMs: null,
    settledMs: null,
    stalls: [],
    samples: 0,
  };
  let sawReplaying = false;
  let lastSampleAt = openedAt;
  let blankRunStartedAt: number | null = null;
  while (Date.now() - openedAt < deadlineMs) {
    let sample: UiSample | null = null;
    try {
      sample = await app.evalJS<UiSample>(SAMPLE_SCRIPT, {
        timeoutMs: deadlineMs,
      });
    } catch {
      // RPC gave up before the page thawed — record the gap and stop.
      tl.stalls.push({
        atMs: lastSampleAt - openedAt,
        ms: Date.now() - lastSampleAt,
      });
      break;
    }
    const now = Date.now();
    const offset = now - openedAt;
    const gap = now - lastSampleAt;
    if (gap > STALL_THRESHOLD_MS) {
      tl.stalls.push({ atMs: lastSampleAt - openedAt, ms: gap });
    }
    lastSampleAt = now;
    tl.samples += 1;

    if (sample.restoring && tl.placeholderFirstMs === null) {
      tl.placeholderFirstMs = offset;
    }
    if (
      !sample.restoring &&
      tl.placeholderFirstMs !== null &&
      tl.placeholderGoneMs === null
    ) {
      tl.placeholderGoneMs = offset;
    }
    if (sample.transcript && tl.firstTranscriptMs === null) {
      tl.firstTranscriptMs = offset;
    }
    if (sample.rows > 0 && tl.firstRowsMs === null) tl.firstRowsMs = offset;
    if (sample.affordance && tl.affordanceFirstMs === null) {
      tl.affordanceFirstMs = offset;
    }
    // Blank-run tracking: nothing honest on screen this sample.
    const blank = !sample.restoring && !sample.affordance && sample.rows === 0;
    if (blank) {
      if (blankRunStartedAt === null) blankRunStartedAt = now;
      const run = now - blankRunStartedAt;
      if (run > tl.maxBlankRunMs) tl.maxBlankRunMs = run;
    } else {
      blankRunStartedAt = null;
    }
    if (sample.entryEditable && !sample.perfDone) {
      tl.entryEditableDuringReplay = true;
    }
    if (sample.replaying) sawReplaying = true;
    if (
      sawReplaying &&
      !sample.replaying &&
      sample.transcript &&
      tl.replayingClearedMs === null
    ) {
      tl.replayingClearedMs = offset;
    }
    if (sample.perfDone && tl.perfDoneMs === null) tl.perfDoneMs = offset;
    if (sample.perfDone && sample.rows > 0) {
      tl.settledMs = offset;
      break;
    }
  }
  return tl;
}

export interface PerfRead {
  replay: { frames: number; commits: number } | null;
  lastReplay: {
    startedAtMs: number;
    completedAtMs: number | null;
    frames: number;
    folds: number;
    commits: number;
  } | null;
  rowParse: {
    parses: number;
    cacheHits: number;
    memoHits: number;
    identities: number;
    maxParsesPerIdentity: number;
  };
}

/**
 * Drive the deck from a seeded snapshot to the moment Open is clicked:
 * deck seeding, picker mount-seed (path auto-fill), session listing,
 * row selection. Returns the list latency and the Open timestamp.
 */
export async function openSeededSession(
  app: App,
  seeded: SeededCorpusSession,
  budgets: ClassBudgets,
): Promise<{ listMs: number; openedAt: number; listed: boolean }> {
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`,
    { timeoutMs: 8000 },
  );
  await app.evalJS<null>(
    `(window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [${JSON.stringify(seeded.projectDir)}] } }), null)`,
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(RECENTS)}) !== null`,
    { timeoutMs: 8000 },
  );
  // The picker one-shot-seeds the path field from the host hint / home the
  // moment it mounts — usually BEFORE the tugbank recents push above lands —
  // so the field cannot be assumed to auto-fill from the seeded recent.
  // Click the seeded Recents row instead (a recent click fills the input;
  // the list stays put), then wait for the fill.
  expect(
    await clickElement(
      app,
      `.dev-card-picker-recents-list [data-recent-path=${JSON.stringify(seeded.projectDir)}]`,
    ),
  ).toBe(true);
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(".dev-card-picker-form input");
      return el !== null && el.value === ${JSON.stringify(seeded.projectDir)};
    })()`,
    { timeoutMs: 8000 },
  );

  const listStartedAt = Date.now();
  let listed = true;
  try {
    await app.waitForCondition<boolean>(
      `document.querySelector(${JSON.stringify(rowSel(seeded.sessionId))}) !== null`,
      { timeoutMs: budgets.listTimeoutMs },
    );
  } catch (err) {
    if (!budgets.tolerateIncomplete) throw err;
    listed = false;
  }
  const listMs = Date.now() - listStartedAt;
  if (!listed) return { listMs, openedAt: 0, listed };

  expect(await clickElement(app, rowSel(seeded.sessionId))).toBe(true);
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(rowSel(seeded.sessionId))});
      return el !== null && el.getAttribute("data-selected") === "true";
    })()`,
    { timeoutMs: 6000 },
  );

  const openedAt = Date.now();
  expect(await clickElement(app, OPEN)).toBe(true);
  return { listMs, openedAt, listed };
}
