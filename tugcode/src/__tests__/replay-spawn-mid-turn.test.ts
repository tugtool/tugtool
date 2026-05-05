// Mid-turn replay regression suite (Smoke D), Step 4 ledger-driven design.
//
// Pins the post-fix contract for the mid-turn reload scenario under
// the mid-turn-replay step 4 architecture: tugcast's `SessionLedger`
// `turns` table is the source of truth for what to replay, keyed by
// `tug_turn_id` (the UUIDv4 tugcast mints at user-submit time and
// splices into the inbound `user_message` envelope). `runReplay`
// reads rows for the session from `sessions.db` (read-only via
// `bun:sqlite`), branches per-row on `state`, and:
//
//   - `state='complete'` → emit `user_message_replay`, look up the
//     turn's content in JSONL via `extractTurnContent` keyed on
//     `claude_message_id` (re-keyed to `tug_turn_id` for the wire),
//     emit `turn_complete`.
//   - `state='pending'` matching the live `ActiveTurn` → delegate to
//     `emitInflightTurnFromActiveTurn` so the user-half + the
//     consolidated assistant snapshot land from authoritative
//     `ActiveTurn` state.
//   - `state='pending'` with no matching live turn → stale-pending
//     defensive synthesis (treat as interrupted).
//   - `state='interrupted'` → emit user-half + JSONL or partial_text
//     fallback + `turn_cancelled`.
//
// Test surface: open a temp `sessions.db`, write the schema + seed
// rows, point `SessionManager` at the path via the new
// `sessionsDbPath` constructor option, drive `runReplay`, capture the
// wire output via `Bun.write` interception. Same fixture rig as the
// pre-Step-4 file with the addition of the ledger-seed helper and
// the constructor wiring.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type JsonlReadResult,
  SessionManager,
} from "../session.ts";
import type { OutboundMessage } from "../types.ts";

// ---------------------------------------------------------------------------
// Mock stdout (mirrors the helper in replay-spawn-drain.test.ts)
// ---------------------------------------------------------------------------

interface MockClaudeStdout {
  stream: ReadableStream<Uint8Array>;
  feed(obj: unknown): void;
  close(): void;
}

function makeMockClaudeStdout(): MockClaudeStdout {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controllerRef = c;
    },
  });
  const enc = new TextEncoder();
  return {
    stream,
    feed(obj: unknown): void {
      if (controllerRef === null) {
        throw new Error("MockClaudeStdout: feed() called before stream start");
      }
      controllerRef.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
    },
    close(): void {
      if (controllerRef === null) {
        throw new Error("MockClaudeStdout: close() called before stream start");
      }
      controllerRef.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Test fixtures: tug_turn_id (ledger row key) and claude_message_id
// (JSONL key) are now distinct concepts under Step 4. The committed
// turn's tug_turn_id is what the ledger row is keyed by; its
// `claude_message_id` matches the JSONL's terminal assistant id so
// `extractTurnContent` can find the content. Same shape for the
// in-flight turn.
// ---------------------------------------------------------------------------

const COMMITTED_USER_TEXT = "first prompt";
const COMMITTED_REPLY_TEXT = "first reply";
const COMMITTED_TUG_TURN_ID = "tug_committed_1";
const COMMITTED_CLAUDE_MSG_ID = "msg_committed_claude_1";
const INFLIGHT_USER_TEXT = "second prompt";
const INFLIGHT_REPLY_TEXT_FROM_JSONL = "partial reply from JSONL";
const INFLIGHT_TUG_TURN_ID = "tug_inflight_2";
const INFLIGHT_CLAUDE_MSG_ID = "msg_inflight_claude_id_2";

function fixtureJsonl(): string {
  // The JSONL covers both turns; `extractTurnContent` filters per
  // claude_message_id when the ledger drives a row that needs
  // assistant content.
  const lines = [
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: COMMITTED_USER_TEXT }] },
    },
    {
      type: "assistant",
      message: {
        id: COMMITTED_CLAUDE_MSG_ID,
        role: "assistant",
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: COMMITTED_REPLY_TEXT }],
      },
    },
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: INFLIGHT_USER_TEXT }] },
    },
    {
      type: "assistant",
      message: {
        id: INFLIGHT_CLAUDE_MSG_ID,
        role: "assistant",
        model: "claude-haiku-4-5",
        // stop_reason: null → JSONL has the partial trailing turn
        // (the bytes claude streamed before the user reloaded).
        // Step 4: this content is reachable via extractTurnContent
        // when the ledger row's claude_message_id matches.
        stop_reason: null,
        content: [{ type: "text", text: INFLIGHT_REPLY_TEXT_FROM_JSONL }],
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Ledger seeding helper. Opens a temp sessions.db, writes the v2
// schema (mirrors tugcast's bootstrap so the cross-process WAL
// invariant is exercised by the same shape), and inserts the rows the
// test wants. Returns the file path so the rig can pass it through
// `sessionsDbPath`.
// ---------------------------------------------------------------------------

interface SeedTurnRow {
  tug_turn_id: string;
  ordinal: number;
  state: "pending" | "complete" | "interrupted";
  user_text: string;
  user_attachments?: unknown[];
  claude_message_id?: string | null;
  partial_text?: string | null;
}

function seedLedger(
  dir: string,
  sessionId: string,
  rows: SeedTurnRow[],
): string {
  const dbPath = join(dir, "sessions.db");
  const db = new Database(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
          session_id        TEXT PRIMARY KEY,
          workspace_key     TEXT NOT NULL,
          project_dir       TEXT NOT NULL,
          created_at        INTEGER NOT NULL,
          last_used_at      INTEGER NOT NULL,
          turn_count        INTEGER NOT NULL DEFAULT 0,
          first_user_prompt TEXT,
          state             TEXT NOT NULL,
          card_id_live      TEXT
      );
      CREATE TABLE IF NOT EXISTS turns (
          tug_turn_id        TEXT PRIMARY KEY,
          session_id         TEXT NOT NULL,
          ordinal            INTEGER NOT NULL,
          claude_message_id  TEXT,
          user_text          TEXT NOT NULL,
          user_attachments   BLOB NOT NULL,
          state              TEXT NOT NULL,
          partial_text       TEXT,
          created_at         INTEGER NOT NULL,
          completed_at       INTEGER
      );
    `);
    db.run(
      `INSERT INTO sessions (
        session_id, workspace_key, project_dir,
        created_at, last_used_at, turn_count,
        first_user_prompt, state, card_id_live
      ) VALUES (?, 'ws-1', '/proj', 1000, 1000, ?, NULL, 'live', 'card-1')`,
      [sessionId, rows.length],
    );
    const insert = db.prepare(`
      INSERT INTO turns (
        tug_turn_id, session_id, ordinal, claude_message_id,
        user_text, user_attachments, state, partial_text,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      const attBlob = Buffer.from(
        JSON.stringify(row.user_attachments ?? []),
        "utf8",
      );
      insert.run(
        row.tug_turn_id,
        sessionId,
        row.ordinal,
        row.claude_message_id ?? null,
        row.user_text,
        attBlob,
        row.state,
        row.partial_text ?? null,
        1000,
        row.state === "complete" ? 2000 : null,
      );
    }
  } finally {
    db.close();
  }
  return dbPath;
}

// ---------------------------------------------------------------------------
// Wire capture (mirrors the rig in replay-spawn-drain.test.ts)
// ---------------------------------------------------------------------------

interface E2Rig {
  manager: SessionManager;
  stdout: MockClaudeStdout;
  emitted: OutboundMessage[];
  flush(): Promise<void>;
  cleanup(): void;
}

function makeE2Rig(opts?: {
  ledgerRows?: SeedTurnRow[];
  // Override the session id so it's the row-key tugcode queries on.
  // The default is fine for tests that seed a single self-consistent
  // batch.
  sessionId?: string;
}): E2Rig {
  const stdout = makeMockClaudeStdout();
  const stderr = new ReadableStream<Uint8Array>({
    start(c) {
      c.close();
    },
  });

  const sessionId = opts?.sessionId ?? crypto.randomUUID();
  const projectDir = `/tmp/e2-mid-turn-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  // Seed ledger rows in a temp dir if requested. Tests that drive the
  // cold-boot fallback omit `ledgerRows` and pass `sessionsDbPath:
  // null` implicitly via this branch.
  const tmpDir = mkdtempSync(join(tmpdir(), "tide-e2-mid-turn-"));
  const sessionsDbPath: string | null =
    opts?.ledgerRows !== undefined
      ? seedLedger(tmpDir, sessionId, opts.ledgerRows)
      : null;

  const manager = new SessionManager(
    projectDir,
    sessionId,
    "resume",
    undefined,
    {
      claudeProjectsRoot: "/tmp/e2-mid-turn-fixtures",
      jsonlReader: async (): Promise<JsonlReadResult> => ({
        kind: "ok" as const,
        jsonl: fixtureJsonl(),
      }),
      replayTimeoutMs: 10_000,
      sessionsDbPath,
    },
  );

  // Inject mock claude child.
  const mockChild = {
    stdout: stdout.stream,
    stderr,
    stdin: { write: () => {}, end: () => {}, flush: () => {} },
    exited: new Promise<number>(() => {}),
    kill: () => {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manager as any).spawnClaude = () => mockChild;

  const emitted: OutboundMessage[] = [];
  const originalWrite = Bun.write;
  const decoder = new TextDecoder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Bun as any).write = (dest: unknown, data: unknown) => {
    if (dest === Bun.stdout) {
      let text = "";
      if (typeof data === "string") text = data;
      else if (data instanceof Uint8Array) text = decoder.decode(data);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          try {
            emitted.push(JSON.parse(trimmed) as OutboundMessage);
          } catch {
            // ignore
          }
        }
      }
    }
    return Promise.resolve(
      data instanceof Uint8Array ? data.length : (data as string).length,
    );
  };

  const originalExit = process.exit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = (_code?: number) => {};

  return {
    manager,
    stdout,
    emitted,
    async flush() {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
    cleanup() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).write = originalWrite;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = originalExit;
      // Close the manager's read-only DB handle (release the lock so
      // the temp tree can be cleaned up).
      manager.shutdown().catch(() => {});
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // tempdir already gone — no-op.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// ActiveTurn surrogate. Step 4: `msgId` is the readonly tug_turn_id
// from the inbound envelope; `claudeMessageId` is captured separately
// via `setClaudeMessageId` (first-write-wins). The previous
// `msgIdCanonicalized` / `canonicalizeMsgId` shape is gone.
// ---------------------------------------------------------------------------

function makeActiveTurnSurrogate(opts: {
  msgId: string;
  userText: string;
  userAttachments?: Array<{ filename: string; content: string; media_type: string }>;
  claudeMessageId?: string | null;
}): {
  msgId: string;
  seq: number;
  userText: string;
  userAttachments: Array<{ filename: string; content: string; media_type: string }>;
  rev: number;
  partialText: string;
  gotResult: boolean;
  interrupted: boolean;
  suppressEmit: boolean;
  claudeMessageId: string | null;
  completion: Promise<void>;
  setClaudeMessageId(id: string): boolean;
  finish(): void;
} {
  let resolveCompletion: (() => void) | null = null;
  const completion = new Promise<void>((r) => {
    resolveCompletion = r;
  });
  return {
    msgId: opts.msgId,
    seq: 100,
    userText: opts.userText,
    userAttachments: opts.userAttachments ?? [],
    rev: 0,
    partialText: "",
    gotResult: false,
    interrupted: false,
    suppressEmit: false,
    claudeMessageId: opts.claudeMessageId ?? null,
    completion,
    setClaudeMessageId(id: string): boolean {
      if (this.claudeMessageId !== null) return false;
      this.claudeMessageId = id;
      return true;
    },
    finish(): void {
      if (resolveCompletion !== null) {
        resolveCompletion();
        resolveCompletion = null;
      }
    },
  };
}

describe("runReplay with in-flight turn (mid-turn replay design, ledger-driven)", () => {
  test("Smoke D: ledger has committed + pending row; in-flight emits from ActiveTurn between committed turn and replay_complete", async () => {
    // Seed two rows: one COMPLETE for the committed turn (its
    // claude_message_id points into JSONL via extractTurnContent),
    // one PENDING matching the surrogate ActiveTurn (handled by
    // emitInflightTurnFromActiveTurn). Wire ordering:
    //   replay_started → committed turn (synthesized + JSONL content)
    //   → in-flight emission (from ActiveTurn) → replay_complete.
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: COMMITTED_TUG_TURN_ID,
          ordinal: 0,
          state: "complete",
          user_text: COMMITTED_USER_TEXT,
          claude_message_id: COMMITTED_CLAUDE_MSG_ID,
        },
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 1,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.partialText = "live deltas so far";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      const types = rig.emitted.map((m) => m.type);
      expect(types).toContain("replay_started");
      expect(types).toContain("replay_complete");

      // Committed turn: user_message_replay + assistant_text + turn_complete,
      // all keyed by the COMMITTED_TUG_TURN_ID (re-keyed by extractTurnContent).
      const committedEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === COMMITTED_TUG_TURN_ID,
      );
      const committedTypes = committedEvents.map((e) => e.type);
      expect(committedTypes).toContain("user_message_replay");
      expect(committedTypes).toContain("assistant_text");
      expect(committedTypes).toContain("turn_complete");
      const committedAssistant = committedEvents.find(
        (e) => e.type === "assistant_text",
      ) as { text: string } | undefined;
      expect(committedAssistant?.text).toBe(COMMITTED_REPLY_TEXT);

      // In-flight turn: emitInflightTurnFromActiveTurn writes
      // user_message_replay + assistant_text (from turn.partialText).
      // No turn_complete (still-live; gotResult/interrupted both false).
      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      expect(inflightEvents.map((e) => e.type)).toEqual([
        "user_message_replay",
        "assistant_text",
      ]);
      const userReplay = inflightEvents[0] as { text: string };
      expect(userReplay.text).toBe(INFLIGHT_USER_TEXT);
      const assistantText = inflightEvents[1] as { text: string; is_partial: boolean };
      expect(assistantText.text).toBe("live deltas so far");
      expect(assistantText.is_partial).toBe(false);

      // Ordering: committed turn lands BEFORE in-flight; both BEFORE
      // replay_complete.
      const committedTcIdx = rig.emitted.findIndex(
        (m: OutboundMessage) =>
          m.type === "turn_complete" &&
          (m as { msg_id?: string }).msg_id === COMMITTED_TUG_TURN_ID,
      );
      const inflightFirstIdx = rig.emitted.findIndex(
        (m) =>
          "msg_id" in m &&
          (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      const replayCompleteIdx = rig.emitted.findIndex(
        (m) => m.type === "replay_complete",
      );
      expect(committedTcIdx).toBeGreaterThanOrEqual(0);
      expect(inflightFirstIdx).toBeGreaterThan(committedTcIdx);
      expect(replayCompleteIdx).toBeGreaterThan(inflightFirstIdx);

      // Count: 1 (committed turn flushed; pending row didn't fire a
      // terminal because gotResult/interrupted both false).
      const completeFrame = rig.emitted[replayCompleteIdx] as { count: number };
      expect(completeFrame.count).toBe(1);

      // suppressEmit cleared in finally.
      expect(turn.suppressEmit).toBe(false);
    } finally {
      rig.cleanup();
    }
  });

  test("[DM06] mitigation: gotResult latching during the suppressed window emits turn_complete inside the bracket", async () => {
    // Seed one PENDING row matching the surrogate's tug_turn_id.
    // The setter hook flips gotResult to true the moment runReplay
    // sets suppressEmit, modeling "claude's result event landed
    // mid-bracket". emitInflightTurnFromActiveTurn picks up gotResult
    // and emits user_message_replay + assistant_text + turn_complete.
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 0,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.partialText = "the complete answer";
      let suppressBacking = false;
      Object.defineProperty(turn, "suppressEmit", {
        configurable: true,
        get(): boolean {
          return suppressBacking;
        },
        set(v: boolean) {
          suppressBacking = v;
          if (v === true) {
            this.gotResult = true;
          }
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      expect(inflightEvents.map((e) => e.type)).toEqual([
        "user_message_replay",
        "assistant_text",
        "turn_complete",
      ]);
      const tc = inflightEvents[2] as { result: string; msg_id: string };
      expect(tc.result).toBe("success");
      expect(tc.msg_id).toBe(INFLIGHT_TUG_TURN_ID);

      // turn_complete lands BEFORE replay_complete (inside the bracket).
      const tcIdx = rig.emitted.findIndex(
        (m: OutboundMessage) =>
          m.type === "turn_complete" &&
          (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      const replayCompleteIdx = rig.emitted.findIndex(
        (m) => m.type === "replay_complete",
      );
      expect(tcIdx).toBeGreaterThanOrEqual(0);
      expect(tcIdx).toBeLessThan(replayCompleteIdx);
    } finally {
      rig.cleanup();
    }
  });

  test("[DM06] mitigation: interrupted latching during the suppressed window emits turn_cancelled inside the bracket", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 0,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.partialText = "I was halfway through";
      let suppressBacking = false;
      Object.defineProperty(turn, "suppressEmit", {
        configurable: true,
        get(): boolean {
          return suppressBacking;
        },
        set(v: boolean) {
          suppressBacking = v;
          if (v === true) {
            this.interrupted = true;
          }
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      expect(inflightEvents.map((e) => e.type)).toEqual([
        "user_message_replay",
        "assistant_text",
        "turn_cancelled",
      ]);
      const tcanc = inflightEvents[2] as { partial_result: string; msg_id: string };
      expect(tcanc.partial_result).toBe("I was halfway through");
      expect(tcanc.msg_id).toBe(INFLIGHT_TUG_TURN_ID);
    } finally {
      rig.cleanup();
    }
  });

  test("cold-boot no-rows path: ledger has no rows; runReplay falls back to JSONL translator", async () => {
    // Pre-migration / fresh-install case. No ledger DB — runReplay's
    // sessionsDb is null and the cold-boot fallback (the legacy
    // translateJsonlSession path) fires. The trailing in-flight turn
    // in the JSONL orphan-synthesizes as turn_complete{result:'error'}
    // keyed by the claude_message_id (no re-keying — the cold-boot
    // path doesn't have a tug_turn_id).
    const rig = makeE2Rig(); // no ledgerRows → sessionsDbPath: null
    try {
      rig.manager.prepareSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = null;

      await rig.manager.runReplay();
      await rig.flush();

      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      const types = inflightEvents.map((e) => e.type);
      // Translator emits the orphan synthesis: user_message_replay +
      // assistant_text + turn_complete{result: "error"}.
      expect(types).toContain("user_message_replay");
      expect(types).toContain("turn_complete");
      const tc = inflightEvents.find((m) => m.type === "turn_complete") as
        | { result: string }
        | undefined;
      expect(tc?.result).toBe("error");
    } finally {
      rig.cleanup();
    }
  });

  test("stale pending row (no matching live ActiveTurn): defensive synthesis as turn_cancelled", async () => {
    // Step 4.7 will reconcile pending rows on session resume; this
    // run still emits a coherent transcript line so the user sees
    // the prior turn happened.
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: "tug_stale",
          ordinal: 0,
          state: "pending",
          user_text: "stale prompt",
          claude_message_id: null,
          partial_text: "stale partial",
        },
      ],
    });
    try {
      rig.manager.prepareSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = null;

      await rig.manager.runReplay();
      await rig.flush();

      const events = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === "tug_stale",
      );
      const types = events.map((e) => e.type);
      expect(types).toEqual([
        "user_message_replay",
        "assistant_text",
        "turn_cancelled",
      ]);
      const cancelled = events[2] as { partial_result: string };
      expect(cancelled.partial_result).toBe("stale partial");
    } finally {
      rig.cleanup();
    }
  });

  test("active turn already finished (gotResult=true at entry): runReplay does NOT adopt it; ledger row hits stale-pending defensive path", async () => {
    // Tight-window edge: dispatchEventToTurn just latched gotResult
    // and called turn.finish(), but handleUserMessage's finally hasn't
    // cleared activeTurn yet. runReplay's adoption guard
    // (`!gotResult && !interrupted`) excludes this case → inflight is
    // null. The pending row's branch sees no matching inflight and
    // falls into the stale-pending defensive synthesis.
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 0,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.gotResult = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      // suppressEmit was never set on this turn (runReplay didn't
      // adopt it).
      expect(turn.suppressEmit).toBe(false);

      // Stale-pending defensive emit lands.
      const events = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("user_message_replay");
      expect(types).toContain("turn_cancelled");
    } finally {
      rig.cleanup();
    }
  });

  test("post-bracket live deltas land normally after suppressEmit clears", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 0,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();
      await rig.manager.spawnClaudeAndWatch();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      // After runReplay, suppressEmit cleared.
      expect(turn.suppressEmit).toBe(false);

      // A post-bracket delta should writeLine as the normal partial
      // assistant_text shape, keyed by the tug_turn_id.
      rig.stdout.feed({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "POST_BRACKET_DELTA" },
        },
      });
      await rig.flush();
      const postBracketPartials = rig.emitted.filter(
        (m) =>
          m.type === "assistant_text" &&
          (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID &&
          (m as { is_partial?: boolean }).is_partial === true &&
          (m as { text?: string }).text === "POST_BRACKET_DELTA",
      );
      expect(postBracketPartials).toHaveLength(1);
    } finally {
      rig.cleanup();
    }
  });

  // Bug-scenario regression test for the manual-test bug from
  // 2026-05-05: submit a turn, immediately Developer > Reload, the
  // turn disappears until a second reload. Under the Step 4 design
  // the bug is structurally impossible because tug_turn_id is stable
  // from submission and the ledger row exists regardless of JSONL
  // state. Pinned here so a future regression lands LOUDLY.
  test("bug-scenario regression (manual reload symptom): pending row + ActiveTurn produces user_message_replay + assistant_text", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 0,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      // The bug surfaced even when no claude content had streamed yet
      // (turn.partialText empty); the user-side message just
      // disappears. Pin the empty case explicitly.
      turn.partialText = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      // user_message_replay must land — that's the symptom under test.
      const userReplay = rig.emitted.find(
        (m) =>
          m.type === "user_message_replay" &&
          (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      ) as { text: string } | undefined;
      expect(userReplay).toBeDefined();
      expect(userReplay?.text).toBe(INFLIGHT_USER_TEXT);

      // No assistant_text (empty partialText), no terminal (still-live).
      const assistantText = rig.emitted.find(
        (m) =>
          m.type === "assistant_text" &&
          (m as { msg_id?: string }).msg_id === INFLIGHT_TUG_TURN_ID,
      );
      expect(assistantText).toBeUndefined();
    } finally {
      rig.cleanup();
    }
  });

  // Invariant pin: one msg_id per logical turn on the wire.
  test("invariant: every wire frame for a logical turn shares one msg_id (= the seeded tug_turn_id)", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: COMMITTED_TUG_TURN_ID,
          ordinal: 0,
          state: "complete",
          user_text: COMMITTED_USER_TEXT,
          claude_message_id: COMMITTED_CLAUDE_MSG_ID,
        },
        {
          tug_turn_id: INFLIGHT_TUG_TURN_ID,
          ordinal: 1,
          state: "pending",
          user_text: INFLIGHT_USER_TEXT,
          claude_message_id: null,
        },
      ],
    });
    try {
      rig.manager.prepareSession();
      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_TUG_TURN_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.partialText = "live";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;
      await rig.manager.runReplay();
      await rig.flush();

      const seenMsgIds = new Set<string>();
      for (const m of rig.emitted) {
        if ("msg_id" in m && typeof (m as { msg_id?: unknown }).msg_id === "string") {
          seenMsgIds.add((m as { msg_id: string }).msg_id);
        }
      }
      // Exactly the two seeded tug_turn_ids — no claude_message_id
      // leaks onto the wire as msg_id.
      const expected = new Set([COMMITTED_TUG_TURN_ID, INFLIGHT_TUG_TURN_ID]);
      expect(seenMsgIds.size).toBe(expected.size);
      for (const id of expected) {
        expect(seenMsgIds.has(id)).toBe(true);
      }
    } finally {
      rig.cleanup();
    }
  });

  // Defensive: complete row with null claude_message_id.
  test("defensive: complete row with null claude_message_id emits user + turn_complete (no assistant_text), warns", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: "tug_no_claude",
          ordinal: 0,
          state: "complete",
          user_text: "completed without claude id",
          claude_message_id: null, // shouldn't happen in practice
        },
      ],
    });
    const errors: string[] = [];
    const originalErr = console.error;
    console.error = (msg: unknown) => {
      errors.push(String(msg));
    };
    try {
      rig.manager.prepareSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = null;

      await rig.manager.runReplay();
      await rig.flush();

      const events = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === "tug_no_claude",
      );
      const types = events.map((e) => e.type);
      expect(types).toEqual(["user_message_replay", "turn_complete"]);
      // warn was logged.
      expect(
        errors.some((e) => e.includes("complete_row_missing_claude_id")),
      ).toBe(true);
    } finally {
      console.error = originalErr;
      rig.cleanup();
    }
  });

  // Defensive: duplicate claude_message_id across rows.
  test("defensive: two complete rows with same claude_message_id; latest ordinal wins for content lookup, others warn", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: "tug_dup_a",
          ordinal: 0,
          state: "complete",
          user_text: "first",
          claude_message_id: COMMITTED_CLAUDE_MSG_ID,
        },
        {
          tug_turn_id: "tug_dup_b",
          ordinal: 1,
          state: "complete",
          user_text: "second",
          claude_message_id: COMMITTED_CLAUDE_MSG_ID, // same as above
        },
      ],
    });
    const errors: string[] = [];
    const originalErr = console.error;
    console.error = (msg: unknown) => {
      errors.push(String(msg));
    };
    try {
      rig.manager.prepareSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = null;

      await rig.manager.runReplay();
      await rig.flush();

      // Both rows produce user_message_replay + turn_complete; only
      // the later row (tug_dup_b) gets assistant_text from JSONL.
      const aEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === "tug_dup_a",
      );
      const bEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === "tug_dup_b",
      );
      // Row a (earlier) skips JSONL content; row b (latest) gets it.
      expect(aEvents.find((e) => e.type === "assistant_text")).toBeUndefined();
      expect(bEvents.find((e) => e.type === "assistant_text")).toBeDefined();
      // warn fired naming the duplicate.
      expect(
        errors.some((e) => e.includes("duplicate_claude_message_id")),
      ).toBe(true);
    } finally {
      console.error = originalErr;
      rig.cleanup();
    }
  });

  // Defensive: if a future regression makes runLedgerDrivenReplay
  // throw mid-emission, the surrounding try/catch must still emit a
  // replay_complete{error} so the reducer unwinds out of the
  // replaying phase. Without the catch, the bracket would hang
  // forever and tugdeck's card would freeze.
  test("ledger-path runReplay surfaces replay_complete{error} on synchronous throw", async () => {
    const rig = makeE2Rig({
      ledgerRows: [
        {
          tug_turn_id: "tug_throw",
          ordinal: 0,
          state: "complete",
          user_text: "hello",
          claude_message_id: COMMITTED_CLAUDE_MSG_ID,
        },
      ],
    });
    try {
      rig.manager.prepareSession();
      // Inject a throw by replacing nextSeq() with a hostile mock
      // that throws on first call. runLedgerDrivenReplay calls
      // nextSeq() inside the `complete` branch when emitting
      // turn_complete — so this fires after replay_started and the
      // user_message_replay write, but before the bracket closes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).nextSeq = () => {
        throw new Error("synthetic ledger-replay failure");
      };

      let threw: unknown = null;
      try {
        await rig.manager.runReplay();
      } catch (err) {
        threw = err;
      }
      await rig.flush();

      // The synthetic error propagated out (so upstream supervision
      // sees the failure, not a silent stall).
      expect(threw).toBeInstanceOf(Error);
      expect((threw as Error).message).toContain("synthetic ledger-replay failure");

      // Crucially, replay_complete WAS emitted — closing the
      // bracket so the reducer can unwind. The error frame's `kind`
      // identifies the failure mode for diagnostics.
      const complete = rig.emitted.find((m) => m.type === "replay_complete") as
        | {
            type: "replay_complete";
            error?: { kind: string; message: string };
          }
        | undefined;
      expect(complete).toBeDefined();
      expect(complete?.error?.kind).toBe("jsonl_unreadable");
      expect(complete?.error?.message).toContain("ledger_replay_failed");
      expect(complete?.error?.message).toContain("synthetic ledger-replay failure");
    } finally {
      rig.cleanup();
    }
  });
});
