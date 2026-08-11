/**
 * at0381-session-citation-surfaces.test.ts — a session is named the same way
 * from foreign context.
 *
 * ## What this gates
 *
 * Two surfaces that referred to a session by something other than its identity,
 * each for its own reason, and each fixed by pointing at the same rule:
 *
 *   A. **The tab strip.** A stacked Session card's tab read the literal registry
 *      title "Session", because the tab consulted `cardTitleStore` only for
 *      `componentId === "text"`. Its own title bar meanwhile read
 *      `project/callsign`, so the same card had two names two inches apart.
 *      Both now compose through `cardTitleTextFor`, and the assertion is on the
 *      **stacked** card — the one that is NOT frontmost — because the frontmost
 *      one would pass even with the gate still in place (the pane's masthead
 *      names it).
 *
 *   B. **A Gazette session ref.** `RefChip` labelled by `target.split("/").pop()`,
 *      which is a no-op on a UUID, so the rail printed all thirty-six
 *      characters of an id nobody can read. It renders the session atom now.
 *
 *   C. **An unresolvable citation is inert, and looks it.** A ref naming a
 *      session this ledger has no record of keeps the atom's shape, dashes its
 *      border, and takes no click — a reference that resolved to nothing
 *      must not look like one that resolves. That verdict comes from the
 *      ledger, over `resolve_sessions`, which is why the assertion waits for
 *      the answer rather than for the chip.
 *
 * @covers tugdeck/src/lib/pane-title.ts
 * @covers tugdeck/src/components/tugways/tug-tab-bar.tsx
 * @covers tugdeck/src/components/gazette/gazette-card.tsx
 * @covers tugdeck/src/components/tugways/tug-session-identity.tsx
 * @covers tugdeck/src/lib/session-citation-store.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const ALIEN_ID = "0badf00d-dead-4bee-8fee-000000000000";
const PROJECT_DIR = "/Users/tester/src/tugtool";
const TAG = "stocky-pixie";

const PANE = '.tug-pane[data-pane-id="p1"]';
const TAB_BAR = `${PANE} [data-slot="tug-tab-bar"]`;
const GAZETTE = '[data-testid="gazette-card"]';
const AT_MS = 1_754_600_000_000;

/** Two tabs in one pane, with the **Text** card frontmost. */
function deckShape() {
  return {
    cards: [
      { id: "S", componentId: "session", title: "Session", closable: true },
      { id: "T", componentId: "text", title: "File", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 620 },
        cardIds: ["S", "T"],
        activeCardId: "T",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function sessionUpdated(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id: SESSION_ID, fields });
}

describe.skipIf(!SHOULD_RUN)("at0381 — every citation surface names the session", () => {
  test(
    "the stacked tab reads project/callsign; a Gazette ref is an atom, never a UUID",
    async () => {
      const app = await launchTugApp({
        testName: "at0381-session-citation-surfaces",
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "T" });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: PROJECT_DIR,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
          )})`,
        );

        // ---- A. The stacked Session tab wears its own identity. ------------
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TAB_BAR)}) !== null`,
          { timeoutMs: 15_000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var tab = document.querySelector(
              ${JSON.stringify(TAB_BAR)} + ' [data-testid="tug-tab-S"]');
            return tab !== null
              && (tab.innerText || "").indexOf("tugtool/${TAG}") !== -1;
          })()`,
          { timeoutMs: 10_000 },
        );
        const tabText = await app.evalJS<string>(
          `(function(){
            var tab = document.querySelector(
              ${JSON.stringify(TAB_BAR)} + ' [data-testid="tug-tab-S"]');
            return tab === null ? "" : (tab.innerText || "").trim();
          })()`,
        );
        // The registry title is the fallback, not a prefix. A tab reading
        // "Session : tugtool/stocky-pixie" would pass a `toContain` and still
        // be the bug this fixed.
        expect(tabText).not.toContain("Session");
        expect(tabText).not.toContain(SESSION_ID);
        // The Text tab is unaffected — the gate came out, the rule did not
        // change for the card it used to be scoped to. Its name is "Untitled"
        // rather than the seeded registry title: a text card with no file
        // publishes its own name too, and a live override REPLACES the registry
        // title. That IS the rule under test, read on the neighbouring tab —
        // the tab wears the card's name, never its type.
        const textTab = await app.evalJS<string>(
          `(function(){
            var tab = document.querySelector(
              ${JSON.stringify(TAB_BAR)} + ' [data-testid="tug-tab-T"]');
            return tab === null ? "" : (tab.innerText || "").trim();
          })()`,
        );
        expect(textTab).toContain("Untitled");
        expect(textTab).not.toContain("File");

        // ---- B / C. The Gazette's refs. ------------------------------------
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GAZETTE)}) !== null`,
          { timeoutMs: 10_000 },
        );
        for (const [id, body] of [
          [SESSION_ID, "Resolved the mint collision."],
          [ALIEN_ID, "Cited a session from another machine."],
        ] as const) {
          expect(
            await app.evalJS<boolean>(
              `window.__tug.publishGazettePost(${JSON.stringify(
                JSON.stringify({
                  id: id === SESSION_ID ? 1 : 2,
                  at_ms: AT_MS,
                  author: "reporter",
                  body,
                  refs: [{ kind: "session", target: id }],
                }),
              )})`,
            ),
          ).toBe(true);
        }
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(
            ${JSON.stringify(GAZETTE)} +
            ' .gazette-post [data-slot="tug-session-identity"]').length === 2`,
          { timeoutMs: 10_000 },
        );
        // Wait for the LEDGER to have answered, not merely for the chips to
        // mount. Resolvability is a `resolve_sessions` round trip, and a chip
        // that has not heard back is deliberately neither resolved nor slashed —
        // reading `data-missing` before the answer lands would be reading a
        // state the test is not about.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(
            ${JSON.stringify(GAZETTE)} +
            ' .gazette-post [data-slot="tug-session-identity"][data-missing="true"]'
          ).length === 1`,
          { timeoutMs: 10_000 },
        );
        const chips = await app.evalJS<
          { text: string; missing: boolean; interactive: boolean }[]
        >(
          `Array.from(document.querySelectorAll(
            ${JSON.stringify(GAZETTE)} +
            ' .gazette-post [data-slot="tug-session-identity"]')).map(
            function (el) {
              return {
                text: (el.textContent || "").trim(),
                missing: el.getAttribute("data-missing") === "true",
                interactive: el.getAttribute("data-interactive") === "true",
              };
            })`,
        );
        expect(chips).toHaveLength(2);
        // B. The resolvable one is the identity line, and no part of the UUID.
        const resolved = chips.find((c) => !c.missing);
        // The atom's title ink wears the `project/` prefix ([P05] amendment) —
        // the same `project/callsign` Line the tab strip above reads, so the
        // chip and the tab cannot spell one session two ways.
        expect(resolved?.text).toContain(`tugtool/${TAG}`);
        expect(resolved?.text).not.toContain(SESSION_ID);
        // The whole rail is free of raw ids, not merely this chip.
        const railText = await app.evalJS<string>(
          `(document.querySelector(${JSON.stringify(GAZETTE)}).innerText || "")`,
        );
        expect(railText).not.toContain(SESSION_ID);
        expect(railText).not.toContain(ALIEN_ID);

        // C. The alien one keeps the shape and takes no click.
        const missing = chips.find((c) => c.missing);
        expect(missing).toBeDefined();
        expect(missing?.interactive).toBe(false);
        // It shows the short id — what the reference actually said — never the
        // whole UUID and never an empty chip.
        expect(missing?.text).toContain("0badf00d");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
