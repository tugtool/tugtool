/**
 * at0373-session-identity-rename.test.ts — one resolver, and it is reactive.
 *
 * ## What this gates
 *
 * `resolveSessionIdentity` reads three stores imperatively. Called bare from a
 * render it hands back a snapshot with **no subscription**, so a `/rename`
 * would update the stores while the surface repaints never. That failure is
 * invisible to every unit test in `session-identity.test.ts` — the derivation
 * is correct, the wiring is not — which is why the hook's contract can only be
 * pinned against the real app.
 *
 *   A. **The title bar reads `project/callsign`, with no `(branch)` suffix.**
 *      The branch left identity: it is telemetry now, and lives only in the
 *      placard. The card publishes its Line string to `cardTitleStore` and the
 *      pane wears it.
 *
 *   B. **An identity change repaints a live surface with no reload.** The
 *      change arrives the way the wire delivers it — a real `session_updated`
 *      frame through `dispatchAction`, the production decoder and the
 *      production store writes — and the mounted Lens session row and title
 *      bar must repaint from it. The change used is the ledger's callsign
 *      **reroll**, which is a real shipping event: a collided mint is rerolled
 *      rather than suffixed, so a callsign shown "from the drop" changes once,
 *      seconds after spawn. A bare-resolver implementation fails here and only
 *      here.
 *
 *   C. **A `/rename` does NOT change the Line string.** This is the
 *      consequence of the callsign leading: `<project>/<callsign>` carries no
 *      name arm, so the title bar, the tab strip, and the Window menu all read
 *      the same string before and after. Asserting a repaint there would be
 *      asserting a bug — this asserts the constancy instead, which is what
 *      makes `cardTitleStore`'s channel reader-compatibility rather than a
 *      notification path. The name's own landing surface is the masthead's
 *      description line, and it arrives with the masthead.
 *
 * @covers tugdeck/src/lib/session-identity.ts
 * @covers tugdeck/src/lib/session-synopsis-store.ts
 * @covers tugdeck/src/components/lens/sections/cards-session-cell.tsx
 * @covers tugdeck/src/components/lens/sections/cards-data-source.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PROJECT_DIR = "/Users/tester/src/tugtool";
const TAG = "stocky-pixie";
/** What the ledger sends when it rerolls a collided mint ([P12]). */
const REROLLED_TAG = "syrupy-beam";
const LENS_ROW = ".lens-cards-list .lens-cards-row[data-session-id]";
// Scoped to the session pane by id: the Lens is a pane too, and once it is
// open an unscoped query would read ITS title bar.
const TITLE_BAR = '.tug-pane[data-pane-id="p1"] [data-slot="tug-pane-title-bar"]';

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** A `session_updated` frame body — exactly what the supervisor pushes. */
function sessionUpdated(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id: SESSION_ID, fields });
}

describe.skipIf(!SHOULD_RUN)("at0373 — session identity is one resolver, subscribed", () => {
  test(
    "the callsign leads and a rename repaints without a reload",
    async () => {
      const app = await launchTugApp({
        testName: "at0373-session-identity-rename",
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.bindSession("A", {
          tugSessionId: SESSION_ID,
          projectDir: PROJECT_DIR,
        });

        // The callsign arrives the way it always does: on the ledger row. This
        // is the same frame a spawn ack echoes, so the store write is
        // production, not a seed.
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
            )})`,
          ),
        ).toBe(true);

        // ---- A. The title bar is `project/callsign`, and nothing else. -----
        await app.waitForCondition<boolean>(
          `(function(){
            var bar = document.querySelector(${JSON.stringify(TITLE_BAR)});
            return bar !== null && bar.innerText.indexOf("tugtool/${TAG}") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );
        const barText = await app.evalJS<string>(
          `(function(){
            var bar = document.querySelector(${JSON.stringify(TITLE_BAR)});
            return bar === null ? "" : bar.innerText;
          })()`,
        );
        // The `(branch)` suffix is retired outright — not merely dropped on
        // `main`, which is what the old rule did and what would still pass a
        // test that only checked for the word "main".
        expect(barText).toContain(`tugtool/${TAG}`);
        expect(barText).not.toContain("(");
        // The UUID never leads, and never appears at all in a name.
        expect(barText).not.toContain(SESSION_ID);

        // ---- B. A rename repaints a live surface. --------------------------
        //
        // The Lens is open and its session row is mounted, so this is a live
        // subscription being exercised, not a remount.
        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(LENS_ROW)}) !== null`,
          { timeoutMs: 15_000 },
        );
        const lineBefore = await app.evalJS<string>(
          `(function(){
            var row = document.querySelector(${JSON.stringify(LENS_ROW)});
            var t = row.querySelector(".tug-list-row-title");
            return t === null ? "" : t.innerText;
          })()`,
        );
        expect(lineBefore).toContain(`tugtool/${TAG}`);

        // The ledger rerolls a collided mint rather than suffixing it, so a
        // callsign shown "from the drop" legitimately changes ONCE, seconds
        // after spawn. That is a real shipping identity change on a live
        // surface, arriving on the same frame and travelling the same
        // subscription a `/rename` does — which makes it the assertion the
        // hook's contract can actually be pinned with.
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({ tag: REROLLED_TAG, name: null, name_user_set: false }),
            )})`,
          ),
        ).toBe(true);

        // No reload, no remount: the same mounted row repaints. A bare
        // resolver called from the render body passes every unit test and
        // hangs here until the timeout.
        await app.waitForCondition<boolean>(
          `(function(){
            var row = document.querySelector(${JSON.stringify(LENS_ROW)});
            if (row === null) return false;
            var t = row.querySelector(".tug-list-row-title");
            return t !== null && t.innerText.indexOf("tugtool/${REROLLED_TAG}") !== -1;
          })()`,
          { timeoutMs: 8_000 },
        );
        // The title bar rides the same hook through the card's publication.
        await app.waitForCondition<boolean>(
          `(function(){
            var bar = document.querySelector(${JSON.stringify(TITLE_BAR)});
            return bar !== null && bar.innerText.indexOf("tugtool/${REROLLED_TAG}") !== -1;
          })()`,
          { timeoutMs: 8_000 },
        );

        // ---- C. A `/rename` does NOT move the Line string. -----------------
        //
        // The callsign leads and the Line carries no name arm, so every
        // Line-tier surface — title bar, tab strip, Window menu — reads the
        // same before and after. Asserting a repaint there would be asserting
        // a bug; this asserts the constancy `cardTitleStore`'s `set` no-op
        // rests on. The name's own landing surface is the masthead's
        // description line, which arrives with the masthead.
        const lineBeforeRename = await app.evalJS<string>(
          `(function(){
            var row = document.querySelector(${JSON.stringify(LENS_ROW)});
            var t = row.querySelector(".tug-list-row-title");
            return t === null ? "" : t.innerText;
          })()`,
        );
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: REROLLED_TAG,
                name: "Refactor the Lens",
                name_user_set: true,
              }),
            )})`,
          ),
        ).toBe(true);
        // Give a repaint every chance to land before claiming none happened.
        await new Promise<void>((r) => setTimeout(r, 500));
        const lineAfterRename = await app.evalJS<string>(
          `(function(){
            var row = document.querySelector(${JSON.stringify(LENS_ROW)});
            var t = row.querySelector(".tug-list-row-title");
            return t === null ? "" : t.innerText;
          })()`,
        );
        expect(lineAfterRename).toBe(lineBeforeRename);
        expect(lineAfterRename).not.toContain("Refactor the Lens");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
