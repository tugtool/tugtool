/**
 * at0086-tide-route-indicator-badge.test.ts — `TideRouteIndicatorBadge`
 * repaints when the prompt-entry route flips, and keeps its mount
 * identity across the flip ([AT0086]).
 *
 * ## Why this exists
 *
 * Step 6 of the tide-prompt-entry-zones plan made the Z4B indicator
 * badge route-aware (Table T01, reduced to Code / Shell after Command's
 * retirement):
 *
 *    - `❯` Code → `Claude Code <version>` (drift-aware, popover)
 *    - `$` Shell → `<shell name>` (from `HostFactsStore`)
 *
 * Two regression surfaces:
 *
 *   1. **Route-driven content.** Flipping the route must repaint the
 *      badge text per Table T01 — `Claude Code …` on Code, the shell
 *      name (or the `shell` placeholder before host facts resolve) on
 *      Shell. The badge subscribes to `RouteLifecycle` via
 *      `useSyncExternalStore` ([L02]), so the flip drives a re-render
 *      in one commit.
 *
 *   2. **Mount identity ([L26], Risk R03).** The badge is one
 *      component branching internally on route — not per-route
 *      components and not route-keyed. React must reconcile the
 *      `TugBadge` DOM node as the same element across a flip; the
 *      Code-branch popover state survives a flip-away-and-back through
 *      Shell.
 *
 * ## Test matrix
 *
 *   One test, one Tide card:
 *
 *     1. Default route is Code → indicator text starts with
 *        `Claude Code`; capture the badge's DOM node.
 *     2. Click the Shell choice segment → text no longer starts with
 *        `Claude Code` (the shell branch renders the host's shell
 *        basename or the `shell` placeholder); badge DOM node identity
 *        is preserved.
 *     3. Click the Code choice segment → text starts with
 *        `Claude Code` again; badge DOM node identity is preserved
 *        across the round trip.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const BADGE_SELECTOR =
  '[data-card-id="A"] [data-slot="tide-route-indicator-badge"]';
const SHELL_SEGMENT_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar .tug-choice-group-segment:nth-of-type(2)';
const CODE_SEGMENT_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar .tug-choice-group-segment:nth-of-type(1)';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "tide", title: "Tide", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 540 },
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

/** Read the indicator badge's text content. `null` if the badge is gone. */
async function readBadgeText(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(BADGE_SELECTOR)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

/**
 * Pin the badge's DOM node on `window` so a later test step can
 * reference-compare against the live node and detect a remount.
 */
async function pinBadgeNode(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      var w = window;
      w.__atRouteIndicator = w.__atRouteIndicator || {};
      w.__atRouteIndicator.pinned = document.querySelector(${JSON.stringify(BADGE_SELECTOR)});
    })()`,
  );
}

/** True when the currently-queried badge node is the previously pinned one. */
async function badgeStillSamePinnedNode(app: App): Promise<boolean> {
  return await app.evalJS<boolean>(
    `(function(){
      var w = window;
      var live = document.querySelector(${JSON.stringify(BADGE_SELECTOR)});
      return live !== null && live === (w.__atRouteIndicator && w.__atRouteIndicator.pinned);
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0086: TideRouteIndicatorBadge repaints on route flip with mount identity",
  () => {
    test(
      "Code → Shell → Code: text follows the route; badge DOM node identity is preserved",
      async () => {
        const app = await launchTugApp({
          testName: "at0086-tide-route-indicator-badge",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: deckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindTideSession("A");
          await app.awaitEngineReady("A");

          // Default route is Code — the indicator shows the
          // `Claude Code …` face (running version, or `?` until
          // metadata lands; the prefix is what matters here).
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(BADGE_SELECTOR)});
              return el !== null && el.textContent.trim().indexOf("Claude Code") === 0;
            })()`,
            { timeoutMs: 4000 },
          );
          const codeFaceA = await readBadgeText(app);
          expect(
            codeFaceA,
            "Code-route indicator must start with `Claude Code`",
          ).not.toBeNull();
          expect(codeFaceA!.startsWith("Claude Code")).toBe(true);

          // Pin the badge node so we can detect a remount across the
          // route flip.
          await pinBadgeNode(app);

          // Flip to Shell — the badge text must change to the shell
          // branch (the host's shell basename if `HostFactsStore`
          // resolved, otherwise the `shell` placeholder). The mount
          // identity invariant ([L26], Risk R03) is the same DOM node
          // surviving the flip.
          await app.click(SHELL_SEGMENT_SELECTOR);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(BADGE_SELECTOR)});
              if (el === null) return false;
              var txt = el.textContent.trim();
              return txt.length > 0 && txt.indexOf("Claude Code") !== 0;
            })()`,
            { timeoutMs: 4000 },
          );
          const shellFace = await readBadgeText(app);
          expect(
            shellFace,
            "Shell-route indicator must not be empty",
          ).not.toBeNull();
          expect(shellFace!.startsWith("Claude Code")).toBe(false);

          expect(
            await badgeStillSamePinnedNode(app),
            "Risk R03 / [L26]: the badge DOM node must survive the Code → Shell flip",
          ).toBe(true);

          // Flip back to Code — the badge returns to the
          // `Claude Code …` face, and the same DOM node survives the
          // round trip.
          await app.click(CODE_SEGMENT_SELECTOR);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(BADGE_SELECTOR)});
              return el !== null && el.textContent.trim().indexOf("Claude Code") === 0;
            })()`,
            { timeoutMs: 4000 },
          );
          const codeFaceB = await readBadgeText(app);
          expect(
            codeFaceB,
            "Code-route indicator must start with `Claude Code` after the round trip",
          ).not.toBeNull();
          expect(codeFaceB!.startsWith("Claude Code")).toBe(true);

          expect(
            await badgeStillSamePinnedNode(app),
            "Risk R03 / [L26]: the badge DOM node must survive a Code → Shell → Code round trip",
          ).toBe(true);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0086-tide-route-indicator-badge] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
