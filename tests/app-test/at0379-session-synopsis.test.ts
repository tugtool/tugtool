/**
 * at0379-session-synopsis.test.ts — the description line's three states.
 *
 * ## What this gates
 *
 * The description is the one line of session identity that is *generated*.
 * `resolveSessionIdentity` resolves it by a precedence — a user `/rename` name
 * wins and freezes the line, else the rolling synopsis, else nothing — and the
 * masthead renders whatever that yields. Each arm is a state the user actually
 * sees, and only one of the three has ever been asserted (the empty one, in
 * at0375, as a geometry claim rather than a content one).
 *
 *   A. **A fresh session's description line is honestly empty.** Not the first
 *      prompt, not the id, not a placeholder — the incipit was retired as the
 *      description source precisely because it said where a session *started*.
 *
 *   B. **A written synopsis fills the line.** It arrives the way the wire
 *      delivers it: a real `session_updated` frame carrying `synopsis` on the
 *      ledger row, through the production decoder and the production store
 *      write. The composing model lives in tugcast and is covered by its own
 *      unit tests; what cannot be covered there is that the field survives the
 *      wire, reaches the store, and repaints a mounted surface.
 *
 *   C. **A `/rename` wins over the synopsis, and freezes the line.** The name
 *      takes the line even though the synopsis is still on the row, and a
 *      *later* synopsis write cannot move it back. That second half is the
 *      freeze: the ledger refuses the write server-side, and the resolver
 *      refuses the value client-side, and this asserts the client half by
 *      pushing a row that carries both.
 *
 * @covers tugdeck/src/lib/session-synopsis-store.ts
 * @covers tugdeck/src/lib/session-identity.ts
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/protocol.ts
 * @covers tugdeck/src/action-dispatch.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PROJECT_DIR = "/Users/tester/src/tugtool";
const TAG = "stocky-pixie";
const SYNOPSIS = "Repair ligature fallback in monospace";
const NEWER_SYNOPSIS = "Trace the mint reroll loop";
const RENAME = "the ligature work";

const PANE = '.tug-pane[data-pane-id="p1"]';
const MASTHEAD = `${PANE} [data-slot="session-masthead"]`;
const DESCRIPTION = `${MASTHEAD} .session-masthead-description`;

function deckShape() {
  return {
    cards: [{ id: "S", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds: ["S"],
        activeCardId: "S",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** The `session_updated` frame the supervisor pushes after a ledger write. */
function sessionUpdated(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id: SESSION_ID, fields });
}

/** The description line's rendered text, or `""` when the line is not mounted. */
function descriptionText(): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
    return el === null ? "" : (el.innerText || "").trim();
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0379 — the session description line", () => {
  test(
    "empty, then the synopsis, then the rename that freezes it",
    async () => {
      const app = await launchTugApp({ testName: "at0379-session-synopsis" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "S" });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: PROJECT_DIR,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // ---- A. Nothing written yet, so the line says nothing. -------------
        expect(await app.evalJS<string>(descriptionText())).toBe("");

        // ---- B. A synopsis on the row fills the line. -----------------------
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: TAG,
                name: null,
                name_user_set: false,
                synopsis: SYNOPSIS,
              }),
            )})`,
          ),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `${descriptionText()}.indexOf(${JSON.stringify(SYNOPSIS)}) !== -1`,
          { timeoutMs: 8_000 },
        );

        // ---- C. The rename wins, and freezes the line. ----------------------
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: TAG,
                name: RENAME,
                name_user_set: true,
                synopsis: SYNOPSIS,
              }),
            )})`,
          ),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `${descriptionText()}.indexOf(${JSON.stringify(RENAME)}) !== -1`,
          { timeoutMs: 8_000 },
        );
        // The synopsis is still on the row; it just does not get the line.
        expect(await app.evalJS<string>(descriptionText())).not.toContain(
          SYNOPSIS,
        );

        // The freeze: a newer synopsis lands on the row (an older tugcast, a
        // race, a replayed frame) and still cannot take the line back.
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: TAG,
                name: RENAME,
                name_user_set: true,
                synopsis: NEWER_SYNOPSIS,
              }),
            )})`,
          ),
        ).toBe(true);
        // Give a repaint every chance to land before claiming none happened.
        await new Promise<void>((r) => setTimeout(r, 500));
        const frozen = await app.evalJS<string>(descriptionText());
        expect(frozen).toContain(RENAME);
        expect(frozen).not.toContain(NEWER_SYNOPSIS);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
