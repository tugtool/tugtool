/**
 * at0387-session-identity-menu.test.ts — a session row answers a right-click
 * ANYWHERE on it with the session's copies, and stops answering a hover with a
 * card that only repeats itself.
 *
 * ## What this gates
 *
 * The row shows four facts and used to offer copies of them through three
 * unrelated claimants over two dead zones. The title span claimed a Copy of the
 * atom and was exactly as wide as its glyphs; the `TugLabel` around it claimed
 * the blank space beside it with the generic label menu; the pulse stage
 * claimed the activity line. The description line and the masthead's own ground
 * claimed nothing and fell through to the app's "No Actions" — and the
 * description is the run a reader most wants out of a row, because it is the
 * one they cannot read anywhere else.
 *
 * So the press under test lands on the DESCRIPTION: the place that used to have
 * nothing to say. What has to come back is the whole menu, in order, with the
 * two run-specific items live rather than absent — a menu whose height changed
 * with the session's state would move its items under the pointer between one
 * press and the next.
 *
 * The citation is taken all the way to the pasteboard through the real gesture
 * — a native right-click, a native click on the item — rather than by calling
 * the writer. What at0376 gates is that the writer writes; what this gates is
 * that the menu reaches it, which is the half a hand-called writer cannot see.
 *
 * And the hover: where the row answers a right-click, the identity's hover card
 * is silence. It named the session and its description directly under a row
 * already showing both, and everything it added was a thing to act on, which a
 * tooltip cannot offer because it is by law non-interactive.
 *
 * @covers tugdeck/src/components/tugways/session-identity-menu.tsx
 * @covers tugdeck/src/components/tugways/session-identity-row.tsx
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/components/tugways/tug-session-identity.tsx
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "b3c4d5e6-1a2b-4c3d-8e4f-5a6b7c8d9e02";
const PROJECT_DIR = "/Users/tester/src/tugtool";
const TAG = "brisk-lantern";
const CITATION = "tugtool/brisk-lantern (b3c4d5e6)";
/** Distinguishes "the copy wrote this" from "the copy never happened". */
const SENTINEL = "at0387-sentinel-nothing-copied";

/** Past the pane's width, so the row is eliding it — the ordinary case. */
const PROMPT =
  "Give the session row one right-click menu for the whole row instead of " +
  "three claimants over two dead zones, and take the hover card off where the " +
  "menu can be acted on instead";

const PANE = '.tug-pane[data-pane-id="p1"]';
const MASTHEAD = `${PANE} [data-slot="session-masthead"]`;
const TITLE = `${MASTHEAD} .session-masthead-title`;
const DESCRIPTION = `${MASTHEAD} .tug-session-row-description`;
const MENU = '[data-slot="tug-editor-context-menu"]';
const TOOLTIP = '[data-slot="tug-tooltip"]';
const GAZETTE = '[data-testid="gazette-card"]';
/** The session atom inside a Gazette post — a citation in foreign context. */
const GAZETTE_CHIP = `${GAZETTE} .gazette-post [data-slot="tug-session-identity"]`;

function setPasteboard(text: string): void {
  Bun.spawnSync(["pbcopy"], { stdin: Buffer.from(text) });
}

function readPasteboard(): string {
  return Bun.spawnSync(["pbpaste"]).stdout.toString();
}

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
function publishSession(): string {
  return `window.__tug.publishSessionUpdated(${JSON.stringify(
    JSON.stringify({
      session_id: SESSION_ID,
      fields: {
        session_id: SESSION_ID,
        project_dir: PROJECT_DIR,
        tag: TAG,
        name: null,
        name_user_set: false,
        turn_count: 4,
        file_size: 8_192,
        last_user_prompt: PROMPT,
        last_used_at: 1_754_600_000_000,
      },
    }),
  )})`;
}

/**
 * A pointer arriving on the title. `pointerover` rather than `pointerenter`:
 * React does not listen for enter/leave at all — it synthesizes them from the
 * bubbling over/out pair, so a dispatched `pointerenter` reaches Radix's
 * handler as nothing. `pointermove` is what the trigger opens on.
 */
function hoverTitle(): string {
  return `(function(){
     var el = document.querySelector(${JSON.stringify(TITLE)});
     if (el === null) return false;
     var opts = { bubbles: true, pointerType: "mouse" };
     el.dispatchEvent(new PointerEvent("pointerover", opts));
     el.dispatchEvent(new PointerEvent("pointermove", opts));
     return true;
   })()`;
}

/**
 * A right press on the Gazette's atom. Dispatched rather than driven from the
 * mouse: the trusted press is what the first test gates (it is the half a
 * synthetic event cannot see), and this test is about what the menu SAYS, on a
 * chip inside a portaled rail.
 */
function rightClickChip(): string {
  return `(function(){
     var chip = document.querySelector(${JSON.stringify(GAZETTE_CHIP)});
     var r = chip.getBoundingClientRect();
     chip.dispatchEvent(new MouseEvent("contextmenu", {
       bubbles: true,
       clientX: Math.round(r.left + r.width / 2),
       clientY: Math.round(r.top + r.height / 2),
     }));
     return null;
   })()`;
}

/** Every row of the open menu, in the order it renders. */
function menuRows(): string {
  return `Array.prototype.map.call(
     document.querySelectorAll(${JSON.stringify(MENU)} + ' [role="menuitem"]'),
     function (item) {
       return {
         action: item.getAttribute("data-item-action") || "",
         label: (item.querySelector(".tug-menu-item-label") || item).textContent || "",
         disabled: item.getAttribute("aria-disabled") === "true",
       };
     })`;
}

describe.skipIf(!SHOULD_RUN)("at0387 — the session row's own menu", () => {
  test(
    "right-clicking the description offers the session's copies, and the citation reaches the pasteboard",
    async () => {
      const app = await launchTugApp({
        testName: "at0387-session-identity-menu",
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
        expect(await app.evalJS<boolean>(publishSession())).toBe(true);
        await app.waitForCondition<boolean>(
          `(function(){
             var el = document.querySelector(${JSON.stringify(DESCRIPTION)});
             return el !== null && (el.textContent || "").indexOf("right-click menu") !== -1;
           })()`,
          { timeoutMs: 10_000 },
        );

        // ---- The dead zone answers. ---------------------------------------
        //
        // A REAL right button, not a dispatched `contextmenu`, and that is the
        // half of this the synthetic press cannot reach. The pane's drag takes
        // pointer capture on the frame at pointer-down, and WebKit retargets
        // every later event of that pointer to the capture element — so a
        // right press in the title bar used to arrive at `.tug-pane` with the
        // row's handlers never called, and the app's document-level fallback
        // answered it with "No Actions". The masthead lives in that bar. A
        // press that only synthesizes the DOM event skips the capture entirely
        // and cannot see any of it.
        await app.nativeRightClickAtElement(DESCRIPTION);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MENU)}) !== null`,
          { timeoutMs: 8_000 },
        );
        // And nothing else answered the same press.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll('.tug-menu-content').length`,
          ),
        ).toBe(1);
        const rows = await app.evalJS<
          ReadonlyArray<{ action: string; label: string; disabled: boolean }>
        >(menuRows());
        note("at0387 menu", JSON.stringify(rows));
        // The five copies, in this order. Matched as a SUBSEQUENCE of the
        // menu rather than as the whole of it: what a surface offers above the
        // copies is that surface's business (a row that can go to its session
        // leads with a way to), and pinning the whole list here would make this
        // test the gate on every menu the row ever grows.
        const copies = rows.filter((r) => r.action.startsWith("copy-session-"));
        expect(copies.map((r) => r.action)).toEqual([
          "copy-session-atom",
          "copy-session-citation",
          "copy-session-id",
          "copy-session-description",
          "copy-session-activity",
        ]);
        // The three identity copies are always live — they are derived from the
        // record, which every resolved row has.
        expect(copies.slice(0, 3).every((r) => !r.disabled)).toBe(true);
        // And the description is live off the PROMPT rung: a session with no
        // written synopsis yet still has a line worth taking.
        expect(copies[3].disabled).toBe(false);

        // ---- …and the item carries it to the pasteboard. ------------------
        setPasteboard(SENTINEL);
        await app.nativeClickAtElement(
          `${MENU} [data-item-action="copy-session-citation"]`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MENU)}) === null`,
          { timeoutMs: 8_000 },
        );
        // The write lands asynchronously — the handler runs inside the item's
        // mousedown and the clipboard promise settles after it, so the read is
        // polled rather than taken once.
        let pasted = readPasteboard();
        for (let tries = 0; tries < 20 && pasted !== CITATION; tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          pasted = readPasteboard();
        }
        note("at0387 pasteboard", JSON.stringify(pasted));
        expect(pasted).toBe(CITATION);

        // ---- The hover no longer says what the row already says. ----------
        expect(await app.evalJS<boolean>(hoverTitle())).toBe(true);
        // Long enough to clear the provider's 500ms open delay several times
        // over: the claim is that nothing opens.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const tooltips = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(TOOLTIP)}).length`,
        );
        note("at0387 tooltips over the title", String(tooltips));
        expect(tooltips).toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the atom's menu leads with a way to the session — Show while a card holds it, Resume once none does",
    async () => {
      const app = await launchTugApp({
        testName: "at0387-session-identity-goto",
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
        expect(await app.evalJS<boolean>(publishSession())).toBe(true);

        // A citation in FOREIGN context — a Gazette ref — which is the surface
        // the go-to item exists for: an atom in a post has no row under it and
        // no card around it, so the menu is the only way from the name to the
        // session. The ref resolves through the real `resolve_sessions` round
        // trip against the ledger row `bindSession` recorded.
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GAZETTE)}) !== null`,
          { timeoutMs: 10_000 },
        );
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishGazettePost(${JSON.stringify(
              JSON.stringify({
                id: 1,
                at_ms: 1_754_600_000_000,
                author: "reporter",
                body: "Gave the session atom a way back to its session.",
                refs: [{ kind: "session", target: SESSION_ID }],
              }),
            )})`,
          ),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `(function(){
             var chip = document.querySelector(${JSON.stringify(GAZETTE_CHIP)});
             return chip !== null && chip.getAttribute("data-missing") !== "true";
           })()`,
          { timeoutMs: 10_000 },
        );

        // ---- A. A card holds it, so the item is Show — and it raises. ------
        //
        // The Gazette is a rail of its own, so the raise is a real one: the
        // key view is in the Gazette when the item fires and has to land on
        // the session's card.
        await app.click(GAZETTE);
        await app.evalJS<null>(rightClickChip());
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MENU)}) !== null`,
          { timeoutMs: 8_000 },
        );
        const withCard = await app.evalJS<
          ReadonlyArray<{ action: string; label: string; disabled: boolean }>
        >(menuRows());
        note("at0387 chip menu (card open)", JSON.stringify(withCard));
        expect(withCard[0].action).toBe("show-session");
        expect(withCard[0].label).toBe("Show Session");
        expect(withCard[0].disabled).toBe(false);
        // The chip carries no description or activity of its own, so those two
        // rows are absent here rather than permanently dead.
        expect(withCard.map((r) => r.action)).toEqual([
          "show-session",
          "copy-session-atom",
          "copy-session-citation",
          "copy-session-id",
        ]);
        await app.nativeClickAtElement(`${MENU} [data-item-action="show-session"]`);
        await app.expectFocusedCard("S", { timeoutMs: 8_000 });

        // ---- B. Close the card, and the same item becomes Resume. ----------
        //
        // The session is not gone — sessions never are — it is merely held by
        // nobody, which is exactly the state the second half of the item is
        // for. The pane is closed through the deck rather than through the
        // card's confirm sheet: what is under test is the menu, not the
        // close.
        await app.evalJS<null>(`(window.__tug.closePane("p1"), null)`);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) === null`,
          { timeoutMs: 10_000 },
        );
        await app.evalJS<null>(rightClickChip());
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MENU)}) !== null`,
          { timeoutMs: 8_000 },
        );
        note(
          "at0387 chip menu (just after close)",
          JSON.stringify(await app.evalJS(menuRows())),
        );
        // The ledger's answer for a session no card holds arrives over
        // `resolve_sessions`, and the item is disabled until it does — so the
        // wait is for the LIVE row, not merely for a row with that name.
        await app.waitForCondition<boolean>(
          `(function(){
             var item = document.querySelector(
               ${JSON.stringify(MENU)} + ' [data-item-action="resume-session"]');
             return item !== null && item.getAttribute("aria-disabled") !== "true";
           })()`,
          { timeoutMs: 10_000 },
        );
        const noCard = await app.evalJS<
          ReadonlyArray<{ action: string; label: string; disabled: boolean }>
        >(menuRows());
        note("at0387 chip menu (no card)", JSON.stringify(noCard));
        expect(noCard[0].action).toBe("resume-session");
        expect(noCard[0].label).toBe("Resume Session");

        // ---- …and Resume opens a card and restores INTO it. ----------------
        //
        // The restoring placeholder is the proof the whole path ran: it mounts
        // off the restore registry entry, which only exists once a fresh card
        // was created and `spawn_session(mode=resume)` went out for THIS
        // session. Where that spawn lands afterwards is tugcode's business and
        // at0376's / the restore tests' subject, not this one's.
        await app.nativeClickAtElement(
          `${MENU} [data-item-action="resume-session"]`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="session-card-restoring"]') !== null`,
          { timeoutMs: 15_000 },
        );
        note(
          "at0387 after resume",
          await app.evalJS<string>(
            `String(document.querySelectorAll('.tug-pane').length) + " panes"`,
          ),
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
