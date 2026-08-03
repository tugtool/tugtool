/**
 * at0339-session-find-bar.test.ts — transcript find is a ⌘F bar above Z2
 * ([AT0339]).
 *
 * ## Why this exists
 *
 * Find used to be a *submission*: `!find <query>` ran through the composer's
 * submit path, which is why it needed a dissolve-on-next-submit rule and an
 * Escape-when-empty rule living inside the prompt entry. Those are gone
 * ([D122]); the bar owns the search for exactly as long as it is open. This
 * suite drives the door, not the engine — match correctness is at0271's job.
 *
 * ## Test matrix
 *
 *   1. ⌘F opens the bar with the caret in the query field; typing a term
 *      paints both matches and actives one of them.
 *   2. ⌘G advances and ⇧⌘G retreats, from the query field.
 *   3. ⌘F while the bar is already open re-focuses the query field rather
 *      than toggling the bar shut.
 *   4. Escape closes the bar and dissolves the highlights; ⌘G while closed is
 *      inert (nothing repaints).
 *   5. A second ⌘F reopens with the previous query pre-filled AND fully
 *      selected — the standard macOS behavior that makes clear-on-close
 *      painless.
 *   6. ⇧⌘C raises the Changes shade with the bar still open: find is not a
 *      shade, so the two coexist rather than displacing each other.
 *
 * @covers tugdeck/src/components/tugways/tug-find-bar.tsx
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/components/tugways/keybinding-map.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;
const FEED_CODE_OUTPUT = 0x40;
const SID = "c7c0d1ea-0000-4000-8000-000000000339";

/** A term planted twice in the seeded turn, so a search has two matches. */
const PROBE = "findbarprobe";

const CARD = '[data-card-id="A"]';
const EDITOR = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const FIND_BAR = `${CARD} [data-slot="session-card-find-bar"]`;
const FIND_INPUT = `${FIND_BAR} [data-testid="session-card-find-input"] .cm-content`;
const STATUS_BAR = `${CARD} [data-slot="session-card-status-bar"]`;
const VIEW_SLOT = `${CARD} .session-view-slot`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 680 },
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

const f = (decoded: Record<string, unknown>) => ({
  op: "ingestFrame" as const,
  feedId: FEED_CODE_OUTPUT,
  decoded: { tug_session_id: SID, ...decoded },
});

/** Synthetic chord at the active element — a posted ⌘ chord can be eaten by
 *  macOS before it reaches the WebView (the at0088 / at0221 precedent). */
async function chord(
  app: App,
  code: string,
  key: string,
  mods: { meta?: boolean; shift?: boolean } = {},
): Promise<void> {
  await app.evalJS<boolean>(
    `(function(){
      var t = document.activeElement || document;
      return t.dispatchEvent(new KeyboardEvent("keydown", {
        code: ${JSON.stringify(code)},
        key: ${JSON.stringify(key)},
        metaKey: ${mods.meta === true},
        shiftKey: ${mods.shift === true},
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    })()`,
  );
}

/** Total painted ranges across both find highlight registries. */
async function paintedCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `(() => {
      let n = 0;
      for (const name of ['transcript-find-match', 'transcript-find-active']) {
        const hl = CSS.highlights.get(name);
        if (hl) for (const _ of hl) n += 1;
      }
      return n;
    })()`,
  );
}

async function waitForPaintedCount(app: App, expected: number): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      let n = 0;
      for (const name of ['transcript-find-match', 'transcript-find-active']) {
        const hl = CSS.highlights.get(name);
        if (hl) for (const _ of hl) n += 1;
      }
      return n === ${expected};
    })()`,
    { timeoutMs: 8000 },
  );
}

/** The text of the single active match, or "" when nothing is active. */
async function activeMatchText(app: App): Promise<string> {
  return app.evalJS<string>(
    `(() => {
      const hl = CSS.highlights.get('transcript-find-active');
      if (!hl) return "";
      for (const r of hl) return r.toString();
      return "";
    })()`,
  );
}

/** Which transcript row (list cell index) holds the active match. */
async function activeMatchRow(app: App): Promise<number> {
  return app.evalJS<number>(
    `(() => {
      const hl = CSS.highlights.get('transcript-find-active');
      if (!hl) return -1;
      for (const r of hl) {
        const el = r.startContainer.parentElement;
        const cell = el ? el.closest('[data-tug-list-cell-index]') : null;
        return cell ? Number(cell.getAttribute('data-tug-list-cell-index')) : -1;
      }
      return -1;
    })()`,
  );
}

const queryFieldHasCaret = `(() => {
  const input = document.querySelector(${JSON.stringify(FIND_INPUT)});
  return input !== null && document.activeElement !== null &&
    (input.contains(document.activeElement) || input === document.activeElement);
})()`;

async function seedSession(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
    { timeoutMs: 15_000 },
  );
  await app.bindSession("A", { tugSessionId: SID });
  await app.waitForCondition<boolean>(
    `document.querySelector('${CARD} [data-slot="session-telemetry-status-row"]') !== null`,
    { timeoutMs: 8000 },
  );

  // Two committed turns, each carrying one occurrence of the probe.
  for (const [i, tail] of ["alpha", "omega"].entries()) {
    await app.driveSession("A", { op: "send", text: `ask ${i}` });
    await app.driveSession("A", f({
      type: "assistant_text",
      msg_id: `m${i}`,
      text: `${PROBE} ${tail} sits in reply ${i}.`,
      is_partial: false,
      rev: 0,
      seq: 0,
    }));
    await app.driveSession("A", f({
      type: "turn_complete",
      msg_id: `m${i}`,
      result: "success",
    }));
  }
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('${CARD} [data-tug-list-cell-index]').length >= 4`,
    { timeoutMs: 10_000 },
  );
}

describe.skipIf(!SHOULD_RUN)("AT0339: the ⌘F transcript find bar", () => {
  test(
    "⌘F opens, ⌘G cycles, Escape closes and clears, a second ⌘F resumes the query",
    async () => {
      const app = await launchTugApp({ testName: "at0339-session-find-bar" });
      try {
        await seedSession(app);

        // The bar is not mounted until asked for.
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(FIND_BAR)}) === null`,
          ),
          "the find bar starts closed",
        ).toBe(true);

        // --- 1. ⌘F opens it with the caret in the query field. ---
        await app.nativeClickAtElement(EDITOR);
        await chord(app, "KeyF", "f", { meta: true });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(FIND_BAR)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(queryFieldHasCaret, {
          timeoutMs: 8000,
        });

        // It docks between the transcript view slot and Z2 — the [D97]
        // geometry: below the slot's bottom edge, above the status bar.
        const geometry = await app.evalJS<{
          slotBottom: number;
          barTop: number;
          barBottom: number;
          statusTop: number;
        } | null>(
          `(function(){
            var slot = document.querySelector(${JSON.stringify(VIEW_SLOT)});
            var bar = document.querySelector(${JSON.stringify(FIND_BAR)});
            var status = document.querySelector(${JSON.stringify(STATUS_BAR)});
            if (!slot || !bar || !status) return null;
            return {
              slotBottom: slot.getBoundingClientRect().bottom,
              barTop: bar.getBoundingClientRect().top,
              barBottom: bar.getBoundingClientRect().bottom,
              statusTop: status.getBoundingClientRect().top,
            };
          })()`,
        );
        expect(geometry).not.toBeNull();
        expect(geometry!.barTop).toBeGreaterThanOrEqual(geometry!.slotBottom - 1);
        expect(geometry!.barBottom).toBeLessThanOrEqual(geometry!.statusTop + 1);

        // Typing paints both matches, one of them active.
        await app.nativeType(PROBE);
        await waitForPaintedCount(app, 2);
        expect(await activeMatchText(app)).toBe(PROBE);
        const firstRow = await activeMatchRow(app);
        expect(firstRow).toBeGreaterThanOrEqual(0);

        // --- 2. ⌘G advances, ⇧⌘G retreats — from the query field. ---
        await chord(app, "KeyG", "g", { meta: true });
        await app.waitForCondition<boolean>(
          `(() => {
            const hl = CSS.highlights.get('transcript-find-active');
            if (!hl) return false;
            for (const r of hl) {
              const el = r.startContainer.parentElement;
              const cell = el ? el.closest('[data-tug-list-cell-index]') : null;
              return cell !== null &&
                Number(cell.getAttribute('data-tug-list-cell-index')) !== ${firstRow};
            }
            return false;
          })()`,
          { timeoutMs: 6000 },
        );
        await chord(app, "KeyG", "g", { meta: true, shift: true });
        await app.waitForCondition<boolean>(
          `(() => {
            const hl = CSS.highlights.get('transcript-find-active');
            if (!hl) return false;
            for (const r of hl) {
              const el = r.startContainer.parentElement;
              const cell = el ? el.closest('[data-tug-list-cell-index]') : null;
              return cell !== null &&
                Number(cell.getAttribute('data-tug-list-cell-index')) === ${firstRow};
            }
            return false;
          })()`,
          { timeoutMs: 6000 },
        );

        // --- 3. ⌘F while open re-focuses the field; it does not toggle shut. ---
        await app.nativeClickAtElement(EDITOR);
        await chord(app, "KeyF", "f", { meta: true });
        await app.waitForCondition<boolean>(queryFieldHasCaret, {
          timeoutMs: 8000,
        });
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(FIND_BAR)}) !== null`,
          ),
          "⌘F on an open bar must not close it",
        ).toBe(true);
        expect(await paintedCount(app)).toBe(2);

        // --- 4. Escape closes and dissolves; ⌘G while closed is inert. ---
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(FIND_BAR)}) === null`,
          { timeoutMs: 8000 },
        );
        await waitForPaintedCount(app, 0);

        await chord(app, "KeyG", "g", { meta: true });
        await new Promise((r) => setTimeout(r, 600));
        expect(
          await paintedCount(app),
          "⌘G with the bar closed must repaint nothing",
        ).toBe(0);

        // --- 5. A second ⌘F resumes the query, pre-filled and selected. ---
        await app.nativeClickAtElement(EDITOR);
        await chord(app, "KeyF", "f", { meta: true });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(FIND_BAR)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(queryFieldHasCaret, {
          timeoutMs: 8000,
        });
        expect(
          (
            await app.evalJS<string>(
              `(document.querySelector(${JSON.stringify(FIND_INPUT)})?.textContent || "").trim()`,
            )
          ),
          "the remembered query is pre-filled",
        ).toBe(PROBE);
        // Selected whole, so the next keystroke replaces it.
        expect(
          await app.evalJS<string>(
            `(window.getSelection()?.toString() || "")`,
          ),
          "the pre-filled query is fully selected",
        ).toBe(PROBE);
        await waitForPaintedCount(app, 2);

        // --- 6. Find is not a shade: Changes coexists with the open bar. ---
        await app.nativeClickAtElement(EDITOR);
        await chord(app, "KeyC", "c", { meta: true, shift: true });
        await app.waitForCondition<boolean>(
          `document.querySelector('${CARD} .session-view-slot[data-active-view="changes"]') !== null`,
          { timeoutMs: 8000 },
        );
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(FIND_BAR)}) !== null`,
          ),
          "raising Changes must not dismiss the find bar",
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
