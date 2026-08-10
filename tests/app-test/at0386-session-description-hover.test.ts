/**
 * at0386-session-description-hover.test.ts — a session description the row
 * could not fit gives up the rest of itself on hover, and one that fits gives
 * up nothing.
 *
 * ## What this gates
 *
 * The description is the longest run on a session row and the only one with no
 * second surface that shows it whole: the title is a name, the activity line is
 * a live beat that will say something else in a moment, but a synopsis clipped
 * at the row's edge was simply unreadable — there was nowhere else to read it.
 *
 * The hover has to be conditional, and that is the half worth pinning. A
 * tooltip that opens over a line already showing its full text is a bubble that
 * repeats what the reader is looking at, and it is the failure mode this
 * arrangement invites: `truncated` mode measures `scrollWidth` against
 * `clientWidth` on the open edge, so the suppression is real measurement of the
 * live element rather than a guess made at render time. Both directions run
 * against the same card, one after the other, so the difference is the text's
 * length and nothing else about the mount.
 *
 * The pointer is synthesized rather than warped: the harness has no native
 * mouse-move, and Radix opens on the trigger's own `pointerenter`/`pointermove`.
 * Everything downstream of those two events is the shipping component —
 * TugTooltip's measurement, Radix's delay machinery, the real portal.
 *
 * @covers tugdeck/src/components/tugways/tug-session-row.tsx
 * @covers tugdeck/src/components/tugways/session-identity-row.tsx
 * @covers tugdeck/src/components/tugways/tug-tooltip.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "c7d8e9f0-1a2b-4c3d-8e4f-5a6b7c8d9e01";
/** A workspace of this test's own, so no other session's rows are in play. */
const PROJECT_DIR = "/tmp/at0386-no-such-project";

const PANE = '.tug-pane[data-pane-id="p1"]';
const MASTHEAD = `${PANE} [data-slot="session-masthead"]`;
const DESCRIPTION = `${MASTHEAD} .tug-session-row-description`;
const TOOLTIP = '[data-slot="tug-tooltip"]';

/** Comfortably inside the pane's 820px, so the line shows it whole. */
const SHORT = "Trim the gutter";
/** Far past it, so the line clips and the reader is missing the end. */
const LONG =
  "Rework the way a session names itself and adopt that name at every " +
  "surface that shows one, then chase the description down through the Lens " +
  "rows and the picker cells until all three agree on the same sentence";

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
function publishPrompt(prompt: string): string {
  return `window.__tug.publishSessionUpdated(${JSON.stringify(
    JSON.stringify({
      session_id: SESSION_ID,
      fields: {
        session_id: SESSION_ID,
        project_dir: PROJECT_DIR,
        turn_count: 3,
        file_size: 4_096,
        last_user_prompt: prompt,
        last_used_at: 1_754_600_000_000,
        name: null,
        name_user_set: false,
      },
    }),
  )})`;
}

/**
 * A pointer arriving on the line. `pointerover` rather than `pointerenter`
 * because React does not listen for enter/leave at all — it SYNTHESIZES them
 * from the bubbling over/out pair, so a dispatched `pointerenter` reaches
 * Radix's React handler as nothing. `pointermove` is what Radix's trigger
 * actually opens on; the arrival has to precede it, or the move lands on a
 * trigger the library does not think is hovered.
 */
function hoverDescription(): string {
  return `(function(){
     var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
     if (el === null) return false;
     var opts = { bubbles: true, pointerType: "mouse" };
     el.dispatchEvent(new PointerEvent("pointerover", opts));
     el.dispatchEvent(new PointerEvent("pointermove", opts));
     return true;
   })()`;
}

/**
 * The pointer leaving. Needed between the two hovers and not merely tidy:
 * Radix latches a "this trigger already opened from a move" flag and only the
 * leave clears it, so without this the second hover is a no-op. `relatedTarget`
 * is set outside the trigger, which is what makes React read the `pointerout`
 * as a boundary crossing rather than a move within it.
 */
function unhoverDescription(): string {
  return `(function(){
     var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
     if (el === null) return false;
     el.dispatchEvent(new PointerEvent("pointerout", {
       bubbles: true,
       pointerType: "mouse",
       relatedTarget: document.body,
     }));
     return true;
   })()`;
}

/** Whether the line is actually clipped — the fact the suppression turns on. */
function descriptionOverflow(): string {
  return `(function(){
     var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
     if (el === null) return null;
     return {
       text: (el.textContent || "").trim(),
       clipped: el.scrollWidth > el.clientWidth,
     };
   })()`;
}

describe.skipIf(!SHOULD_RUN)("at0386 — hovering a session description", () => {
  test(
    "a clipped description shows itself whole on hover, a fitting one shows nothing",
    async () => {
      const app = await launchTugApp({
        testName: "at0386-session-description-hover",
      });
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

        // ---- A description that fits: hovering it must open nothing. -------
        expect(await app.evalJS<boolean>(publishPrompt(SHORT))).toBe(true);
        await app.waitForCondition<boolean>(
          `${descriptionOverflow()} !== null && ${descriptionOverflow()}.text.indexOf("Trim the gutter") !== -1`,
          { timeoutMs: 8_000 },
        );
        const fits = await app.evalJS<{ text: string; clipped: boolean }>(
          descriptionOverflow(),
        );
        note("at0386 short description", JSON.stringify(fits));
        expect(fits.clipped).toBe(false);

        expect(await app.evalJS<boolean>(hoverDescription())).toBe(true);
        // Long enough to clear the provider's 500ms open delay several times
        // over: the claim is that nothing opens, so the wait has to outlast
        // every delay that could have opened one.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const suppressed = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(TOOLTIP)}).length`,
        );
        note("at0386 tooltips over a fitting line", String(suppressed));
        expect(suppressed).toBe(0);
        await app.evalJS<boolean>(unhoverDescription());

        // ---- A description that does not fit: the whole text on hover. ----
        expect(await app.evalJS<boolean>(publishPrompt(LONG))).toBe(true);
        await app.waitForCondition<boolean>(
          `${descriptionOverflow()} !== null && ${descriptionOverflow()}.clipped === true`,
          { timeoutMs: 8_000 },
        );
        const clipped = await app.evalJS<{ text: string; clipped: boolean }>(
          descriptionOverflow(),
        );
        note("at0386 long description clipped", String(clipped.clipped));

        expect(await app.evalJS<boolean>(hoverDescription())).toBe(true);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TOOLTIP)}) !== null`,
          { timeoutMs: 8_000 },
        );
        const bubble = await app.getElementText(TOOLTIP);
        note("at0386 tooltip text", JSON.stringify(bubble));
        // The WHOLE description, contiguous — including the tail the row had
        // no room for. Not an equality: Radix renders a second, visually
        // hidden copy of the content for the announcement, so the bubble's
        // textContent legitimately carries the sentence twice.
        expect(bubble).toContain(LONG);
        expect(bubble).toContain("agree on the same sentence");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
