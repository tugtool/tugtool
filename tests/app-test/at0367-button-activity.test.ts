/**
 * at0367-button-activity.test.ts — a button's in-flight tell, both shapes.
 *
 * `TugButtonActivity` is the component-level answer to "this button has been
 * pressed and the work has not come back yet." Two shapes share one
 * attribute, and this drives both on the two live call sites:
 *
 *  - **Swap** — the Z5 submit button carries an `activityIcon` (the wave),
 *    and `data-tug-activity` picks which of the two mounted glyphs shows.
 *    This is what the shell-arbitration wait wears while a submit is parked.
 *  - **Twinkle** — the commit rail's Generate-a-commit-message button keeps
 *    its glyph and animates the parts the glyph declared movable: the three
 *    sparkles run the twinkle keyframes, the pencil under them does not.
 *
 * The attribute is deliberately the contract rather than the `activity`
 * prop — a surface that must not re-render for a transient (the prompt
 * entry's `setArbitrating`, which parks a submit for a few hundred ms)
 * writes it by hand — so writing it here is the production path, not a
 * stand-in for one. What is being asserted is the cascade's answer: which
 * glyph is displayed, and which elements the keyframes are attached to.
 *
 * Motion itself is not asserted. A background window runs no animation
 * frames at all, so any assertion on a moving pixel would be a coin flip;
 * the honest question is whether the animation is bound to the right
 * elements, which computed style answers with the window in any state.
 *
 * @covers tugdeck/src/components/tugways/internal/tug-button.tsx
 * @covers tugdeck/src/components/tugways/internal/tug-button.css
 * @covers tugdeck/src/components/tugways/tug-icons.tsx
 * @covers tugdeck/src/components/tugways/tug-icons.css
 *
 * Deliberately not `@covers` on `tug-prompt-entry.tsx`: the composer is this
 * suite's venue, not its subject, and it already sits at its accepted fan-out
 * budget. What is under test is the button facility and the glyph — the
 * composer's own commit rail is at0253's.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0367-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;
const SUBMIT = `${CARD} .tug-prompt-entry-submit-button`;
const AUTO = `${CARD} [data-testid="tug-prompt-entry-commit-auto"]`;
const COMMIT_BUTTON = `${CARD} [data-testid="tug-prompt-entry-commit-button"]`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0367-activity-"));
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Read the two halves of a button's icon slot and which one the cascade shows. */
function glyphSlotProbe(selector: string): string {
  return `(() => {
    const b = document.querySelector(${JSON.stringify(selector)});
    if (b === null) return { present: false };
    const rest = b.querySelector(".tug-button-rest-icon");
    const act = b.querySelector(".tug-button-activity-icon");
    return {
      present: true,
      activity: b.getAttribute("data-tug-activity"),
      ariaBusy: b.getAttribute("aria-busy"),
      restDisplay: rest === null ? null : getComputedStyle(rest).display,
      activityDisplay: act === null ? null : getComputedStyle(act).display,
      restGlyph: rest === null ? null : rest.querySelector("svg")?.classList.contains("lucide-arrow-up") ?? false,
      waveBars: act === null ? 0 : act.querySelectorAll(".tug-progress-wave-bar").length,
    };
  })()`;
}

/** Read the animation bound to each part of the auto button's glyph. */
function sparkProbe(): string {
  return `(() => {
    const b = document.querySelector(${JSON.stringify(AUTO)});
    if (b === null) return { present: false };
    const sparks = Array.from(b.querySelectorAll(".tug-icon-spark"));
    const pencil = Array.from(b.querySelectorAll("svg > path"));
    return {
      present: true,
      activity: b.getAttribute("data-tug-activity"),
      sparkCount: sparks.length,
      pencilCount: pencil.length,
      sparkNames: sparks.map((s) => getComputedStyle(s).animationName),
      sparkDelays: sparks.map((s) => parseFloat(getComputedStyle(s).animationDelay)),
      sparkOrigins: sparks.map((s) => getComputedStyle(s).transformBox),
      pencilNames: pencil.map((p) => getComputedStyle(p).animationName),
    };
  })()`;
}

interface SlotProbe {
  present: boolean;
  activity: string | null;
  ariaBusy: string | null;
  restDisplay: string | null;
  activityDisplay: string | null;
  restGlyph: boolean | null;
  waveBars: number;
}

interface SparkProbe {
  present: boolean;
  activity: string | null;
  sparkCount: number;
  pencilCount: number;
  sparkNames: string[];
  sparkDelays: number[];
  sparkOrigins: string[];
  pencilNames: string[];
}

describe.skipIf(!SHOULD_RUN)("AT0367: button activity — swap and twinkle", () => {
  test(
    "the submit button swaps arrow for wave, and the sparkles twinkle without the pencil",
    async () => {
      const app = await launchTugApp({ testName: "at0367-button-activity" });
      try {
        // `awaitEngineReady` polls a deck-trace event; without the trace on
        // there is nothing for it to see.
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: SID, projectDir });
        await app.awaitEngineReady("A");

        // Drive one committed turn so the card is a live, non-empty session.
        const frame = (decoded: Record<string, unknown>) =>
          app.driveSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: { tug_session_id: SID, ...decoded },
          });
        await app.driveSession("A", { op: "send", text: "hello there" });
        await frame({ type: "prompt_anchor", promptUuid: "uuid-1" });
        await frame({ type: "content_block_start", msg_id: "m1", block_index: 0, kind: "text" });
        await frame({ type: "assistant_text", msg_id: "m1", block_index: 0, text: "hi", is_partial: false });
        await frame({ type: "turn_complete", msg_id: "m1", result: "success" });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 1`,
          { timeoutMs: 8000 },
        );

        // ── Swap, at rest ────────────────────────────────────────────────────
        // Both halves are mounted from the first paint — that is what lets the
        // arbitration write an attribute instead of rendering — but only the
        // arrow shows, and the parked wave is `display: none` so its keyframe
        // loop is not running while nobody is waiting on anything.
        const rest = await app.evalJS<SlotProbe>(glyphSlotProbe(SUBMIT));
        expect(rest.present).toBe(true);
        expect(rest.activity).toBe(null);
        expect(rest.restDisplay).toBe("flex");
        expect(rest.activityDisplay).toBe("none");
        expect(rest.restGlyph).toBe(true);
        expect(rest.waveBars).toBe(3);

        // ── Swap, in flight ──────────────────────────────────────────────────
        // The attribute is what `setArbitrating` writes on a parked submit.
        await app.evalJS<boolean>(
          `(document.querySelector(${JSON.stringify(SUBMIT)}).setAttribute("data-tug-activity", "busy"), true)`,
        );
        const busy = await app.evalJS<SlotProbe>(glyphSlotProbe(SUBMIT));
        expect(busy.restDisplay).toBe("none");
        expect(busy.activityDisplay).toBe("flex");

        // And back: the tell is reversible, which is the whole point of a
        // withdrawable wait.
        await app.evalJS<boolean>(
          `(document.querySelector(${JSON.stringify(SUBMIT)}).removeAttribute("data-tug-activity"), true)`,
        );
        const back = await app.evalJS<SlotProbe>(glyphSlotProbe(SUBMIT));
        expect(back.restDisplay).toBe("flex");
        expect(back.activityDisplay).toBe("none");

        // ── Twinkle ──────────────────────────────────────────────────────────
        // `/commit` puts the cancel / auto-message / commit rail in Z5.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/commit");
        await settle();
        await app.nativeKey("Escape"); // dismiss the completion popup
        await settle();
        await app.nativeKey("Return", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMMIT_BUTTON)}) !== null &&
           document.querySelector(${JSON.stringify(AUTO)}) !== null`,
          { timeoutMs: 6000 },
        );

        // At rest the glyph is a still drawing: three sparkles, two pencil
        // strokes, no animation anywhere.
        const still = await app.evalJS<SparkProbe>(sparkProbe());
        expect(still.present).toBe(true);
        expect(still.activity).toBe(null);
        expect(still.sparkCount).toBe(3);
        expect(still.pencilCount).toBe(2);
        expect(still.sparkNames).toEqual(["none", "none", "none"]);

        // While the scribe writes, the button wears `twinkle` — the sparks
        // take the keyframes, staggered, each scaling about its own box; the
        // pencil stays still under them.
        await app.evalJS<boolean>(
          `(document.querySelector(${JSON.stringify(AUTO)}).setAttribute("data-tug-activity", "twinkle"), true)`,
        );
        const lit = await app.evalJS<SparkProbe>(sparkProbe());
        expect(lit.sparkNames).toEqual([
          "tugx-icon-twinkle",
          "tugx-icon-twinkle",
          "tugx-icon-twinkle",
        ]);
        expect(lit.sparkOrigins).toEqual(["fill-box", "fill-box", "fill-box"]);
        // Distinct negative delays: the three are already mid-cycle and out of
        // phase on the first frame, rather than blinking in unison.
        expect(new Set(lit.sparkDelays).size).toBe(3);
        expect(lit.sparkDelays.every((d) => d <= 0)).toBe(true);
        expect(lit.pencilNames).toEqual(["none", "none"]);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
