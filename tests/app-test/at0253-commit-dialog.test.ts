/**
 * at0253-commit-dialog.test.ts — the transcript-resident `TugCommitDialog`
 * open/dismiss drives, and the read-only Changes shade open/dismiss ([P03],
 * [P02], #step-8).
 *
 * Cheap drives only: typing `/commit` opens the dialog at the transcript tail
 * (its `data-slot` appears), and Escape dismisses it; ⇧⌘C opens the read-only
 * Changes shade (its Done button appears), and Escape dismisses it. The full
 * commit round-trip is NOT app-testable — the replay workspace's changeset
 * entries live ~2s — so it is covered at the Rust layer instead. The dialog
 * opens regardless of changeset state ([P09]), so no real changes are needed.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0253-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;
const COMMIT_DIALOG = `${CARD} [data-slot="session-commit-dialog"]`;
const CHANGES_DONE = `${CARD} [data-testid="session-changes-done"]`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0253-commit-"));
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

describe.skipIf(!SHOULD_RUN)("AT0253: commit dialog + read-only shade", () => {
  test(
    "/commit opens the dialog (Escape dismisses); ⇧⌘C opens the read-only shade (Escape dismisses)",
    async () => {
      const app = await launchTugApp({ testName: "at0253-commit-dialog" });
      try {
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

        // ── /commit opens the dialog at the transcript tail ──────────────────
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/commit");
        await settle();
        await app.nativeKey("Escape"); // dismiss the completion popup
        await settle();
        await app.nativeKey("Return", ["cmd"]); // submit → run /commit
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMMIT_DIALOG)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Escape dismisses the dialog.
        await settle();
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMMIT_DIALOG)}) === null`,
          { timeoutMs: 4000 },
        );

        // ── `!changes` opens the read-only Changes shade ─────────────────────
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("!changes");
        await settle();
        await app.nativeKey("Escape"); // dismiss any completion popup
        await settle();
        await app.nativeKey("Return", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHANGES_DONE)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Escape dismisses the shade.
        await settle();
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHANGES_DONE)}) === null`,
          { timeoutMs: 4000 },
        );

        // The card and its transcript survived both open/dismiss cycles.
        const after = await app.evalJS<{ cardPresent: boolean; userRows: number }>(
          `({
             cardPresent: document.querySelector(${JSON.stringify(CARD)}) !== null,
             userRows: document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length,
           })`,
        );
        expect(after.cardPresent).toBe(true);
        expect(after.userRows).toBe(1);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
