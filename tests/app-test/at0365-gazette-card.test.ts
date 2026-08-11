/**
 * at0365-gazette-card.test.ts — the Gazette rail, from the chord to the answer.
 *
 * The Gazette is the app's narration channel: a sidebar card reading one
 * scrolling column of posts, oldest at the top, written by three voices. Nothing
 * about it is per-session, so there is no session card to stand it up beside and
 * no transcript to seed — the whole surface is the rail, the posts in it, and
 * the composer under them.
 *
 * Three claims, in the order a user meets them:
 *
 *  1. **The chord opens the rail.** ⌃⌘G, posted as a real keystroke, brings up
 *     the card; a second press puts it away. The binding is registry-routed and
 *     menu-eligible, so this exercises the chord table and the menu item's
 *     handler at once — the two places a sidebar toggle can be wired wrong.
 *     Arriving also engages keyboard-focus mode, because the card registers
 *     `kbfAtRest` — and a card that engages the mode has to have a stop for it
 *     to ring, which is asserted alongside.
 *  2. **A post renders as its author wrote it.** Frames go in through
 *     `publishGazettePost`, which hands the bytes to the production parser and
 *     the production fold, so what lands on screen came off the same code path a
 *     live Reporter's would. Asserted: one row per post, in arrival order, each
 *     carrying its author's glyph, and a post's refs rendering as chips labelled
 *     by the target's last segment.
 *  3. **The composer completes a round trip.** Typing a question and pressing
 *     Ask sends GAZETTE_INPUT; the Operator echoes the question as a user post
 *     and then answers. Under the app-test gate the agent pool answers nothing
 *     by design, so what comes back is the transient "couldn't answer" post —
 *     which is the assertion that matters here. The question left the card,
 *     reached the Operator, and the Operator's reply came back and cleared the
 *     pending row. Answer *quality* is not an app-test's business (it has no
 *     model behind it); the round trip is.
 *
 * @covers tugdeck/src/components/gazette/gazette-card.tsx
 * @covers tugdeck/src/components/gazette/gazette-card-registration.tsx
 * @covers tugdeck/src/lib/gazette-store.ts
 * @covers tugdeck/src/lib/gazette-ref-action.ts
 * @covers tugdeck/src/lib/contextual-stamp.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-testid="gazette-card"]';
const POST = `${CARD} .gazette-post`;
const PENDING = '[data-testid="gazette-pending-row"]';
const FIELD = '[data-testid="gazette-composer-field"]';
const SEND = '[data-testid="gazette-composer-send"]';

/** One post as the wire carries it. `id` is the ledger rowid a real post has. */
interface WirePost {
  id: number;
  at_ms: number;
  author: "reporter" | "operator" | "user";
  body: string;
  refs: { kind: string; target: string }[];
  session_id?: string;
  wake_reason?: string;
}

async function publish(app: App, post: WirePost): Promise<boolean> {
  return app.evalJS<boolean>(
    `window.__tug.publishGazettePost(${JSON.stringify(JSON.stringify(post))})`,
  );
}

/** Each rendered row's author and body text, in document order. */
const ROWS_JS = `Array.from(document.querySelectorAll(${JSON.stringify(POST)}))
  .filter(function (el) { return !el.hasAttribute("data-pending"); })
  .map(function (el) {
    var body = el.querySelector(".gazette-post-body");
    return {
      author: el.getAttribute("data-author"),
      body: (body === null ? "" : body.textContent || "").trim(),
      chips: Array.from(el.querySelectorAll(".gazette-ref-chip"))
        .map(function (c) { return (c.textContent || "").trim(); }),
      glyph: el.querySelector(".gazette-post-glyph svg") !== null,
    };
  })`;

interface Row {
  author: string;
  body: string;
  chips: string[];
  glyph: boolean;
}

const AT_MS = 1_754_600_000_000;

describe.skipIf(!SHOULD_RUN)("at0365 — the Gazette card", () => {
  test(
    "⌃⌘G raises the rail, posts render with their glyphs and chips, and the composer round-trips",
    async () => {
      const app = await launchTugApp({ testName: "at0365-gazette-card" });
      try {
        // ── 1. The chord opens the rail. ──────────────────────────────────
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CARD)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // And puts it away again — a toggle, not an open.
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CARD)}) === null`,
          { timeoutMs: 10_000 },
        );

        // Back up for the rest of the test.
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CARD)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // ── 1b. The rail engages KBF, and it has somewhere to put the ring. ─
        // Gazette registers `kbfAtRest` (Class B): arriving here engages
        // keyboard-focus mode with no gesture at all. A card that engages the
        // mode owes it a stop — "an empty group never holds the keyboard" at
        // card scale — so the assertion is both halves together: the mode is
        // on AND something inside the rail wears the ring.
        await app.waitForCondition<boolean>(
          `document.documentElement.hasAttribute("data-kbf") &&
           document.querySelector(${JSON.stringify(`${CARD} [data-key-view-kbd]`)}) !== null`,
          { timeoutMs: 10_000 },
        );
        note(
          "ringed stop on arrival",
          await app.evalJS<string>(
            `(function () {
              var el = document.querySelector(${JSON.stringify(`${CARD} [data-key-view-kbd]`)});
              return el === null ? "none" : (el.getAttribute("data-testid") || el.tagName);
            })()`,
          ),
        );

        // ── 2. Posts render as their authors wrote them. ──────────────────
        // The transcript is the surface the folds land on; wait for it to
        // mount before feeding the store anything.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${CARD} .gazette-transcript`)}) !== null`,
          { timeoutMs: 10_000 },
        );

        const reporterPost: WirePost = {
          id: 9001,
          at_ms: AT_MS,
          author: "reporter",
          body: "Reworked the layout imposer's sidebar pin.",
          refs: [{ kind: "file", target: "tugdeck/src/lib/layout-imposer.ts" }],
          wake_reason: "sitrep",
        };
        const operatorPost: WirePost = {
          id: 9002,
          at_ms: AT_MS + 60_000,
          author: "operator",
          body: "Two sessions touched that file today.",
          refs: [],
        };

        expect(
          await publish(app, reporterPost),
          "the store is attached, so the frame was accepted",
        ).toBe(true);
        expect(await publish(app, operatorPost)).toBe(true);

        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(POST)}).length >= 2`,
          { timeoutMs: 10_000 },
        );

        const rows = await app.evalJS<Row[]>(ROWS_JS);
        note("rendered rows", JSON.stringify(rows));

        expect(rows.length, "one row per published post").toBe(2);

        // Arrival order, oldest first — the channel is read as a running feed.
        expect(rows[0]!.author).toBe("reporter");
        expect(rows[0]!.body).toBe(reporterPost.body);
        expect(rows[1]!.author).toBe("operator");
        expect(rows[1]!.body).toBe(operatorPost.body);

        // Every row leads with its author's glyph — the only thing on the row
        // that says who is speaking.
        for (const row of rows) {
          expect(row.glyph, `${row.author}'s row carries a glyph`).toBe(true);
        }

        // A ref renders as a chip labelled by the target's last segment; the
        // whole path rides the tooltip, because the rail is too narrow to
        // spell a path twice.
        expect(rows[0]!.chips).toEqual(["layout-imposer.ts"]);
        expect(rows[1]!.chips, "a post with no refs shows no chips").toEqual([]);

        const chipTitle = await app.evalJS<string | null>(
          `(function () {
            var chip = document.querySelector(${JSON.stringify(`${POST} .gazette-ref-chip`)});
            return chip === null ? null : chip.getAttribute("title");
          })()`,
        );
        expect(chipTitle).toBe("file: tugdeck/src/lib/layout-imposer.ts");

        // ── 3. The composer round-trips through the Operator. ─────────────
        const question = "which sessions touched the imposer";
        await app.nativeClickAtElement(`${FIELD} .cm-content`);
        await app.waitForCondition<boolean>(
          `document.activeElement !== null
            && document.activeElement.closest(${JSON.stringify(FIELD)}) !== null`,
          { timeoutMs: 8_000 },
        );
        await app.nativeType(question);
        await app.waitForCondition<boolean>(
          `(function () {
            var content = document.querySelector(${JSON.stringify(`${FIELD} .cm-content`)});
            return content !== null && (content.textContent || "").indexOf("imposer") !== -1;
          })()`,
          { timeoutMs: 8_000 },
        );

        await app.nativeClickAtElement(SEND);

        // Nothing is asserted about the pending placeholder standing: under
        // the app-test gate the Operator's reply comes back in the same
        // breath as the question goes out, so "the placeholder is up" is a
        // window too narrow to observe. What it resolves to is checked below.

        // The question echoes back as a user post — the Operator persists and
        // broadcasts it before running anything, so this is the first proof
        // the frame reached the server.
        await app.waitForCondition<boolean>(
          `Array.from(document.querySelectorAll(${JSON.stringify(POST)}))
            .some(function (el) { return el.getAttribute("data-author") === "user"; })`,
          { timeoutMs: 20_000 },
        );

        // Then the answer. Under the app-test gate the pool answers nothing, so
        // what arrives is the transient "couldn't answer" post — which still
        // proves the round trip, and clears the pending row on its way.
        await app.waitForCondition<boolean>(
          `Array.from(document.querySelectorAll(${JSON.stringify(POST)}))
            .filter(function (el) { return !el.hasAttribute("data-pending"); })
            .some(function (el) {
              var body = el.querySelector(".gazette-post-body");
              return el.getAttribute("data-author") === "operator"
                && (body === null ? "" : body.textContent || "").indexOf("Couldn't answer") !== -1;
            })`,
          { timeoutMs: 30_000 },
        );

        const after = await app.evalJS<Row[]>(ROWS_JS);
        note("rows after the round trip", JSON.stringify(after));

        const userRow = after.find((r) => r.author === "user");
        expect(userRow, "the question is echoed back as a user post").toBeDefined();
        expect(userRow!.body).toBe(question);

        // The pending placeholder is gone: the answer resolved the wait.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PENDING)}) === null`,
          { timeoutMs: 10_000 },
        );

        // And the composer is live again — one question at a time means
        // *while* one is outstanding, not ever after.
        expect(
          await app.evalJS<boolean>(
            `(function () {
              var field = document.querySelector(${JSON.stringify(FIELD)});
              return field !== null && field.querySelector(".cm-content") !== null;
            })()`,
          ),
          "the field is back after the answer landed",
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
