/**
 * at0385-masthead-rest-facts.test.ts — the activity line's REST form reports
 * the session's own facts, and reports them on the push that changed them.
 *
 * ## What this gates
 *
 * Most of a session card's life is spent at rest, and at rest the activity line
 * is not blank: it says how much conversation there has been, how big it has
 * grown, when it last moved, and that the session is open for another turn.
 * Every one of those facts is the ledger's row for that session, and the row
 * moves by `session_updated` push — a frame that arrives when a turn ends and
 * at no other time.
 *
 * The line was reading that row through a subscription that could not wake it.
 * A masthead mounts before the connection is up, so the ledger hook resolved a
 * store that did not exist yet and subscribed to nothing, staying deaf for the
 * life of the mount; and the row's own arrival never changed the WORKSPACE
 * snapshot the hook returned, so even a live subscription bailed out of the
 * render. Between them the line repainted only when something else happened to
 * re-render the card — which, on a card at rest, is nothing at all.
 *
 * So: an idle card, bound without the picker, and one push. Nothing else is
 * touching this surface, which is what makes the repaint attributable to the
 * push rather than to traffic that would have repainted it anyway.
 *
 * The same idle card also gates the TAPE at rest: a session that has done no
 * work draws a flatline rather than nothing. This is the only test whose
 * subject is a card before any beat, so it is the only place an accessory that
 * quietly waited for data would be caught.
 *
 * @covers tugdeck/src/lib/session-ledger-store.ts
 * @covers tugdeck/src/components/tugways/session-activity-sparkline.tsx
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/components/tugways/session-identity-row.tsx
 * @covers tugdeck/src/lib/session-activity-line.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "b1c2d3e4-5f60-4718-9a2b-3c4d5e6f7081";
/** A workspace of this test's own, so no other session's rows are in play. */
const PROJECT_DIR = "/tmp/at0385-no-such-project";
const TURNS = 12;
const FILE_SIZE = 48_192;

const PANE = '.tug-pane[data-pane-id="p1"]';
const MASTHEAD = `${PANE} [data-slot="session-masthead"]`;
const PULSE = `${MASTHEAD} .session-masthead-pulse-text`;

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

function pulseText(): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(PULSE)});
    return el === null ? "" : (el.textContent || "").trim();
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0385 — the activity line at rest", () => {
  test(
    "a pushed ledger row reaches an unlisted card's activity line, on the push",
    async () => {
      const app = await launchTugApp({ testName: "at0385-masthead-rest-facts" });
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
        // The line before the row exists: it still says something, and what it
        // says has no turn count in it.
        await app.waitForCondition<boolean>(
          `${pulseText()}.length > 0`,
          { timeoutMs: 8_000 },
        );
        const before = await app.evalJS<string>(pulseText());
        note("at0385 before", JSON.stringify(before));
        expect(before).not.toContain(`${TURNS} turns`);

        // And the tape is DRAWN beside that line, on a session that has done no
        // work at all — a flatline, which is the instrument reading zero rather
        // than the instrument being absent. Asserted here because this is the
        // one test whose whole subject is a card at rest: everywhere else a beat
        // has already been published by the time the tape is looked at, so an
        // accessory that only appeared once data arrived would pass.
        //
        // Two reads, because either alone is weak: the element proves it is
        // mounted and laid out, and the tape's own plotted state proves the
        // canvas has a flat line on it rather than nothing.
        const tape = await app.evalJS<{ width: number; height: number } | null>(
          `(function(){
             var el = document.querySelector(${JSON.stringify(
               `${MASTHEAD} [data-slot="tug-sparkline"]`,
             )});
             if (el === null) return null;
             var r = el.getBoundingClientRect();
             return { width: Math.round(r.width), height: Math.round(r.height) };
           })()`,
        );
        note("at0385 tape at rest", JSON.stringify(tape));
        expect(tape).not.toBeNull();
        expect(tape!.width).toBeGreaterThan(0);
        expect(tape!.height).toBeGreaterThan(0);
        const flat = await app.evalJS<{ points: number; lastV: number } | null>(
          `window.__tug.sparklineTapeState(${JSON.stringify(
            `${MASTHEAD} [data-slot="tug-sparkline"]`,
          )})`,
        );
        note("at0385 tape state at rest", JSON.stringify(flat));
        expect(flat).not.toBeNull();
        expect(flat!.points).toBeGreaterThan(0);
        expect(flat!.lastV).toBe(0);

        // ---- The push, and what the line does with it. ---------------------
        //
        // The frame a real turn produces: the post-write ledger row, carrying
        // the three facts the rest sentence is made of.
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({
                // The row's own id: the client matches a pushed row into its
                // caches by this, not by the frame's envelope.
                session_id: SESSION_ID,
                project_dir: PROJECT_DIR,
                turn_count: TURNS,
                file_size: FILE_SIZE,
                last_user_prompt: "trace the mint reroll loop",
                last_used_at: 1_754_600_000_000,
                name: null,
                name_user_set: false,
              }),
            )})`,
          ),
        ).toBe(true);
        // Nothing else is touching this card — no beats, no typing, no
        // streaming — so a repaint here is the push's own doing.
        await app.waitForCondition<boolean>(
          `${pulseText()}.indexOf(${JSON.stringify(`${TURNS} turns`)}) !== -1`,
          { timeoutMs: 8_000 },
        );
        const after = await app.evalJS<string>(pulseText());
        note("at0385 after", JSON.stringify(after));
        // The whole rest sentence, not just the count: size and readiness ride
        // the same row.
        expect(after).toContain(`${TURNS} turns`);
        expect(after).toContain("47 KB");
        expect(after).toContain("Ready.");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
