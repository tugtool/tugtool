/**
 * at0181-external-session-picker.test.ts — terminal-created sessions in
 * the project picker (session unification).
 *
 * Sessions created by the Claude Code terminal app live as JSONLs under
 * `~/.claude/projects/<encoded-dir>/` with no Tug ledger row. The picker
 * must surface them (union path: tugcast scans the directory, tags rows
 * `origin: "external"`), block the ones a live terminal process holds
 * (per the `~/.claude/sessions` registry), and resume the free ones
 * through the real spawn → tugcode → JSONL-replay pipeline.
 *
 * This test seeds the REAL `~/.claude/projects/` (under a unique
 * per-run temp project path, removed in teardown) with two TUI-shaped
 * session fixtures — full uuid/parentUuid chains plus the terminal
 * app's bookkeeping records (`mode`, `permission-mode`,
 * `file-history-snapshot`, `ai-title`) — and a REAL registry entry
 * (this test process's own pid, verified via `ps`) marking one of them
 * terminal-live. It asserts:
 *
 *   (A) both external rows list for the typed project, with the
 *       provenance badge data (`data-origin="external"`), the ai-title
 *       as the row title, and real turn metadata;
 *   (B) the terminal-live row renders blocked
 *       (`data-terminal-live="true"` + `data-disabled`), the free row
 *       does not;
 *   (C) selecting the free row and pressing Open resumes it for real —
 *       the card binds and the transcript replays both seeded user
 *       prompts through tugcode's JSONL replay (exercising the TUI
 *       bookkeeping-record skip path end-to-end).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SESSION_FREE = randomUUID();
const SESSION_HELD = randomUUID();

const PICKER_FORM = ".dev-card-picker-form";
const RECENTS = '[data-tug-focus-key="dev-picker-cycle:1"]';
const OPEN = '[data-tug-focus-key="dev-picker-cycle:5"]';
const USER_ROWS = '[data-card-id="A"] [data-testid="dev-card-transcript-user-body"]';

const rowSel = (id: string): string => `[data-session-id="${id}"]`;

let projectDir = "";
let seededClaudeDir = "";
let registryEntryPath = "";

/** Mirror of claude's project-dir encoding (`/` and `.` → `-`). */
function encodeProjectDir(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

/**
 * A TUI-shaped session transcript: terminal bookkeeping records around
 * two committed user→assistant turns, with the uuid/parentUuid chain,
 * timestamps, and per-record session/cwd stamps real transcripts carry.
 */
function tuiSessionJsonl(sessionId: string, cwd: string, title: string): string {
  const u1 = randomUUID();
  const a1 = randomUUID();
  const u2 = randomUUID();
  const a2 = randomUUID();
  const stamp = (uuid: string, parentUuid: string | null, t: string) => ({
    parentUuid,
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.173",
    gitBranch: "",
    uuid,
    timestamp: t,
  });
  const assistantMessage = (id: string, text: string) => ({
    model: "claude-opus-4-7",
    id,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  return [
    JSON.stringify({ type: "mode", mode: "normal", sessionId }),
    JSON.stringify({ type: "permission-mode", permissionMode: "default", sessionId }),
    JSON.stringify({
      type: "file-history-snapshot",
      messageId: u1,
      snapshot: { messageId: u1, trackedFileBackups: {} },
      isSnapshotUpdate: false,
    }),
    JSON.stringify({
      ...stamp(u1, null, "2026-06-10T10:00:00.000Z"),
      type: "user",
      message: { role: "user", content: "first seeded prompt" },
    }),
    JSON.stringify({
      ...stamp(a1, u1, "2026-06-10T10:00:05.000Z"),
      type: "assistant",
      message: assistantMessage("msg_at0181_a1", "first reply"),
      requestId: "req_at0181_1",
    }),
    JSON.stringify({
      ...stamp(u2, a1, "2026-06-10T10:01:00.000Z"),
      type: "user",
      message: { role: "user", content: "second seeded prompt" },
    }),
    JSON.stringify({
      ...stamp(a2, u2, "2026-06-10T10:01:05.000Z"),
      type: "assistant",
      message: assistantMessage("msg_at0181_a2", "second reply"),
      requestId: "req_at0181_2",
    }),
    JSON.stringify({ type: "ai-title", aiTitle: title, sessionId }),
  ].join("\n");
}

/** Start time of this test process as `ps` formats `lstart`. */
function ownProcStart(): string {
  const proc = Bun.spawnSync(["ps", "-p", String(process.pid), "-o", "lstart="]);
  return proc.stdout.toString().trim().replace(/\s+/g, " ");
}

beforeAll(() => {
  if (!SHOULD_RUN) return;
  // Canonicalize: macOS `tmpdir()` lives under `/var` (a symlink to
  // `/private/var`), and both claude and tugcode resolve the project
  // dir via realpath before deriving the JSONL directory name — the
  // seeded fixture must live under the canonical encoding.
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0181-external-")));
  seededClaudeDir = join(
    homedir(),
    ".claude",
    "projects",
    encodeProjectDir(projectDir),
  );
  mkdirSync(seededClaudeDir, { recursive: true });
  writeFileSync(
    join(seededClaudeDir, `${SESSION_FREE}.jsonl`),
    tuiSessionJsonl(SESSION_FREE, projectDir, "Free fixture session"),
  );
  writeFileSync(
    join(seededClaudeDir, `${SESSION_HELD}.jsonl`),
    tuiSessionJsonl(SESSION_HELD, projectDir, "Held fixture session"),
  );
  // Real registry entry: this test process's pid genuinely holds
  // SESSION_HELD. The procStart cross-check passes against `ps`.
  const registryDir = join(homedir(), ".claude", "sessions");
  mkdirSync(registryDir, { recursive: true });
  registryEntryPath = join(registryDir, `at0181-${process.pid}.json`);
  writeFileSync(
    registryEntryPath,
    JSON.stringify({
      pid: process.pid,
      sessionId: SESSION_HELD,
      cwd: projectDir,
      procStart: ownProcStart(),
      kind: "interactive",
      entrypoint: "cli",
      status: "busy",
    }),
  );
});

afterAll(() => {
  if (registryEntryPath !== "" && existsSync(registryEntryPath)) {
    rmSync(registryEntryPath, { force: true });
  }
  if (seededClaudeDir !== "" && existsSync(seededClaudeDir)) {
    rmSync(seededClaudeDir, { recursive: true, force: true });
  }
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

// Dispatch a real `keydown` on the focused element (document-capture
// pipeline — same path a hardware key travels; see at0141).
function pressKey(app: { evalJS<T>(s: string): Promise<T> }, key: string): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      return null;
    })()`,
  );
}

// Dispatch a bubbling click on an element. Travels the same React
// root-listener pipeline a hardware click does (the wrapper onClick /
// delegate.onSelect run for real); skips only the OS→WebView
// coordinate delivery, which is exercised elsewhere and is hostile to
// rows that may sit below the picker's fold (`nativeClickAtElement`
// clicks blind screen coordinates with no scroll-into-view).
function clickElement(app: { evalJS<T>(s: string): Promise<T> }, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return false;
      el.scrollIntoView({ block: "nearest" });
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0181: terminal-created sessions in the picker", () => {
  test(
    "external rows list with provenance + liveness; the free one resumes and replays",
    async () => {
      const app = await launchTugApp({ testName: "at0181-external-session-picker" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );

        // Unbound dev card → picker. Seed Recents with the temp project
        // so committing the recent fills the path field (the same one
        // value the sessions query reads).
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.evalJS<null>(
          `(window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [${JSON.stringify(projectDir)}] } }), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(RECENTS)}) !== null`,
          { timeoutMs: 8000 },
        );
        // Land the cycle on Recents and commit the (only) recent into
        // the path field: cursor seeds on landing, Enter commits.
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(OPEN)});
            return el ? el.hasAttribute("data-key-view-kbd") : false;
          })()`,
          { timeoutMs: 8000 },
        );
        await pressKey(app, "Tab"); // Open → path field (wrap)
        await pressKey(app, "Tab"); // path field → Recents
        await app.waitForCondition<boolean>(
          `document.querySelector('.dev-card-picker-recents-list [data-key-cursor]') !== null`,
          { timeoutMs: 6000 },
        );
        await pressKey(app, "Enter");

        // (A) Both external rows list for the typed project. The free
        // row carries provenance + the ai-title + real turn metadata.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(rowSel(SESSION_FREE))}) !== null`,
          { timeoutMs: 15000 },
        );
        const freeRow = await app.evalJS<{
          origin: string | null;
          terminalLive: string | null;
          disabled: string | null;
          text: string;
        }>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(rowSel(SESSION_FREE))});
            return {
              origin: el.getAttribute("data-origin"),
              terminalLive: el.getAttribute("data-terminal-live"),
              disabled: el.getAttribute("data-disabled"),
              text: el.textContent || "",
            };
          })()`,
        );
        expect(freeRow.origin).toBe("external");
        expect(freeRow.terminalLive).toBeNull();
        expect(freeRow.disabled).toBeNull();
        expect(freeRow.text).toContain("Free fixture session");
        expect(freeRow.text).toContain("2 turns");

        // (B) The terminal-live row renders blocked.
        const heldRow = await app.evalJS<{
          terminalLive: string | null;
          disabled: string | null;
          text: string;
        }>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(rowSel(SESSION_HELD))});
            return el === null ? null : {
              terminalLive: el.getAttribute("data-terminal-live"),
              disabled: el.getAttribute("data-disabled"),
              text: el.textContent || "",
            };
          })()`,
        );
        expect(heldRow).not.toBeNull();
        expect(heldRow.terminalLive).toBe("true");
        expect(heldRow.disabled).toBe("true");
        expect(heldRow.text).toContain("In use in a terminal");

        // (C) Select the free row and Open: the real resume pipeline —
        // spawn_session(mode=resume) on a session tugcast never spawned
        // → tugcode → JSONL replay → transcript rows.
        expect(await clickElement(app, rowSel(SESSION_FREE))).toBe(true);
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(rowSel(SESSION_FREE))});
            return el !== null && el.getAttribute("data-selected") === "true";
          })()`,
          { timeoutMs: 6000 },
        );
        expect(await clickElement(app, OPEN)).toBe(true);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 2`,
          { timeoutMs: 30000 },
        );
        const prompts = await app.evalJS<string>(
          `Array.from(document.querySelectorAll(${JSON.stringify(USER_ROWS)})).map(function(el){ return el.textContent; }).join(" | ")`,
        );
        expect(prompts).toContain("first seeded prompt");
        expect(prompts).toContain("second seeded prompt");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
