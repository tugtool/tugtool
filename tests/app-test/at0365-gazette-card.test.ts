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
 *     `kbfAtRest` — and a card that engages the mode has to have a stop to put
 *     the keyboard on. Gazette's first stop is its composer, a text stop the
 *     engagement seeds, so the arrival state is a granted caret with the
 *     mode's paint standing down ([#kbf-paint-route]), asserted alongside.
 *  2. **A post renders as its author wrote it.** Frames go in through
 *     `publishGazettePost`, which hands the bytes to the production parser and
 *     the production fold, so what lands on screen came off the same code path a
 *     live Reporter's would. Asserted: one row per post, in arrival order, each
 *     carrying its author's glyph, and a post's refs rendering in the Z1B as
 *     the app's own atom chips, labelled by the target's last segment.
 *  3. **The composer completes a round trip.** Typing a question and pressing
 *     the send button sends GAZETTE_INPUT; the Operator echoes the question as a user post
 *     and then answers. Under the app-test gate the agent pool answers nothing
 *     by design, so what comes back is the transient "couldn't answer" post —
 *     which is the assertion that matters here. The question left the card,
 *     reached the Operator, and the Operator's reply came back and cleared the
 *     pending row. Answer *quality* is not an app-test's business (it has no
 *     model behind it); the round trip is.
 *
 * A fourth claim, asserted on its own app because it is a measurement rather
 * than a gesture:
 *
 *  4. **The rail's widths are the type's.** The Gazette's floor and preferred
 *     width are not pixel counts — they are 56 and 64 characters of the body
 *     face plus the chrome the column is read through, authored as constants
 *     and checked here against the REAL render. The face is measured through
 *     the production `font-metrics` pair, so what is measured is the face that
 *     actually painted, not the fallback a premature measure would report.
 *     Every measured number is `note()`d, so a run that fails hands the correct
 *     constants to whoever retunes the type.
 *
 * @covers tugdeck/src/components/gazette/gazette-card.tsx
 * @covers tugdeck/src/components/gazette/gazette-card.css
 * @covers tugdeck/src/components/gazette/gazette-card-registration.tsx
 * @covers tugdeck/src/lib/gazette-measure.ts
 * @covers tugdeck/src/lib/gazette-store.ts
 * @covers tugdeck/src/lib/gazette-ref-action.ts
 * @covers tugdeck/src/lib/gazette-body-segments.ts
 * @covers tugdeck/src/lib/contextual-stamp.ts
 * @covers tugdeck/src/components/tugways/tug-transcript-entry.css
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";
import {
  COMFORT_GAZETTE_WIDTH_PX,
  DEFAULT_GAZETTE_WIDTH_PX,
  GAZETTE_BODY_CH_PX,
  GAZETTE_BODY_FONT_PX,
  GAZETTE_MEASURE_CH,
  GAZETTE_MIN_MEASURE_CH,
  GAZETTE_ROW_CHROME_PX,
  MIN_GAZETTE_WIDTH_PX,
} from "../../tugdeck/src/lib/gazette-measure";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-testid="gazette-card"]';
const POST = `${CARD} .gazette-cell`;
const PENDING = '[data-testid="gazette-pending-row"]';
const BODY = `${CARD} .gazette-post-body`;
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
  elapsed_ms?: number;
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
      chips: Array.from(el.querySelectorAll(".gazette-post-refs .tug-atom-chip"))
        .map(function (c) { return (c.getAttribute("aria-label") || "").trim(); }),
      glyph: el.querySelector(".tug-transcript-entry__icon svg") !== null,
      z1b: (function () {
        var z = el.querySelector(".gazette-post-z1b");
        return z === null ? null : (z.textContent || "").replace(/\\s+/g, " ").trim();
      })(),
    };
  })`;

interface Row {
  author: string;
  body: string;
  chips: string[];
  glyph: boolean;
  z1b: string | null;
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

        // ── 1b. The rail engages KBF, and it has somewhere to put the caret. ─
        // Gazette registers `kbfAtRest` (Class B): arriving here engages
        // keyboard-focus mode with no gesture at all. A card that engages the
        // mode owes it a stop — "an empty group never holds the keyboard" at
        // card scale — and Gazette's first stop is its composer, a text stop
        // the engagement SEEDS: a seed is a placement, so it grants rather
        // than parks ([P12]), the caret lands in the field, and the mode's
        // paint stands down for it (`data-kbf` keys on the route —
        // [#kbf-paint-route]). So the assertion is all three halves together:
        // the mode is ON (`kbfEngaged`), the paint is DOWN, and the caret is
        // in the composer. A ring here alongside the caret is the pre-(B)
        // coexistence bug; paint up with no caret means the seed never landed.
        await app.waitForCondition<boolean>(
          `window.__tug.kbfEngaged() === true &&
           !document.documentElement.hasAttribute("data-kbf") &&
           (function () {
             var field = document.querySelector(${JSON.stringify(`${CARD} [data-testid="gazette-composer-field"]`)});
             return field !== null && document.activeElement !== null &&
               field.contains(document.activeElement);
           })()`,
          { timeoutMs: 10_000 },
        );
        note(
          "arrival",
          await app.evalJS<string>(
            `(function () {
              var ringed = document.querySelector(${JSON.stringify(`${CARD} [data-key-view-kbd]`)});
              var active = document.activeElement;
              return JSON.stringify({
                engaged: window.__tug.kbfEngaged(),
                kbf: document.documentElement.hasAttribute("data-kbf"),
                ringed: ringed === null ? null : (ringed.getAttribute("data-testid") || ringed.tagName),
                active: active === null ? null : (active.getAttribute("data-slot") || active.tagName),
              });
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
          // The turn that wrote it took this long — tugcast clocks the agent
          // run and the Z1B reads it, the way a session turn reports its time.
          elapsed_ms: 4_200,
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

        // A ref the prose did not spell out rides the Z1B as an ATOM — the
        // app's own `TugAtomChip`, labelled by the target's last segment, with
        // the whole path on the wrapper's tooltip because the rail is too
        // narrow to spell a path twice.
        expect(rows[0]!.chips).toEqual(["layout-imposer.ts"]);
        expect(rows[1]!.chips, "a post with no refs shows no atoms").toEqual([]);

        // Every post carries the transcript's own end-state row under its
        // body: the OK badge and the text+icon COPY, in the Session card's
        // vocabulary.
        for (const row of rows) {
          expect(row.z1b, `${row.author}'s row carries a Z1B`).toContain("OK");
          expect(row.z1b, `${row.author}'s COPY is text+icon`).toContain("Copy");
        }
        // And a post whose agent turn was clocked reports that time, formatted
        // by the transcript's own duration formatter. A post carrying none
        // shows no elapsed segment at all rather than a fabricated zero.
        expect(rows[0]!.z1b, "the clocked post reports its elapsed").toContain(
          "4.2s",
        );
        expect(rows[1]!.z1b, "an unclocked post reports no elapsed").not.toContain(
          "s•",
        );

        const chipTitle = await app.evalJS<string | null>(
          `(function () {
            var chip = document.querySelector(${JSON.stringify(`${POST} .gazette-post-refs .tug-atom-chip`)});
            var wrap = chip === null ? null : chip.closest("[data-gazette-ref-kind]");
            return wrap === null ? null : wrap.getAttribute("title");
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

        // The send button is the shell's default, and it says which key fires
        // it: at the shipped `newline` setting that key is ⇧⏎, so the button
        // wears the CHORD variant of the default ring ([#chord-ring]) — dotted
        // while the promise is conditional. Asserted as the declaration plus
        // the style it resolves to, since the ring is painted from a knob the
        // attribute sets, not from the attribute itself.
        const chordRing = await app.evalJS<{
          chord: string | null;
          style: string;
        } | null>(
          `(function () {
            var send = document.querySelector(${JSON.stringify(SEND)});
            if (send === null) return null;
            return {
              chord: send.getAttribute("data-default-chord"),
              style: getComputedStyle(send).outlineStyle,
            };
          })()`,
        );
        note("send chord ring", JSON.stringify(chordRing));
        expect(chordRing?.chord, "the send button names ⇧⏎ as its chord").toBe(
          "shift",
        );
        expect(
          chordRing?.style,
          "a conditional promise is a dotted ring",
        ).toBe("dotted");

        // And the chord really submits — the gesture, not just its advertising.
        await app.nativeKey("Return", ["shift"]);

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

  test(
    "the rail's floor and preferred width are 56ch and 64ch of the face that actually renders",
    async () => {
      const app = await launchTugApp({ testName: "at0365-gazette-measure" });
      try {
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CARD)}) !== null`,
          { timeoutMs: 10_000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${CARD} .gazette-transcript`)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // A real post, so there is a real body element rendering in the real
        // face. Prose long enough that the column is exercised rather than a
        // word standing alone in it.
        expect(
          await publish(app, {
            id: 9101,
            at_ms: AT_MS,
            author: "reporter",
            body:
              "The rail's width is derived from this line's measure: sixty-four " +
              "characters of the body face, fungible down to fifty-six.",
            refs: [],
          }),
        ).toBe(true);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(BODY)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // The size the widths are derived from. If this drifts, every number
        // below is derived from the wrong face and the assertions that follow
        // are the ones that say so.
        const fontSizePx = await app.evalJS<number>(
          `parseFloat(window.getComputedStyle(
             document.querySelector(${JSON.stringify(BODY)})).fontSize)`,
        );
        note("body font-size px", String(fontSizePx));
        expect(fontSizePx).toBe(GAZETTE_BODY_FONT_PX);

        // One `ch`, measured through the production pair: it REQUESTS the
        // element's own face and waits for that face before measuring, so this
        // is the metric of the type that painted rather than of a fallback.
        // The measure waits for the face to load, so it is async and `evalJS`
        // cannot return a promise: kick it off, park the result, and poll.
        await app.evalJS<null>(
          `(window.__at0365ch = undefined,
            window.__tug.measureFaceAdvance(${JSON.stringify(BODY)}, "0")
              .then(function (w) { window.__at0365ch = w; }),
            null)`,
        );
        await app.waitForCondition<boolean>(`window.__at0365ch !== undefined`, {
          timeoutMs: 8_000,
        });
        const chPx = await app.evalJS<number | null>(`window.__at0365ch`);
        note("measured ch px", String(chPx));
        expect(chPx).not.toBeNull();
        expect(Math.abs((chPx as number) - GAZETTE_BODY_CH_PX)).toBeLessThanOrEqual(
          0.25,
        );

        // The chrome: everything between the pane's width and the content
        // column the body is read in — transcript padding, the glyph gutter,
        // the post grid's gap, and whatever pane/CardHost chrome stands
        // outside those. Measured, never summed from tokens.
        const chromePx = await app.evalJS<number>(
          `(function () {
            var body = document.querySelector(${JSON.stringify(BODY)});
            var column = body.closest(".tug-transcript-entry__body-column");
            var pane = body.closest(".tug-pane");
            return pane.getBoundingClientRect().width
              - column.getBoundingClientRect().width;
          })()`,
        );
        note("measured row chrome px", String(chromePx));
        expect(Math.abs(chromePx - GAZETTE_ROW_CHROME_PX)).toBeLessThanOrEqual(2);

        // And the derivation itself: the two TYPOGRAPHIC widths ARE the two
        // measures plus that chrome. Authored constants, checked against the
        // render — which is the whole point of authoring them.
        //
        // The 56ch measure derives the rail's COMFORT floor, not its hard one.
        // The hard floor is the different question of where a post stops
        // painting; it is a judgement, has no ch derivation to check, and is
        // asserted only to sit below the comfort measure it makes room under.
        const expectedPreferred =
          Math.round(GAZETTE_MEASURE_CH * (chPx as number)) + chromePx;
        const expectedComfort =
          Math.round(GAZETTE_MIN_MEASURE_CH * (chPx as number)) + chromePx;
        note(
          "derived widths",
          JSON.stringify({
            registeredPreferred: DEFAULT_GAZETTE_WIDTH_PX,
            measuredPreferred: expectedPreferred,
            registeredComfort: COMFORT_GAZETTE_WIDTH_PX,
            measuredComfort: expectedComfort,
            registeredHardFloor: MIN_GAZETTE_WIDTH_PX,
          }),
        );
        expect(
          Math.abs(DEFAULT_GAZETTE_WIDTH_PX - expectedPreferred),
        ).toBeLessThanOrEqual(4);
        expect(
          Math.abs(COMFORT_GAZETTE_WIDTH_PX - expectedComfort),
        ).toBeLessThanOrEqual(4);
        expect(MIN_GAZETTE_WIDTH_PX).toBeLessThan(COMFORT_GAZETTE_WIDTH_PX);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
