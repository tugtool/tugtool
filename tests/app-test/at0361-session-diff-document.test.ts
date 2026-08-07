/**
 * at0361-session-diff-document.test.ts — the Changes shade's session diff
 * document: this session's attributed changes as ONE long-scrolling
 * `TugDiffDocument` above the file list, collapsed by default.
 *
 * The document is session-confined by construction — its descriptor's
 * pathspec is the session entry's own file list — so proving it needs a real
 * session entry. Same wall at0334 retired, same way through: `app.seedLedger()`
 * writes a live session plus a proof-class `file_events` row through the real
 * `SessionLedger` after launch, the aggregate composes a session entry over a
 * really-dirty file in this checkout, and the document's expand fires a real
 * `git_diff_request` round-trip.
 *
 * What one launch drives:
 *
 * - the toggle row renders and the document does NOT (collapsed by default);
 * - expanding renders the owned file's synthesized new-file diff — real
 *   hunks, under the "This session's changes (git diff HEAD)" label;
 * - a second, UNOWNED dirty file sits in the unattributed list below but
 *   never enters the document — the session-confinement the old repo-wide
 *   `/diff` sheet could not offer;
 * - collapsing unmounts the document ([L26]).
 *
 * @covers tugdeck/src/components/tugways/cards/session-changes/session-changes-view.tsx
 * @covers tugdeck/src/components/tugways/cards/session-changes/session-changes-view.css
 * @covers tugdeck/src/lib/git-diff-store.ts
 * @covers tugdeck/src/lib/changes-route-controller.ts
 * @covers tugdeck/src/components/tugways/tug-diff-document.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SID = "at0361-session";
const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;
const SHEET = `${CARD} .session-view-pane[data-view="changes"] [data-slot="tug-sheet"]`;
const DOC = `${SHEET} [data-slot="session-changes-doc"]`;
const DOC_TOGGLE = `${DOC} .session-changes-doc-toggle`;
const DOC_DOCUMENT = `${DOC} [data-slot="tug-diff-document"]`;
const DOC_FILE = `${DOC} [data-testid="diff-file"]`;
const DOC_HUNK = `${DOC} [data-slot="diff-hunk"]`;

// The registry keys a workspace by the canonical project dir, so the dirty
// files live in this checkout (the aggregate composes no other project) and
// are removed afterwards. OWNED joins the session entry via the seeded proof
// row; LOOSE has no tool call behind it and stays unattributed.
const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));
const OWNED_FILE = "at0361-owned.txt";
const LOOSE_FILE = "at0361-loose.txt";
const ownedPath = join(PROJECT_DIR, OWNED_FILE);
const loosePath = join(PROJECT_DIR, LOOSE_FILE);

const SESSION_ROW =
  `${SHEET} .tug-changes-list-file-list[data-entry-kind="session"] ` +
  `[data-testid="tug-changes-list-file-block"][data-path="${OWNED_FILE}"]`;

beforeAll(() => {
  if (!SHOULD_RUN) return;
  writeFileSync(ownedPath, "at0361 owned by the session\n");
  writeFileSync(loosePath, "at0361 nobody claims this\n");
});

afterAll(() => {
  if (existsSync(ownedPath)) rmSync(ownedPath, { force: true });
  if (existsSync(loosePath)) rmSync(loosePath, { force: true });
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 1000, height: 760 },
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

describe.skipIf(!SHOULD_RUN)("AT0361: session diff document in the Changes shade", () => {
  test(
    "collapsed by default, expands to the session-confined document, collapses by unmount",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath, { sourceTreePath: PROJECT_DIR });
      const app = await launchTugApp({
        testName: "at0361-session-diff-document",
        env: { TUGBANK_PATH: tugbankPath },
      });
      try {
        // After launch, not before — tugcast demotes every `live` row to
        // `closed` once at startup, so a pre-launch seed would be swept and
        // the file would surface as `orphaned`.
        app.seedLedger({
          sessions: [
            {
              session_id: SID,
              workspace_key: PROJECT_DIR,
              project_dir: PROJECT_DIR,
              card_id: "A",
              name: "at0361 work",
            },
          ],
          file_events: [
            {
              tug_session_id: SID,
              tool_use_id: "at0361-tu-1",
              file_path: ownedPath,
              tool_name: "Write",
              op: "created",
              // Proof class — a bracket hint never makes an owner, and the
              // document only renders over the session entry's files.
              origin: "exact",
              ambiguous: false,
              project_dir: PROJECT_DIR,
              at: Date.now(),
            },
          ],
        });
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", {
          tugSessionId: SID,
          projectDir: PROJECT_DIR,
          workspaceKey: PROJECT_DIR,
        });
        await app.awaitEngineReady("A", { timeoutMs: 15000 });

        // One committed turn so the card is a live, non-empty session.
        await app.driveSession("A", { op: "send", text: "hello" });
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: 0x40,
          decoded: { tug_session_id: SID, type: "prompt_anchor", promptUuid: "uuid-1" },
        });
        await app.driveSession("A", {
          op: "ingestFrame",
          feedId: 0x40,
          decoded: { tug_session_id: SID, type: "turn_complete", msg_id: "m1", result: "success" },
        });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 1`,
          { timeoutMs: 8000 },
        );

        // ── Raise the changes sheet ────────────────────────────────────────
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/commit");
        await settle();
        await app.nativeKey("Escape"); // dismiss the completion popup
        await settle();
        await app.nativeKey("Return", ["cmd"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
          { timeoutMs: 8000 },
        );

        // ── The seeded session composes as a SESSION entry ─────────────────
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SESSION_ROW)}) !== null`,
          { timeoutMs: 30000 },
        );

        // ── Collapsed by default: toggle row present, document absent ──────
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DOC_TOGGLE)}) !== null`,
          { timeoutMs: 8000 },
        );
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(DOC_DOCUMENT)}).length`,
          ),
        ).toBe(0);

        // ── Expand: the real round-trip renders the owned file's hunks ─────
        await app.nativeClickAtElement(DOC_TOGGLE);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DOC_FILE)}).length >= 1`,
          { timeoutMs: 15000 },
        );
        // Short file → auto-expanded → its synthesized new-file hunk renders.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DOC_HUNK)}).length >= 1`,
          { timeoutMs: 8000 },
        );

        const doc = await app.evalJS<{ label: string | null; paths: string[] }>(
          `(() => {
             const doc = document.querySelector(${JSON.stringify(DOC)});
             const label = doc.querySelector(".tug-diff-document-header-label");
             return {
               label: label === null ? null : label.textContent,
               paths: Array.from(
                 doc.querySelectorAll(".tug-diff-document-file-path"),
                 (el) => el.textContent ?? "",
               ),
             };
           })()`,
        );
        expect(doc.label).toBe("This session's changes (git diff HEAD)");
        expect(doc.paths).toContain(OWNED_FILE);
        // Session-confined: the unowned dirty file never enters the document…
        expect(doc.paths).not.toContain(LOOSE_FILE);
        // …even though the shade itself knows it, in the unattributed list.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(
              `${SHEET} .tug-changes-list-file-list[data-entry-kind="unattributed"] [data-path="${LOOSE_FILE}"]`,
            )}).length`,
          ),
        ).toBe(1);

        // ── Collapse unmounts the document ([L26]) ─────────────────────────
        await app.nativeClickAtElement(DOC_TOGGLE);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DOC_DOCUMENT)}).length === 0`,
          { timeoutMs: 8000 },
        );
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
