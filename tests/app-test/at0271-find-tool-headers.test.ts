/**
 * at0271-find-tool-headers.test.ts — transcript find reaches tool-call block
 * headers, in both collapse states ([AT0271]).
 *
 * ## Why this exists
 *
 * A tool block's header is on screen whether or not the block is expanded —
 * when collapsed it IS the whole block — so the transcript is fully
 * searchable except for the content of unexpanded tool sections. The two
 * halves of that promise have to agree: the whole-transcript index
 * (`transcript-search-index` → `tool-header-projection`) counts a collapsed
 * block's name + target, and the painter
 * (`transcript-find-highlighter`) paints exactly those containers. A drift
 * between them shows up as a painted count that disagrees with the index
 * count, which is what this test measures directly.
 *
 * ## Test matrix
 *
 *   1. A collapsed Bash call: the header's COMMAND is findable (one painted
 *      range), and so is the tool NAME.
 *   2. That same collapsed call's OUTPUT is not findable — the body is
 *      unmounted, and the index must not count what cannot paint.
 *   3. Expanding the block brings the output into scope (one painted range),
 *      with the header still findable.
 *   4. A collapsed THINKING block — whose body stays mounted but clipped,
 *      unlike a tool block's — matches only on the text actually on screen:
 *      its label and its one-line preview, never the folded-away prose.
 *      Expanding swaps which of the two is findable.
 *
 * The door is ⌘F: the search runs in the find bar above Z2, and Escape
 * closes it (which clears the session). The subject here is index/painter
 * agreement, not the bar — the bar is only how the query gets in.
 *
 * @covers tugdeck/src/components/tugways/tug-find-bar.tsx
 * @covers tugdeck/src/lib/transcript-search-index.ts
 * @covers tugdeck/src/components/tugways/cards/blocks/tool-header-projection.ts
 * @covers tugdeck/src/components/tugways/transcript-find-highlighter.ts
 * @covers tugdeck/src/components/tugways/blocks/block-strip.tsx
 * @covers tugdeck/src/components/tugways/chrome/session-thinking-block.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;
const FEED_CODE_OUTPUT = 0x40;
const SID = "c7c0d1ea-0000-4000-8000-000000000271";

/** Unique probes: one in the header command, one only in the output. */
const CMD_PROBE = "findprobecmd";
const OUT_PROBE = "findprobeout";
/** Thinking probes: one in the first line (the collapsed preview), one below. */
const HEAD_PROBE = "findprobehead";
const DEEP_PROBE = "findprobedeep";

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

const EDITOR_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const BASH_BLOCK = '[data-card-id="A"] [data-slot="bash-tool-block"]';
const THINKING_BLOCK =
  '[data-card-id="A"] [data-slot="session-thinking-block"]';

const FIND_BAR = '[data-card-id="A"] [data-slot="session-card-find-bar"]';
const FIND_INPUT = `${FIND_BAR} [data-testid="session-card-find-input"] .cm-content`;

/**
 * Open the find bar with ⌘F and run `query` in it. A reopen pre-fills the
 * previous query fully selected, so typing replaces it either way.
 */
async function findInTranscript(app: App, query: string): Promise<void> {
  await app.nativeClickAtElement(EDITOR_SELECTOR);
  await app.nativeKey("f", ["cmd"]);
  await app.waitForCondition<boolean>(
    `document.querySelector('${FIND_BAR}') !== null`,
    { timeoutMs: 8000 },
  );
  await app.waitForCondition<boolean>(
    `(() => {
      const input = document.querySelector('${FIND_INPUT}');
      return input !== null && document.activeElement !== null &&
        (input.contains(document.activeElement) || input === document.activeElement);
    })()`,
    { timeoutMs: 8000 },
  );
  await app.nativeType(query);
  await new Promise((r) => setTimeout(r, 150));
}

/** The texts of every painted find range, in no particular order. */
async function paintedTexts(app: App): Promise<string[]> {
  const raw = await app.evalJS<string>(
    `(() => {
      const out = [];
      for (const name of ['transcript-find-match', 'transcript-find-active']) {
        const hl = CSS.highlights.get(name);
        if (hl) for (const r of hl) out.push(r.toString());
      }
      return JSON.stringify(out);
    })()`,
  );
  return JSON.parse(raw) as string[];
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

/** Escape closes the bar, which dissolves the paint for the next search. */
async function clearFind(app: App): Promise<void> {
  await app.nativeKey("Escape");
  await app.waitForCondition<boolean>(
    `document.querySelector('${FIND_BAR}') === null`,
    { timeoutMs: 8000 },
  );
  await waitForPaintedCount(app, 0);
}

describe.skipIf(!SHOULD_RUN)("AT0271: find reaches tool-call headers", () => {
  test(
    "a collapsed Bash header is findable; its output is not until expanded",
    async () => {
      const app = await launchTugApp({ testName: "at0271-find-tool-headers" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 15_000 },
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-card-id="A"] [data-slot="session-telemetry-status-row"]') !== null`,
          { timeoutMs: 8000 },
        );

        // One turn: prose, then a Bash call whose command and output each
        // carry their own probe token.
        await app.driveSession("A", { op: "send", text: "run the probe" });
        await app.driveSession("A", f({
          type: "assistant_text", msg_id: "m1", text: "Running it.",
          is_partial: false, rev: 0, seq: 0,
        }));
        await app.driveSession("A", f({
          type: "tool_use", msg_id: "m1", tool_use_id: "tc-1",
          tool_name: "Bash",
          input: { command: `echo ${CMD_PROBE}` },
          seq: 1,
        }));
        await app.driveSession("A", f({
          type: "tool_result", tool_use_id: "tc-1", output: OUT_PROBE,
        }));
        await app.driveSession("A", f({
          type: "turn_complete", msg_id: "m1", result: "success",
        }));

        // Bash mounts collapsed ([P06]) — the header is the whole block.
        await app.waitForCondition<boolean>(
          `document.querySelector('${BASH_BLOCK}[data-block-collapsed="true"]') !== null`,
          { timeoutMs: 8000 },
        );

        // 1. The collapsed header's command paints.
        await findInTranscript(app, CMD_PROBE);
        await waitForPaintedCount(app, 1);
        expect(await paintedTexts(app)).toEqual([CMD_PROBE]);
        await clearFind(app);

        // …and so does the tool name.
        await findInTranscript(app, "Bash");
        await waitForPaintedCount(app, 1);
        expect(await paintedTexts(app)).toEqual(["Bash"]);
        await clearFind(app);

        // 2. The unmounted body's output is out of scope while collapsed.
        await findInTranscript(app, OUT_PROBE);
        await new Promise((r) => setTimeout(r, 1000));
        expect(await paintedTexts(app)).toEqual([]);
        await clearFind(app);

        // 3. Expand the block — the output joins the searchable set.
        await app.nativeClickAtElement(
          `${BASH_BLOCK} [data-slot="tool-call-header-disclosure"]`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${BASH_BLOCK}[data-block-collapsed="true"]') === null`,
          { timeoutMs: 8000 },
        );
        await findInTranscript(app, OUT_PROBE);
        await waitForPaintedCount(app, 1);
        expect(await paintedTexts(app)).toEqual([OUT_PROBE]);
        await clearFind(app);

        // The header stays findable with the body open.
        await findInTranscript(app, CMD_PROBE);
        await waitForPaintedCount(app, 1);
        expect(await paintedTexts(app)).toEqual([CMD_PROBE]);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a folded-away thinking body is never a match; its preview is",
    async () => {
      const app = await launchTugApp({ testName: "at0271-find-thinking" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 15_000 },
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-card-id="A"] [data-slot="session-telemetry-status-row"]') !== null`,
          { timeoutMs: 8000 },
        );

        // Thinking whose FIRST line (the collapsed preview) and a later
        // line carry separate probes.
        await app.driveSession("A", { op: "send", text: "think it through" });
        await app.driveSession("A", f({
          type: "thinking_text", msg_id: "m1",
          text: `${HEAD_PROBE} opens the reasoning.\nThen ${DEEP_PROBE} sits further down.`,
          is_partial: false, rev: 0, seq: 0,
        }));
        await app.driveSession("A", f({
          type: "assistant_text", msg_id: "m1", text: "Done thinking.",
          is_partial: false, rev: 0, seq: 1,
        }));
        await app.driveSession("A", f({
          type: "turn_complete", msg_id: "m1", result: "success",
        }));

        await app.waitForCondition<boolean>(
          `document.querySelector('${THINKING_BLOCK}[data-collapsed="false"]') !== null`,
          { timeoutMs: 8000 },
        );

        // Expanded: the prose is on screen and matches — ONCE. The preview
        // holds the same first line but is `visibility: hidden`, so it must
        // not paint a second range.
        await findInTranscript(app, HEAD_PROBE);
        await waitForPaintedCount(app, 1);
        expect(await paintedTexts(app)).toEqual([HEAD_PROBE]);
        await clearFind(app);

        await findInTranscript(app, DEEP_PROBE);
        await waitForPaintedCount(app, 1);
        await clearFind(app);

        // Collapse it: the body is clipped to zero height — still in the
        // DOM, but no longer readable, so it must stop matching.
        await app.nativeClickAtElement(
          `${THINKING_BLOCK} [data-slot="session-thinking-block-fold"]`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${THINKING_BLOCK}[data-collapsed="true"]') !== null`,
          { timeoutMs: 8000 },
        );

        await findInTranscript(app, DEEP_PROBE);
        await new Promise((r) => setTimeout(r, 1000));
        expect(await paintedTexts(app)).toEqual([]);
        await clearFind(app);

        // The visible preview keeps the first line findable.
        await findInTranscript(app, HEAD_PROBE);
        await waitForPaintedCount(app, 1);
        expect(await paintedTexts(app)).toEqual([HEAD_PROBE]);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
