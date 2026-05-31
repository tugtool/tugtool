/**
 * at0099-resume-command.test.ts — the `/resume` focused sessions overlay
 * ([#step-8]).
 *
 * With a live, bound dev session (a turn driven via `driveDevSession` — no live
 * claude), typing `/resume` and submitting opens a CARD-SCOPED sessions overlay
 * — distinct from the full-card `DevProjectPicker`: it shows the sessions list
 * but NOT the project-path entry / recents chrome (it's a same-project
 * live-session rebind). Cancel dismisses the overlay and leaves the live
 * session intact — the card is not closed and its transcript survives.
 *
 * (Picking a session to rebind goes through the same `fireRestore` /
 * `sendSpawnSession` path the full picker's Open uses; the spawn/resume
 * round-trip is a supervisor concern out of this store-only harness's reach.
 * This test pins the overlay's open / chrome / cancel-keeps-session contract.)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0099-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHEET = '[data-slot="tug-sheet"]';
const USER_ROWS = `${CARD} [data-testid="dev-card-transcript-user-body"]`;
const SHEET_SESSIONS = `${SHEET} .dev-card-picker-sessions-list`;
const SHEET_RECENTS = `${SHEET} .dev-card-picker-recents-host`;
const RESUME_CANCEL = `${SHEET} [data-testid="resume-cancel"]`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0099-resume-"));
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0099: /resume focused sessions overlay", () => {
  test(
    "type /resume → sessions overlay (no path/recents chrome); cancel keeps the live session",
    async () => {
      const app = await launchTugApp({ testName: "at0099-resume-command" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID, projectDir });
        await app.awaitEngineReady("A");

        // Drive one committed turn so the card is a live, non-empty session.
        const frame = (decoded: Record<string, unknown>) =>
          app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: { tug_session_id: SID, ...decoded },
          });
        await app.driveDevSession("A", { op: "send", text: "hello there" });
        await frame({ type: "prompt_anchor", promptUuid: "uuid-1" });
        await frame({ type: "content_block_start", msg_id: "m1", block_index: 0, kind: "text" });
        await frame({ type: "assistant_text", msg_id: "m1", block_index: 0, text: "hi", is_partial: false });
        await frame({ type: "turn_complete", msg_id: "m1", result: "success" });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 1`,
          { timeoutMs: 8000 },
        );

        // Open /resume via the real submit path.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/resume");
        await new Promise((r) => setTimeout(r, 200));
        await app.nativeKey("Escape");
        await new Promise((r) => setTimeout(r, 200));
        await app.nativeKey("Return", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Sessions-only chrome: the sessions list is present; the full
        // picker's project-path / recents chrome is NOT.
        const chrome = await app.evalJS<{ hasSessions: boolean; hasRecents: boolean }>(
          `({
             hasSessions: document.querySelector(${JSON.stringify(SHEET_SESSIONS)}) !== null,
             hasRecents: document.querySelector(${JSON.stringify(SHEET_RECENTS)}) !== null,
           })`,
        );
        expect(chrome.hasSessions).toBe(true);
        expect(chrome.hasRecents).toBe(false);

        // Cancel → overlay dismisses, the live session is untouched.
        await app.nativeClickAtElement(RESUME_CANCEL);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) === null`,
          { timeoutMs: 4000 },
        );
        const after = await app.evalJS<{ cardPresent: boolean; userRows: number }>(
          `({
             cardPresent: document.querySelector(${JSON.stringify(CARD)}) !== null,
             userRows: document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length,
           })`,
        );
        expect(after.cardPresent).toBe(true); // card not closed
        expect(after.userRows).toBe(1); // transcript intact
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
