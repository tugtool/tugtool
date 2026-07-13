/**
 * at0221-transcript-find-fidelity.test.ts — the transcript Find fidelity
 * gate ([AT0221]).
 *
 * ## Why this exists
 *
 * Transcript Find counts matches from a store→text index
 * (`transcript-search-index.ts`) and paints them by re-searching the mounted
 * DOM's `data-tugx-findable` containers (`transcript-find-highlighter.ts`).
 * The two sides are decoupled by necessity (the list is virtualized), so
 * their agreement — same match COUNT and same per-row match ORDER — is an
 * invariant nothing enforces structurally. This test is the gate: it drives
 * a real replayed session (fixture JSONL → real `spawn_session(resume)` →
 * the live dev card) and asserts index↔DOM agreement over markdown
 * constructs, a mixed thinking+text row, a markdown user body, and
 * chrome-adjacent text (a collapsed Bash block whose header command
 * contains the query — chrome must never paint).
 *
 * ## Test matrix
 *
 *   1. Fidelity (all rows mounted): the painted ranges' count equals the
 *      count chip's total, their document-order casing sequence equals the
 *      hand-computed expectation (order alignment, not just totals), chrome
 *      text does not paint, ⌘G advances the active match, a query spanning
 *      two adjacent findable containers matches nothing, and expanding /
 *      collapsing a Bash block and a default-routed markdown result moves
 *      their matches in and out of the count AND the paint, live.
 *   2. Virtualized count: with matches at the top and bottom of a long
 *      transcript, the count chip reads the whole-transcript total
 *      regardless of what is mounted, and ⌘G navigation (with wrap) walks
 *      both matches.
 *   3. Reveal + flash containment: typing a query (no ⌘G) scrolls the first
 *      match into the visible band between the pinned chrome and the
 *      scroller's bottom edge; refining the query re-reveals when the
 *      active match's identity moves; and the landing-flash ring is an
 *      absolutely-positioned child of the scroller, contained by its box
 *      and overlapping the active match — never floating over chrome.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// Fixed, UUID-shaped session ids — one per scenario fixture.
const SID_FIDELITY = "a7c0d1ea-0000-4000-8000-00000000f1d0";
const SID_VIRTUAL = "a7c0d1ea-0000-4000-8000-00000000f1d1";
const SID_FILE = "a7c0d1ea-0000-4000-8000-00000000f1d2";

/** Mirrors tugcode's `encodeProjectDir` (see at0192). */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface JsonlTurn {
  userText: string;
  /** Assistant content items, in order. */
  assistant: Array<
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | {
        kind: "tool";
        id: string;
        name: string;
        input: unknown;
        result: string;
        /** Optional entry-level `toolUseResult` sidecar (structured result). */
        structured?: Record<string, unknown>;
      }
  >;
}

/** Serialize turns into claude-shaped session JSONL (see at0192's notes). */
function buildJsonl(cwd: string, sessionId: string, turns: JsonlTurn[]): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const lines: unknown[] = [];
  let uuidSeq = 1;
  let parent: string | null = null;
  const nextUuid = (): string =>
    `00000000-0000-4000-8000-${String(uuidSeq++).padStart(12, "0")}`;
  let clock = Date.parse("2026-06-17T10:00:00.000Z");
  const nextStamp = (): string => {
    clock += 5_000;
    return new Date(clock).toISOString();
  };
  const usage = {
    input_tokens: 1000,
    output_tokens: 50,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 5000,
  };
  const pushAssistant = (
    msgId: string,
    content: unknown[],
    stopReason: string,
  ): void => {
    const uuid = nextUuid();
    lines.push({
      ...base,
      parentUuid: parent,
      type: "assistant",
      uuid,
      timestamp: nextStamp(),
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        usage,
      },
    });
    parent = uuid;
  };
  for (const [i, turn] of turns.entries()) {
    const userUuid = nextUuid();
    lines.push({
      ...base,
      parentUuid: parent,
      type: "user",
      uuid: userUuid,
      timestamp: nextStamp(),
      message: { role: "user", content: [{ type: "text", text: turn.userText }] },
    });
    parent = userUuid;
    // Real session shape for a tool call: assistant(tool_use, stop_reason
    // "tool_use") → user(tool_result [+ toolUseResult sidecar]) → the turn's
    // closing assistant(text/thinking, "end_turn"). A tool_use closed with
    // "end_turn" commits the turn before its result frame arrives, leaving
    // the call stuck pending (running clock, disabled disclosure).
    const proseItems: unknown[] = [];
    let toolSeq = 0;
    for (const item of turn.assistant) {
      if (item.kind === "text") {
        proseItems.push({ type: "text", text: item.text });
      } else if (item.kind === "thinking") {
        proseItems.push({ type: "thinking", thinking: item.text, signature: "sig" });
      } else {
        pushAssistant(
          `msg-find-${sessionId.slice(-4)}-${i}-t${toolSeq++}`,
          [{ type: "tool_use", id: item.id, name: item.name, input: item.input }],
          "tool_use",
        );
        const trUuid = nextUuid();
        lines.push({
          ...base,
          parentUuid: parent,
          type: "user",
          uuid: trUuid,
          timestamp: nextStamp(),
          ...(item.structured !== undefined
            ? { toolUseResult: item.structured }
            : {}),
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: item.id, content: item.result },
            ],
          },
        });
        parent = trUuid;
      }
    }
    pushAssistant(
      `msg-find-${sessionId.slice(-4)}-${i}`,
      proseItems.length > 0 ? proseItems : [{ type: "text", text: "" }],
      "end_turn",
    );
  }
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// The fidelity fixture. Every `aurora` occurrence's CASING is distinct
// context — the painted sequence proves per-row ORDER alignment, not just
// totals. Hand count for the query `aurora` (case-insensitive):
//   user turn-1 body ........ Aurora (bold), aurora (code)          = 2
//   turn-1 thinking ......... AURORA                                 = 1
//   turn-1 text: heading Aurora; prose aurora/AURORA/aurora/aurora
//     (em, bold, code, link text); list aurora/Aurora; table aurora  = 8
//   turn-2 text ............. aurora                                 = 1
//   turn-2 Bash header ...... `echo aurora` is CHROME — never painted,
//     and the collapsed block's body never mounts                    = 0
//   total ................... 12
const FIDELITY_TURNS: JsonlTurn[] = [
  {
    userText: "hello **Aurora** and `aurora` mixed",
    assistant: [
      { kind: "thinking", text: "Considering AURORA carefully." },
      {
        kind: "text",
        text: [
          "# Start Aurora heading",
          "",
          "Prose with *aurora* emphasis, **AURORA** bold, `aurora` code, and an [aurora link](https://example.com/x).",
          "",
          "- first aurora item",
          "- second Aurora item",
          "",
          "| name | value |",
          "| ---- | ----- |",
          "| aurora | in table |",
        ].join("\n"),
      },
    ],
  },
  {
    userText: "run the probe please",
    assistant: [
      {
        kind: "tool",
        id: "toolu_find_01",
        name: "Bash",
        input: { command: "echo aurora" },
        result: "aurora printed",
        structured: {
          stdout: "aurora printed",
          stderr: "",
          interrupted: false,
          isImage: false,
        },
      },
      { kind: "text", text: "chrome case aurora here" },
    ],
  },
  {
    userText: "boundary check turn",
    assistant: [
      { kind: "thinking", text: "This thought ends with seamA" },
      { kind: "text", text: "seamB starts this reply." },
    ],
  },
  {
    userText: "one more probe",
    assistant: [
      {
        kind: "tool",
        id: "toolu_find_02",
        name: "Probe",
        input: { target: "x" },
        result: "The aurora result markdown.",
      },
      { kind: "text", text: "done." },
    ],
  },
];

const EXPECTED_AURORA_SEQUENCE = [
  // user row (bold, code)
  "Aurora", "aurora",
  // assistant row 1: thinking first, then heading / prose / list / table
  "AURORA",
  "Aurora", "aurora", "AURORA", "aurora", "aurora", "aurora", "Aurora", "aurora",
  // assistant row 2 prose
  "aurora",
];

/** Single-turn fixture: a Read call whose 120-line file exceeds the
 *  FileBlock fold threshold (80), so its embedded editor stays unmounted
 *  until find navigation unfolds it. */
const FILE_TURNS: JsonlTurn[] = [
  {
    userText: "read that file",
    assistant: [
      {
        kind: "tool",
        id: "toolu_find_03",
        name: "Read",
        input: { file_path: "/tmp/fixture.txt" },
        result: "     1\tfixture",
        structured: {
          type: "text",
          file: {
            content: Array.from({ length: 120 }, (_, i) =>
              i === 109 ? "line 110 holds the glacierseed marker" : `plain line ${i + 1}`,
            ).join("\n"),
            filePath: "/tmp/fixture.txt",
            startLine: 1,
            numLines: 120,
            totalLines: 120,
          },
        },
      },
      { kind: "text", text: "file read done." },
    ],
  },
];

/** Long-transcript fixture: matches in the FIRST and LAST turns only. */
function virtualTurns(): JsonlTurn[] {
  const filler = (n: number): JsonlTurn => ({
    userText: `filler question ${n}`,
    assistant: [
      {
        kind: "text",
        text: Array.from(
          { length: 14 },
          (_, i) => `Filler paragraph ${n}.${i} with nothing of note in it whatsoever.`,
        ).join("\n\n"),
      },
    ],
  });
  return [
    {
      userText: "top marker",
      assistant: [{ kind: "text", text: "zephyrmark alpha sits at the top" }],
    },
    ...Array.from({ length: 6 }, (_, i) => filler(i + 1)),
    {
      userText: "bottom marker",
      assistant: [{ kind: "text", text: "zephyrmark omega sits at the bottom" }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Fixture placement
// ---------------------------------------------------------------------------

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0221-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, `${SID_FIDELITY}.jsonl`),
    buildJsonl(projectDir, SID_FIDELITY, FIDELITY_TURNS),
  );
  writeFileSync(
    join(fixtureDir, `${SID_VIRTUAL}.jsonl`),
    buildJsonl(projectDir, SID_VIRTUAL, virtualTurns()),
  );
  writeFileSync(
    join(fixtureDir, `${SID_FILE}.jsonl`),
    buildJsonl(projectDir, SID_FILE, FILE_TURNS),
  );
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (fixtureDir !== "" && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Deck + drive helpers
// ---------------------------------------------------------------------------

function deckShape(height: number) {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 20, y: 20 },
        size: { width: 860, height },
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

const EDITOR_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const ROUTE_LABEL_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar button[aria-label="Route"] [data-tug-stable="active"]';
const COUNT_CHIP_SELECTOR =
  '[data-card-id="A"] [data-slot="find-count"] [data-slot="find-count-value"]';

/** All painted find ranges (match + active), in document order. */
const READ_RANGES_JS = `(() => {
  const collect = (name, isActive) => {
    const hl = CSS.highlights.get(name);
    const out = [];
    if (hl) {
      for (const r of hl) {
        const el = r.startContainer.parentElement;
        const cell = el ? el.closest('[data-tug-list-cell-index]') : null;
        out.push({
          text: r.toString(),
          row: cell ? Number(cell.getAttribute('data-tug-list-cell-index')) : -1,
          active: isActive,
          range: r,
        });
      }
    }
    return out;
  };
  const all = collect('transcript-find-match', false)
    .concat(collect('transcript-find-active', true));
  all.sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
  return JSON.stringify(all.map(({ text, row, active }) => ({ text, row, active })));
})()`;

interface PaintedRange {
  text: string;
  row: number;
  active: boolean;
}

async function readPaintedRanges(app: App): Promise<PaintedRange[]> {
  const raw = await app.evalJS<string>(READ_RANGES_JS);
  return JSON.parse(raw) as PaintedRange[];
}

async function readCountChip(app: App): Promise<string> {
  return await app.evalJS<string>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(COUNT_CHIP_SELECTOR)});
      return el ? (el.textContent || '').trim() : '';
    })()`,
  );
}

async function waitForCountChip(app: App, expected: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(COUNT_CHIP_SELECTOR)});
      return el !== null && (el.textContent || '').trim() === ${JSON.stringify(expected)};
    })()`,
    { timeoutMs: 8000 },
  );
}

/** Mount the dev card, resume the fixture session, wait for the replay. */
async function mountAndReplay(
  app: App,
  sid: string,
  paneHeight: number,
  minCells: number,
): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(paneHeight), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
    { timeoutMs: 15_000 },
  );
  await app.spawnSessionResume("A", { tugSessionId: sid, projectDir });
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-card-id="A"] [data-tug-list-cell-index]').length >= ${minCells}`,
    { timeoutMs: 30_000 },
  );
}

/**
 * Dispatch a keybinding chord as a synthetic keydown at the active element.
 * `matchKeybinding` keys purely on `event.code` + modifiers and does not
 * check `isTrusted`, so this exercises the exact Stage-1 keybinding path a
 * real chord takes — without the OS input stack (whose native delivery of
 * menu-adjacent chords is not reliable under the harness; see at0085's
 * SELECT_ROUTE scenario for the precedent).
 */
async function dispatchChord(
  app: App,
  code: string,
  key: string,
  modifiers: { meta?: boolean; shift?: boolean },
): Promise<void> {
  await app.evalJS<boolean>(
    `(function(){
      var target = document.activeElement || document;
      return target.dispatchEvent(new KeyboardEvent("keydown", {
        code: ${JSON.stringify(code)},
        key: ${JSON.stringify(key)},
        metaKey: ${modifiers.meta === true},
        shiftKey: ${modifiers.shift === true},
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    })()`,
  );
}

/** Focus the prompt editor and enter the Find route via ⇧⌘F. */
async function enterFind(app: App): Promise<void> {
  await app.nativeClickAtElement(EDITOR_SELECTOR);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(EDITOR_SELECTOR)})`,
    { timeoutMs: 4000 },
  );
  await dispatchChord(app, "KeyF", "F", { meta: true, shift: true });
  await app.waitForCondition<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return el !== null && (el.textContent || '').trim() === "Find";
    })()`,
    { timeoutMs: 4000 },
  );
}

/** Advance the active match via the ⌘G keybinding. */
async function findNext(app: App): Promise<void> {
  await dispatchChord(app, "KeyG", "g", { meta: true });
}

/**
 * Scroll an element into the viewport, then click it for real. Coordinate
 * clicks (`app.click`) miss elements scrolled outside the viewport, and the
 * disclosure's activation rides the pointer pipeline (a synthetic in-page
 * `.click()` does not toggle it) — so reveal first, then native-click.
 */
async function revealAndClick(app: App, selector: string): Promise<void> {
  // Disengage the transcript's follow-bottom first (a wheel gesture is the
  // SmartScroll disengage signal); a bare programmatic scroll can be
  // re-pinned by the next resize flush, leaving the target off-screen again.
  await app.evalJS<void>(
    `(() => {
      const scroller = document.querySelector('[data-tug-scroll-key="dev-card-transcript"]');
      if (scroller) {
        scroller.dispatchEvent(new WheelEvent("wheel", {
          deltaY: -40, bubbles: true, cancelable: true,
        }));
      }
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("revealAndClick: not found: " + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: "center" });
    })()`,
  );
  await new Promise((r) => setTimeout(r, 250));
  // Re-assert the reveal (any late reflow may have moved it), then click.
  await app.evalJS<void>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.scrollIntoView({ block: "center" });
    })()`,
  );
  await new Promise((r) => setTimeout(r, 100));
  await app.click(selector);
}

/**
 * Wait until the combined painted range count (match + active highlights)
 * equals `expected`. A fresh query's first paint rides an animation frame
 * behind the count chip (the active-changed branch scrolls, then paints), so
 * range reads must poll rather than read immediately after the chip settles.
 */
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
    { timeoutMs: 6000 },
  );
}

/**
 * Wait until the ACTIVE highlight holds exactly one range whose text is
 * `expected`. Navigation repaints on the next animation frame (the
 * active-changed branch scrolls first, then paints) — the count chip updates
 * a frame ahead of the highlight, so active-range assertions must poll.
 */
async function waitForActiveText(app: App, expected: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      const hl = CSS.highlights.get('transcript-find-active');
      if (!hl) return false;
      const texts = [];
      for (const r of hl) texts.push(r.toString());
      return texts.length === 1 && texts[0] === ${JSON.stringify(expected)};
    })()`,
    { timeoutMs: 6000 },
  );
}

/** Clear the find query (select-all + delete). */
async function clearQuery(app: App): Promise<void> {
  await app.nativeKey("a", ["cmd"]);
  await app.nativeKey("Delete");
}

/**
 * Wait until the ACTIVE match's rect lies inside the transcript's visible
 * band: below the pinned chrome (`--tugx-pin-stack-top`, inherited onto the
 * scroller) at the top, above the scroller's own bottom edge at the bottom.
 * The reveal enforces an 8px inset on both edges; the check allows 1px of
 * sub-pixel slack. Polled — the reveal settles over a few animation frames.
 */
async function waitForActiveInBand(app: App): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      const hl = CSS.highlights.get('transcript-find-active');
      if (!hl) return false;
      let rect = null;
      let el = null;
      for (const r of hl) {
        rect = r.getBoundingClientRect();
        el = r.startContainer.parentElement;
        break;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) return false;
      const scroller = document.querySelector('[data-tug-scroll-key="dev-card-transcript"]');
      if (!scroller) return false;
      const s = scroller.getBoundingClientRect();
      // The pin stack is per-entry — read it from inside the match's entry
      // (the same element the reveal reads), not from the scroller.
      const sticky =
        parseFloat(getComputedStyle(el || scroller).getPropertyValue('--tugx-pin-stack-top')) || 0;
      return rect.top >= s.top + sticky + 7 && rect.bottom <= s.bottom - 7;
    })()`,
    { timeoutMs: 8000 },
  );
}

/**
 * Install a one-shot MutationObserver on the scroller that captures the
 * next landing-flash ring at insertion (its 640ms lifetime is too short to
 * poll for reliably): parent, computed position, containment by the
 * scroller's box, and overlap with the active match's rect (measured one
 * frame after insertion so styles have applied). The report lands on
 * `window.__at0221Flash`.
 */
const INSTALL_FLASH_PROBE_JS = `(() => {
  const scroller = document.querySelector('[data-tug-scroll-key="dev-card-transcript"]');
  if (!scroller) return false;
  window.__at0221Flash = undefined;
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (!node.classList.contains('tugx-find-flash-overlay')) continue;
        obs.disconnect();
        const inScroller = node.parentElement === scroller;
        requestAnimationFrame(() => {
          const o = node.getBoundingClientRect();
          const s = scroller.getBoundingClientRect();
          let a = null;
          const hl = CSS.highlights.get('transcript-find-active');
          if (hl) for (const r of hl) { a = r.getBoundingClientRect(); break; }
          window.__at0221Flash = {
            inScroller,
            position: getComputedStyle(node).position,
            contained:
              o.top >= s.top - 1 && o.bottom <= s.bottom + 1 &&
              o.left >= s.left - 1 && o.right <= s.right + 1,
            overlapsActive:
              a !== null &&
              !(o.bottom < a.top || o.top > a.bottom ||
                o.right < a.left || o.left > a.right),
          };
        });
        return;
      }
    }
  });
  obs.observe(scroller, { childList: true });
  return true;
})()`;

// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)("AT0221: transcript find fidelity gate", () => {
  test(
    "index count == painted ranges, in order, chrome excluded, boundary-safe",
    async () => {
      const app = await launchTugApp({ testName: "at0221-fidelity" });
      try {
        // Tall pane: the 3-turn fixture must mount every row so the painted
        // set covers the whole match set.
        await mountAndReplay(app, SID_FIDELITY, 940, 8);
        await enterFind(app);

        await app.nativeType("aurora");
        await waitForCountChip(app, `1 of ${EXPECTED_AURORA_SEQUENCE.length}`);
        await waitForPaintedCount(app, EXPECTED_AURORA_SEQUENCE.length);

        const painted = await readPaintedRanges(app);
        // COUNT agreement: everything the index counted painted, nothing more.
        expect(painted.length).toBe(EXPECTED_AURORA_SEQUENCE.length);
        // ORDER agreement: the document-order casing sequence is exactly the
        // hand-computed source order — the k-th index hit is the k-th DOM hit.
        expect(painted.map((p) => p.text)).toEqual(EXPECTED_AURORA_SEQUENCE);
        // Chrome exclusion: no painted range sits inside the tool header
        // (the collapsed Bash block's `echo aurora`).
        const headerHit = await app.evalJS<boolean>(
          `(() => {
            for (const name of ['transcript-find-match', 'transcript-find-active']) {
              const hl = CSS.highlights.get(name);
              if (!hl) continue;
              for (const r of hl) {
                const el = r.startContainer.parentElement;
                if (el && el.closest('[data-slot="tool-call-header"], .tool-block-chrome')) return true;
              }
            }
            return false;
          })()`,
        );
        expect(headerHit, "chrome text must never paint").toBe(false);
        // The active match is the first occurrence.
        const active = painted.filter((p) => p.active);
        expect(active).toHaveLength(1);
        expect(active[0]!.text).toBe(EXPECTED_AURORA_SEQUENCE[0]);

        // ⌘G advances the active match to the second occurrence. The repaint
        // lands a frame after the chip update, so poll the highlight itself.
        await findNext(app);
        await waitForCountChip(app, `2 of ${EXPECTED_AURORA_SEQUENCE.length}`);
        await waitForActiveText(app, EXPECTED_AURORA_SEQUENCE[1]!);

        // A query spanning two adjacent findable containers (thinking body →
        // text body) matches nothing on either side.
        await clearQuery(app);
        await app.nativeType("seamaseamb");
        await waitForCountChip(app, "No results");
        expect(await readPaintedRanges(app)).toEqual([]);
        // …while each side alone matches inside its own container.
        await clearQuery(app);
        await app.nativeType("seama");
        await waitForCountChip(app, "1 of 1");
        await waitForPaintedCount(app, 1);
        const seam = await readPaintedRanges(app);
        expect(seam).toHaveLength(1);
        expect(seam[0]!.text).toBe("seamA");

        // Expanded tool content joins the count and paint, live: expand the
        // Bash block (command + terminal output) and the default-routed
        // Probe block (markdown result), re-query, then collapse the Bash
        // block and watch its two matches leave — the expansion notify
        // drives the recompute, no manual refresh.
        await revealAndClick(
          app,
          '[data-slot="bash-tool-block"] [data-slot="tool-call-header-disclosure"]',
        );
        await revealAndClick(
          app,
          '[data-slot="default-tool-block"] [data-slot="tool-call-header-disclosure"]',
        );
        await app.nativeClickAtElement(EDITOR_SELECTOR);
        await clearQuery(app);
        await app.nativeType("aurora");
        // 12 prose + bash command `echo aurora` + bash output `aurora
        // printed` + Probe markdown result = 15.
        await waitForCountChip(app, "1 of 15");
        await waitForPaintedCount(app, 15);
        await revealAndClick(
          app,
          '[data-slot="bash-tool-block"] [data-slot="tool-call-header-disclosure"]',
        );
        await waitForCountChip(app, "1 of 13");
        await waitForPaintedCount(app, 13);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "whole-transcript count is scroll-independent; ⌘G wraps across off-screen matches",
    async () => {
      const app = await launchTugApp({ testName: "at0221-virtual" });
      try {
        // Short pane so the long fixture cannot mount everything at once.
        await mountAndReplay(app, SID_VIRTUAL, 560, 3);
        await enterFind(app);

        await app.nativeType("zephyrmark");
        // Both occurrences count although (at most) one end of the
        // transcript is mounted.
        await waitForCountChip(app, "1 of 2");

        await findNext(app);
        await waitForCountChip(app, "2 of 2");
        // Wrap: advancing past the last match returns to the first.
        await findNext(app);
        await waitForCountChip(app, "1 of 2");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "typing reveals into the visible band; refinement re-reveals; the flash ring is scroller-contained",
    async () => {
      const app = await launchTugApp({ testName: "at0221-reveal" });
      try {
        // Short pane; the replayed transcript rests at the bottom while the
        // first match sits in the TOP row.
        await mountAndReplay(app, SID_VIRTUAL, 560, 3);
        await enterFind(app);

        // Scroll-as-you-type: the typed query alone (no ⌘G) must reveal the
        // first match — far above the resting viewport — into the band.
        await app.nativeType("zephyrmark");
        await waitForCountChip(app, "1 of 2");
        await waitForActiveInBand(app);
        const painted = await readPaintedRanges(app);
        const active = painted.find((p) => p.active);
        expect(active).toBeDefined();
        // The active match is the document-first one (the top row).
        expect(active!.row).toBe(Math.min(...painted.map((p) => p.row)));

        // Refinement: extending the query kills the top match, so the active
        // match becomes the BOTTOM row's occurrence — same activeIndex (0),
        // different identity. The transcript must follow it back down, and
        // the match must clear the scroller's bottom edge (never tucked
        // under the prompt entry).
        await app.nativeType(" omega");
        await waitForCountChip(app, "1 of 1");
        await waitForActiveText(app, "zephyrmark omega");
        await waitForActiveInBand(app);

        // Flash containment: arm the insertion probe, then navigate (a
        // one-match wrap re-reveals and flashes). The ring must be an
        // absolutely-positioned CHILD of the scroller, contained by its
        // box, overlapping the active match.
        expect(await app.evalJS<boolean>(INSTALL_FLASH_PROBE_JS)).toBe(true);
        await findNext(app);
        await app.waitForCondition<boolean>(
          `window.__at0221Flash !== undefined`,
          { timeoutMs: 6000 },
        );
        const report = JSON.parse(
          await app.evalJS<string>(`JSON.stringify(window.__at0221Flash)`),
        ) as {
          inScroller: boolean;
          position: string;
          contained: boolean;
          overlapsActive: boolean;
        };
        expect(report.inScroller, "ring must be a child of the scroller").toBe(true);
        expect(report.position).toBe("absolute");
        expect(report.contained, "ring must stay inside the scroller box").toBe(true);
        expect(report.overlapsActive, "ring must sit on the active match").toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a match deep in an expanded Read file body counts, unfolds, and selects via CM6",
    async () => {
      const app = await launchTugApp({ testName: "at0221-file-body" });
      try {
        await mountAndReplay(app, SID_FILE, 940, 2);

        // Expand the Read block (whole-block chevron). Its 120-line file
        // exceeds the FileBlock fold threshold, so the embedded CodeMirror
        // editor stays UNMOUNTED until find navigation unfolds it.
        await revealAndClick(
          app,
          '[data-slot="read-tool-block"] [data-slot="tool-call-header-disclosure"]',
        );
        await enterFind(app);
        await app.nativeType("glacierseed");
        // Counted from the store text although no editor is mounted yet.
        await waitForCountChip(app, "1 of 1");

        // Navigation (the initial active match) unfolds the file body,
        // mounts CM6, and selects the match — `.cm-searchMatch-selected`
        // is the editor-side active treatment.
        await app.waitForCondition<boolean>(
          `(() => {
            const el = document.querySelector(
              '[data-slot="read-tool-block"] .cm-searchMatch-selected',
            );
            return el !== null && (el.textContent || '').includes("glacierseed");
          })()`,
          { timeoutMs: 10_000 },
        );
        // The count is unchanged by the unfold (paint follows, count leads).
        expect(await readCountChip(app)).toBe("1 of 1");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "shell exchange content is searchable; collapsing removes count AND paint",
    async () => {
      const app = await launchTugApp({ testName: "at0221-shell" });
      try {
        await mountAndReplay(app, SID_FIDELITY, 940, 8);

        // Run a REAL shell exchange through the `$` route (the shell child
        // is per-session and live — same mechanics as at0216's
        // `execAndSettle`: wait for the route flip, settle typing, force
        // the submit with ⌘Enter, and wait for the exchange's exit badge).
        await app.click(
          '[data-card-id="A"] .tug-prompt-entry-toolbar button[aria-label="Route"]',
        );
        await app.click('.tug-menu-item[data-item-id="$"]');
        await app.waitForCondition<boolean>(
          `(() => {
            const el = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
            return el !== null && (el.textContent || '').trim() === "Shell";
          })()`,
          { timeoutMs: 4000 },
        );
        await app.nativeClickAtElement(EDITOR_SELECTOR);
        await app.nativeType("echo quartzling-out");
        await new Promise((r) => setTimeout(r, 150));
        await app.nativeKey("Enter", ["cmd"]);
        await app.waitForCondition<boolean>(
          `(() => {
            const rows = document.querySelectorAll('[data-slot="dev-transcript-shell-row"]');
            if (rows.length === 0) return false;
            const row = rows[rows.length - 1];
            const foot = row.querySelector('[data-slot="dev-z1b-end-state"]');
            return foot !== null && (foot.textContent || '').includes('exit') &&
              (row.textContent || '').includes('quartzling-out');
          })()`,
          { timeoutMs: 20_000 },
        );

        await enterFind(app);
        await app.nativeType("quartzling");
        // Two units: the header command (`echo quartzling-out`) and the
        // output line (`quartzling-out`).
        await waitForCountChip(app, "1 of 2");
        await waitForPaintedCount(app, 2);
        const painted = await readPaintedRanges(app);
        expect(painted).toHaveLength(2);
        expect(painted.every((p) => p.text === "quartzling")).toBe(true);

        // Collapse the exchange via its header chevron: the count AND the
        // paint drop together — the command stays visible in the header,
        // but the collapse guard keeps it unpainted while the index
        // projects nothing (Spec S01's collapse-guard case).
        await app.click(
          '[data-slot="dev-transcript-shell-row"] [data-slot="tool-call-header-disclosure"]',
        );
        await waitForCountChip(app, "No results");
        expect(await readPaintedRanges(app)).toEqual([]);

        // Expand it again: both matches return, live (the expansion
        // notify drives the recompute — no manual refresh).
        await app.click(
          '[data-slot="dev-transcript-shell-row"] [data-slot="tool-call-header-disclosure"]',
        );
        await waitForCountChip(app, "1 of 2");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
