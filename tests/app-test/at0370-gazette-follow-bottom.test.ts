/**
 * at0370-gazette-follow-bottom.test.ts — the Gazette follows its live edge,
 * and says so.
 *
 * Two claims, and they are one mechanism seen from both sides.
 *
 * **Following.** While the reader is at the live edge, an arriving post keeps
 * them there — including the in-flight Operator wave, which is a row like any
 * other and pushes the edge down exactly as a post does. While the reader is
 * up in history, an arriving post must NOT yank them down; the line under the
 * eye is theirs until they ask for the bottom back.
 *
 * **Saying so.** The shared `TugJumpToBottomButton` floats over the column
 * whenever the reader is away from the edge, and clicking it jumps back and
 * re-engages following. Visibility is a `data-visible` attribute the card
 * writes ([L06]) — never React state — so the observable here is that
 * attribute on the real button, driven through the card's own follow-state
 * writer.
 *
 * Real geometry throughout: real posts through the production publish path,
 * real rendered markdown at real measured heights, and the button clicked
 * where it actually paints.
 *
 * @covers tugdeck/src/components/gazette/gazette-card.tsx
 * @covers tugdeck/src/components/gazette/gazette-card.css
 * @covers tugdeck/src/components/tugways/tug-jump-to-bottom-button.tsx
 * @covers tugdeck/src/components/tugways/tug-jump-to-bottom-button.css
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-testid="gazette-card"]';
const TRANSCRIPT = '[data-testid="gazette-transcript"]';
const POST = `${CARD} .gazette-cell`;
const JUMP = `${CARD} .tug-jump-to-bottom-button`;

const AT_MS = 1_754_600_000_000;

interface WirePost {
  id: number;
  at_ms: number;
  author: "reporter";
  body: string;
  refs: never[];
}

function wirePost(id: number): WirePost {
  return {
    id,
    at_ms: AT_MS + id * 1_000,
    author: "reporter",
    body: `Post ${id}: the session finished a turn and left a note about what it did, which is enough prose to give this row a height a reader has to scroll past.`,
    refs: [],
  };
}

async function publish(app: App, post: WirePost): Promise<boolean> {
  return app.evalJS<boolean>(
    `window.__tug.publishGazettePost(${JSON.stringify(JSON.stringify(post))})`,
  );
}

/** What the column and its affordance say about where the reader is. */
interface Edge {
  atBottom: boolean;
  scrollTop: number;
  /** The button's `data-visible`, verbatim — `null` when never written. */
  visible: string | null;
}

const EDGE_JS = `(function () {
  var el = document.querySelector(${JSON.stringify(TRANSCRIPT)});
  var btn = document.querySelector(${JSON.stringify(JUMP)});
  return {
    atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 2,
    scrollTop: Math.round(el.scrollTop),
    visible: btn === null ? null : btn.getAttribute("data-visible"),
  };
})()`;

async function edge(app: App): Promise<Edge> {
  return app.evalJS<Edge>(EDGE_JS);
}

describe.skipIf(!SHOULD_RUN)("at0370 — the Gazette's live edge", () => {
  test(
    "the column follows the edge, and the jump button says when it does not",
    async () => {
      const app = await launchTugApp({
        testName: "at0370-gazette-follow-bottom",
      });
      try {
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRANSCRIPT)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // The button is MOUNTED from the start ([L26]) — hidden by CSS, not
        // by a condition, so the show / hide is never a reconciliation.
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(JUMP)}) !== null`,
          ),
          "the jump button is mounted before it is ever needed",
        ).toBe(true);

        for (let id = 20; id <= 31; id++) {
          expect(await publish(app, wirePost(id))).toBe(true);
        }
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(POST)}).length === 12`,
          { timeoutMs: 10_000 },
        );

        // ── 1. At the edge: followed there, and the affordance is down.
        const opened = await edge(app);
        note("after the first posts", JSON.stringify(opened));
        expect(opened.atBottom, "the arriving posts kept the edge").toBe(true);
        expect(
          opened.visible,
          "nothing to jump to — the button stays hidden",
        ).not.toBe("true");

        // ── 2. Up in history: the button appears. The target is a fraction
        // of the SCROLL RANGE, not of `scrollHeight` — a fraction of the
        // latter can exceed the range and clamp straight back to the bottom,
        // which would leave this test asserting nothing at all.
        await app.evalJS<unknown>(
          `(function () {
            var el = document.querySelector(${JSON.stringify(TRANSCRIPT)});
            el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.3);
            el.dispatchEvent(new Event("scroll"));
            return true;
          })()`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(JUMP)}).getAttribute("data-visible") === "true"`,
          { timeoutMs: 5_000 },
        );
        const away = await edge(app);
        note("scrolled up", JSON.stringify(away));
        expect(away.atBottom).toBe(false);

        // ── 3. A post arriving while the reader is up-column does NOT yank
        // them down. This is the half a naive "always scroll to the newest"
        // gets wrong, and the reader loses their place every time a session
        // finishes a turn.
        expect(await publish(app, wirePost(32))).toBe(true);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(POST)}).length === 13`,
          { timeoutMs: 10_000 },
        );
        const held = await edge(app);
        note("a post arrived while up-column", JSON.stringify(held));
        expect(
          held.scrollTop,
          "the reader's line held while a post arrived below them",
        ).toBe(away.scrollTop);
        expect(held.visible, "and the button is still offering the edge").toBe(
          "true",
        );

        // ── 4. The click: back to the edge, and following again. Clicked
        // where it actually paints — a control that is visible but not
        // clickable is the bug this catches.
        await app.nativeClickAtElement(JUMP);
        await app.waitForCondition<boolean>(
          `(function () {
            var el = document.querySelector(${JSON.stringify(TRANSCRIPT)});
            return el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
          })()`,
          { timeoutMs: 5_000 },
        );
        const jumped = await edge(app);
        note("after the click", JSON.stringify(jumped));
        expect(jumped.atBottom).toBe(true);
        expect(
          jumped.visible,
          "back at the edge, the button withdraws",
        ).toBe("false");

        // ── 5. And following is genuinely re-engaged: the next post keeps
        // the edge rather than being left below the fold.
        expect(await publish(app, wirePost(33))).toBe(true);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(POST)}).length === 14`,
          { timeoutMs: 10_000 },
        );
        const following = await edge(app);
        note("a post after the jump", JSON.stringify(following));
        expect(
          following.atBottom,
          "the jump re-engaged following, so the new post kept the edge",
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
