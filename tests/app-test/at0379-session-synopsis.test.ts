/**
 * at0379-session-synopsis.test.ts — the description line, and what it is not.
 *
 * ## What this gates
 *
 * The description is the one line of session identity that is *generated*. It
 * carries the agent's rolling synopsis and nothing else: the user's own name
 * leads the TITLE now, one line above it, and the two never compete. Each state
 * below is one the user actually sees.
 *
 *   A. **A session with no synopsis invents nothing, and still holds its line.**
 *      No placeholder word, no borrowing of the user's name from the title
 *      above, and the line keeps its height so the activity below it does not
 *      move when a description arrives. Whatever it shows is marked
 *      `data-stamp`, which is what paints it a step quieter than a real one.
 *
 *      Which stand-in it shows is not asserted here, and deliberately: the
 *      prompt and creation-stamp rungs both read the session's LEDGER ROW, and
 *      the ledger store drops a pushed row for a workspace it has not listed —
 *      an unbound picker is what lists one. Those rungs are covered at the
 *      picker in at0377, where the rows come from a real scan.
 *
 *   B. **A written synopsis fills the line**, and the stand-in mark clears with
 *      it. It arrives the way the wire delivers it: a real `session_updated`
 *      frame carrying `synopsis` on the ledger row, through the production
 *      decoder and the production store write. The composing model lives in
 *      tugcast and is covered by its own unit tests; what cannot be covered
 *      there is that the field survives the wire, reaches the store, and
 *      repaints a mounted surface.
 *
 *   C. **A `/rename` does not touch the description.** The name takes the title
 *      line, the description keeps saying what the agent said, and a LATER
 *      synopsis still lands — the rename freeze is gone from both the ledger and
 *      the resolver, because the two facts occupy different lines now and a
 *      renamed session that stopped being described would show a dead line on
 *      its most-visible surface.
 *
 * @covers tugdeck/src/lib/session-synopsis-store.ts
 * @covers tugdeck/src/lib/session-identity.ts
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/protocol.ts
 * @covers tugdeck/src/action-dispatch.ts
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
/**
 * A REAL directory, and that is load-bearing. `list_sessions` for a path that
 * does not exist settles the workspace snapshot to `error`, and the ledger store
 * only places a `session_updated` push into a snapshot that is `ready` — so
 * every push below would be silently dropped against an invented path.
 */
const PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "at0379-"));
const TAG = "stocky-pixie";
const SYNOPSIS = "Repair ligature fallback in monospace";
const NEWER_SYNOPSIS = "Trace the mint reroll loop";
const RENAME = "the ligature work";
const CREATED_AT = 1_754_600_000_000;

const PANE = '.tug-pane[data-pane-id="p1"]';
const MASTHEAD = `${PANE} [data-slot="session-masthead"]`;
const DESCRIPTION = `${MASTHEAD} .tug-session-row-description`;
const TITLE = `${MASTHEAD} .tug-session-identity-run`;

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

/** Whether the description is currently a fact standing in for a real one. */
function descriptionIsStandIn(): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
    return el !== null && el.getAttribute("data-stamp") === "true";
  })()`;
}

function titleText(): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(TITLE)});
    return el === null ? "" : (el.innerText || "").trim();
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0379 — the session description line", () => {
  test(
    "a stand-in, then the synopsis, then a rename that leaves it alone",
    async () => {
      const app = await launchTugApp({ testName: "at0379-session-synopsis" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "S" });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: PROJECT_DIR,
        });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // ---- A. Nothing written yet, and the line still holds its place. ---
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({
              tag: TAG,
              project_dir: PROJECT_DIR,
              name: null,
              name_user_set: false,
              created_at: CREATED_AT,
            }),
          )})`,
        );
        const bare = await app.evalJS<{
          text: string;
          standIn: boolean;
          height: number;
        }>(
          `(function(){
             var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
             if (el === null) throw new Error("no description line");
             return {
               text: (el.textContent || "").trim(),
               standIn: el.getAttribute("data-stamp") === "true",
               height: Math.round(el.getBoundingClientRect().height),
             };
           })()`,
        );
        note("at0379 bare description", JSON.stringify(bare));
        // Whatever it has to say, it says nothing INVENTED — no placeholder
        // word, and no borrowing of the user's name from the line above.
        expect(bare.text).not.toContain("PULSE");
        expect(bare.text).not.toContain(RENAME);
        // And it occupies its line, so the activity below it does not move when a
        // description arrives.
        expect(bare.height).toBeGreaterThan(0);
        // Nothing generated yet, so whatever shows is a fact standing in.
        expect(bare.standIn).toBe(true);

        // ---- B. A synopsis on the row fills the line. ----------------------
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: TAG,
                project_dir: PROJECT_DIR,
                name: null,
                name_user_set: false,
                created_at: CREATED_AT,
                turn_count: 1,
                synopsis: SYNOPSIS,
              }),
            )})`,
          ),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `${descriptionText()}.indexOf(${JSON.stringify(SYNOPSIS)}) !== -1`,
          { timeoutMs: 8_000 },
        );
        // A real description is not a stand-in, so the quieter treatment lifts.
        expect(await app.evalJS<boolean>(descriptionIsStandIn())).toBe(false);

        // ---- C. The rename takes the TITLE and leaves the description. -----
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: TAG,
                project_dir: PROJECT_DIR,
                name: RENAME,
                name_user_set: true,
                created_at: CREATED_AT,
                turn_count: 1,
                synopsis: SYNOPSIS,
              }),
            )})`,
          ),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `${titleText()}.indexOf(${JSON.stringify(RENAME)}) !== -1`,
          { timeoutMs: 8_000 },
        );
        // The user's name leads the title and the callsign follows it; the
        // description below is still the agent's line, untouched.
        const titled = await app.evalJS<string>(titleText());
        expect(titled).toContain(RENAME);
        expect(titled).toContain(TAG);
        expect(await app.evalJS<string>(descriptionText())).toContain(SYNOPSIS);

        // And the freeze is GONE: a later synopsis on the renamed row lands.
        // Under the old design the name and the description competed for one
        // line, so a generated line had to be refused; they occupy different
        // lines now, and refusing it would leave every renamed session with a
        // permanently stale description.
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                tag: TAG,
                project_dir: PROJECT_DIR,
                name: RENAME,
                name_user_set: true,
                created_at: CREATED_AT,
                turn_count: 1,
                synopsis: NEWER_SYNOPSIS,
              }),
            )})`,
          ),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `${descriptionText()}.indexOf(${JSON.stringify(NEWER_SYNOPSIS)}) !== -1`,
          { timeoutMs: 8_000 },
        );
        // The name is still the user's word on the line above.
        expect(await app.evalJS<string>(titleText())).toContain(RENAME);
      } finally {
        await app.close();
        fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
