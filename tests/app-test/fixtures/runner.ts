/**
 * runner.ts — drive a COMMITTED fixture session through the production
 * dev-card picker → spawn → reveal path, for behavior/correctness legs.
 *
 * Mirrors `corpus/runner.ts`'s picker dance (never Tab/Tab/Enter — the
 * picker's Enter fall-through opens a NEW session) but is decoupled from
 * the perf corpus's snapshot/budget machinery: the source is a small
 * committed fixture, so these legs run everywhere and never touch the
 * private live archive.
 */

import { expect } from "bun:test";
import type { App } from "../_harness";
import type { SeededFixtureSession } from "./resolve";

export const PICKER_FORM = ".dev-card-picker-form";
export const RECENTS = '[data-tug-focus-key="dev-picker-cycle:1"]';
export const OPEN = '[data-tug-focus-key="dev-picker-cycle:5"]';
export const TRANSCRIPT =
  '[data-card-id="A"] [data-testid="dev-card-transcript"]';
/** The scroll container CardHost captures/restores under this region key. */
export const SCROLLER =
  '[data-card-id="A"] [data-tug-scroll-key="dev-card-transcript"]';

export const rowSel = (id: string): string => `[data-session-id="${id}"]`;

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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function clickElement(app: App, selector: string): Promise<boolean> {
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

export interface OpenFixtureOpts {
  /** Saved card-state bag to inject (Phase B restore). */
  cardStates?: Record<string, unknown>;
  listTimeoutMs?: number;
}

/**
 * Seed the deck (optionally with a restore bag), drive the picker to the
 * seeded fixture, and click Open. Returns when Open has been clicked —
 * call {@link waitForTranscriptSettled} next.
 */
export async function openFixtureSession(
  app: App,
  seeded: SeededFixtureSession,
  opts: OpenFixtureOpts = {},
): Promise<{ openedAt: number }> {
  await app.seedDeckState({
    state: deckShape(),
    ...(opts.cardStates ? { cardStates: opts.cardStates } : {}),
    focusCardId: "A",
  });
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
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(rowSel(seeded.sessionId))}) !== null`,
    { timeoutMs: opts.listTimeoutMs ?? 15_000 },
  );

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
  return { openedAt };
}

/**
 * Wait until the resumed transcript has settled: replay done, scroller
 * mounted, content scrollable (scrollHeight exceeds the viewport), and
 * pinned at the bottom (the resumed list follows the bottom).
 */
export async function waitForTranscriptSettled(
  app: App,
  timeoutMs = 20_000,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var host = document.querySelector(${JSON.stringify(TRANSCRIPT)});
      if (host === null || host.hasAttribute("data-replaying")) return false;
      var el = document.querySelector(${JSON.stringify(SCROLLER)});
      if (el === null) return false;
      return el.scrollHeight > el.clientHeight + 200;
    })()`,
    { timeoutMs },
  );
}
