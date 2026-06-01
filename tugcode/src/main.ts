#!/usr/bin/env bun
// Tugcode: Claude Code bridge — stream-json IPC between Claude Code and tugcast

import { readLine, writeLine, writeLineAndExit } from "./ipc.ts";
import {
  isProtocolInit,
  isUserMessage,
  isToolApproval,
  isQuestionAnswer,
  isInterrupt,
  isPermissionMode,
  isModelChange,
  isEffortChange,
  isSessionCommand,
  isStopTask,
  isRequestReplay,
  isRewindPreview,
  isSessionRewind,
  isSkillsInventoryQuery,
} from "./types.ts";
import { SessionManager } from "./session.ts";
import { loadTranscript, StubReplayEngine } from "./stub-replay.ts";
import { readClaudeCodeSettings } from "./claude-code-settings.ts";
import { ContextBreakdownEmitter } from "./context-breakdown.ts";
import { buildSkillsInventory } from "./skills-inventory.ts";
import { homedir } from "node:os";
import { join } from "node:path";

// Redirect console.log/warn/error to stderr to keep stdout clean for JSON-lines
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: unknown[]) => {
  originalError("[tugcode]", ...args);
};
console.warn = (...args: unknown[]) => {
  originalError("[tugcode WARN]", ...args);
};
console.error = (...args: unknown[]) => {
  originalError("[tugcode ERROR]", ...args);
};

// Parse CLI arguments
let projectDir: string = process.cwd();
// `--session-id <uuid>` is the one identifier for this session:
// claude's own session id (either claimed via `--session-id` for a
// fresh spawn or matched via `--resume` for a resume), the tugbank
// sessions-record key, and the id tugcast routes CODE_OUTPUT under.
// Default to a freshly minted UUID so SessionManager always has a stable
// identifier; `--session-id <id>` from the args loop below overrides it
// when tugcast supplies one.
let sessionId: string = crypto.randomUUID();
// `--session-mode new|resume` picks between a fresh spawn (claude
// claims `sessionId` as its own id) and resuming an existing
// conversation. Absent / unknown values fall through to "new".
let sessionMode: "new" | "resume" = "new";
// `--resume-session <id>` is the persisted claude session id — the
// canonical key for the on-disk JSONL at
// `~/.claude/projects/<encoded-dir>/<id>.jsonl`. When tugcast has a
// persisted record for this card with `claude_session_id != null`,
// it passes the id through this flag so resume mode forwards
// `--resume <id>` to claude using the *claude* id rather than the
// tug session id (which only matches when no fork has occurred).
//
// Absent in two cases:
//   - Fresh spawns (`--session-mode new`): no resume id needed.
//   - Resume spawns whose claude id was never captured (a previous
//     session crashed pre-`session_init`, or an older tugbank record
//     written before persistence was added). In both cases
//     `SessionManager` falls back to using `sessionId` for the
//     claude `--resume <id>` flag — the legacy path that works for
//     un-forked sessions.
let resumeSessionId: string | undefined;
// `--stub-transcript=<path>` (or `--stub-transcript <path>`) routes
// the IPC loop through the deterministic replay engine in
// `stub-replay.ts` instead of spawning claude. Test-only;
// production tugcode never sees this flag.
let stubTranscriptPath: string | undefined;
const args = Bun.argv.slice(2); // Skip bun and script path
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir" && i + 1 < args.length) {
    projectDir = args[i + 1];
    i++;
  } else if (args[i] === "--session-id" && i + 1 < args.length) {
    sessionId = args[i + 1];
    i++;
  } else if (args[i] === "--session-mode" && i + 1 < args.length) {
    const raw = args[i + 1];
    sessionMode = raw === "resume" ? "resume" : "new";
    i++;
  } else if (args[i] === "--resume-session" && i + 1 < args.length) {
    resumeSessionId = args[i + 1];
    i++;
  } else if (args[i].startsWith("--stub-transcript=")) {
    stubTranscriptPath = args[i].slice("--stub-transcript=".length);
  } else if (args[i] === "--stub-transcript" && i + 1 < args.length) {
    stubTranscriptPath = args[i + 1];
    i++;
  }
}

console.log(
  `Starting tugcode (projectDir: ${projectDir}, sessionId: ${sessionId}, sessionMode: ${sessionMode}${resumeSessionId ? `, resumeSessionId: ${resumeSessionId}` : ""}${stubTranscriptPath ? `, stubTranscript: ${stubTranscriptPath}` : ""})`,
);

// Session manager (initialized after protocol handshake). Only
// populated in the live (claude-spawning) path; stub-replay mode
// leaves this null and routes all messages through `stubReplay`.
let sessionManager: SessionManager | null = null;
let stubReplay: StubReplayEngine | null = null;

// Graceful signal handlers: close stdin and kill claude process. SIGTERM
// and SIGHUP are both routed through the same path. SIGHUP covers the
// Unix "controlling process died" signal that arrives when tugcast (our
// parent) exits ungracefully — without handling it, tugcode would keep
// running as an orphan reparented to PID 1, pinning the claude pipe open.
function shutdownOnSignal(signal: string): void {
  console.log(`${signal} received, shutting down`);
  if (sessionManager) {
    sessionManager
      .shutdown()
      .catch((err) => {
        console.error("Shutdown error:", err);
      })
      .finally(() => {
        process.exit(0);
      });
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdownOnSignal("SIGTERM"));
process.on("SIGHUP", () => shutdownOnSignal("SIGHUP"));

// IPC loop. When stdin closes (parent hangup / pipe EOF), the for-await
// loop exits naturally. We then run the same shutdown path as SIGTERM so
// the live claude subprocess doesn't keep Bun's event loop alive and
// leave tugcode running as an orphan.
async function main() {
  // Stub-replay mode: load the transcript up front so a malformed
  // file fails fast (before the harness has issued protocol_init).
  // The engine doesn't emit anything until protocol_init arrives.
  if (stubTranscriptPath !== undefined) {
    try {
      const transcript = loadTranscript(stubTranscriptPath);
      stubReplay = new StubReplayEngine({
        transcript,
        sessionId,
        emit: (msg) => writeLine(msg),
      });
    } catch (err) {
      // writeLineAndExit awaits Bun.write before process.exit so
      // the error frame actually lands in tugcode's stdout pipe.
      // A bare writeLine + process.exit races the async write
      // against the exit and silently drops the frame.
      await writeLineAndExit(
        {
          type: "error",
          message: `${err instanceof Error ? err.message : String(err)}`,
          recoverable: false,
          ipc_version: 2,
        },
        1,
      );
      return; // unreachable in production; guard for tests that stub process.exit
    }
  }

  for await (const msg of readLine()) {
    if (isProtocolInit(msg)) {
      // Protocol handshake
      if (msg.version !== 1) {
        // Use writeLineAndExit so the error frame is flushed to
        // stdout before the process exits. With writeLine being
        // serialized through a promise chain, a plain
        // `writeLine(...); process.exit(1)` would race the queued
        // microtask against the exit and silently drop the frame.
        await writeLineAndExit(
          {
            type: "error",
            message: `Unsupported protocol version: ${msg.version}`,
            recoverable: false,
            ipc_version: 2,
          },
          1,
        );
        return; // unreachable in production; guard for tests that stub process.exit
      }

      // Stub mode: synthesize the handshake from the replay engine
      // and skip claude-spawn entirely.
      if (stubReplay !== null) {
        stubReplay.synthesizeHandshake(msg.version);
        continue;
      }

      // Read the user's Claude Code settings once at session start
      // and build the context_breakdown emitter from them. Settings
      // come from `~/.claude/settings.json` and degrade to documented
      // defaults on missing / malformed file — the emitter is
      // production-resilient. See claude-code-settings.ts for the
      // exact fallback policy.
      const claudeCodeSettings = await readClaudeCodeSettings();
      const contextBreakdownEmitter = new ContextBreakdownEmitter({
        sessionId,
        homeDir: homedir(),
        cwd: projectDir,
        // The project plugin dir — mirrors `SessionManager.getPluginDir()`.
        // Its `agents/` and `skills/` fold into the breakdown.
        pluginDir: join(projectDir, "tugplug"),
        settings: claudeCodeSettings,
      });

      // Create session manager and initialize claude process
      sessionManager = new SessionManager(
        projectDir,
        sessionId,
        sessionMode,
        resumeSessionId,
        { contextBreakdownEmitter },
      );

      // Send protocol_ack first (with placeholder session_id)
      writeLine({
        type: "protocol_ack",
        version: 1,
        session_id: "pending", // Will be replaced by session_init
        ipc_version: 2,
      });

      // Step R0d cold-boot order. Resume mode emits the synthetic
      // `session_init` via `prepareSession()` so tugcast can promote
      // the supervisor's entry from Spawning to Live and broadcast
      // `spawn_session_ok` immediately; tugdeck constructs services
      // and dispatches `request_replay` (Phase A-R1 / Step R1c). The
      // claude spawn happens in the background — `handleUserMessage`
      // awaits the readiness gate established in `prepareSession()`
      // so any user submit that lands before claude is ready blocks
      // until it is.
      //
      // Step R4 (Phase A-R4): the cold-boot path no longer invokes
      // `runReplay()` directly. Replay is request-driven only — the
      // `request_replay` verb is the single trigger. The supervisor
      // queues the verb during the Spawning window and drains it
      // into tugcode's stdin during the same critical section that
      // promotes Spawning→Live, so replay still arrives at the same
      // wire timing as the pre-collapse startup-replay path.
      //
      // New mode keeps the historical eager path: `initialize()`
      // spawns claude and emits the synthetic init synchronously.
      // There's no JSONL to replay and no user-perceived dead window
      // to fix.
      if (sessionMode === "resume") {
        try {
          sessionManager.prepareSession();
        } catch (err) {
          console.error("Session prepare failed:", err);
          writeLine({
            type: "error",
            message: `Session prepare failed: ${err}`,
            recoverable: false,
            ipc_version: 2,
          });
          process.exit(1);
        }

        // Background claude spawn. The IPC loop continues; the
        // returned Promise is the readiness gate that
        // `handleUserMessage` awaits.
        const claudeReady = sessionManager.spawnClaudeAndWatch();
        // Surface unhandled rejection from the spawn promise to
        // stderr so a synchronous exception inside `spawnClaude`
        // (e.g. a missing claude binary) doesn't go silent. The
        // typical failure surfaces through the early-exit watcher,
        // which writes its own IPC lines and calls process.exit;
        // this catch is for the unexpected synchronous-throw case.
        claudeReady.catch((err) => {
          console.error("Background claude spawn failed:", err);
          writeLine({
            type: "error",
            message: `Background claude spawn failed: ${err}`,
            recoverable: false,
            ipc_version: 2,
          });
          process.exit(1);
        });
      } else {
        // New mode: eager spawn + emit init via the historical
        // single-call entry point. Behavior unchanged from pre-R0d.
        try {
          await sessionManager.initialize();
        } catch (err) {
          console.error("Session initialization failed:", err);
          writeLine({
            type: "error",
            message: `Session initialization failed: ${err}`,
            recoverable: false,
            ipc_version: 2,
          });
          process.exit(1);
        }
      }
    } else if (isUserMessage(msg)) {
      // Stub mode: dispatch the next recorded turn. Out-of-bounds
      // produces an error event from the engine and asks us to
      // shut down.
      if (stubReplay !== null) {
        const ok = stubReplay.dispatchTurn();
        if (!ok) {
          process.exit(1);
        }
        continue;
      }
      if (sessionManager) {
        sessionManager.handleUserMessage(msg).catch((err) => {
          console.error("handleUserMessage failed:", err);
          writeLine({
            type: "error",
            message: `Failed to handle user message: ${err}`,
            recoverable: true,
            ipc_version: 2,
          });
        });
      } else {
        console.error("User message received before session initialized");
      }
    } else if (isToolApproval(msg)) {
      sessionManager?.handleToolApproval(msg);
    } else if (isQuestionAnswer(msg)) {
      sessionManager?.handleQuestionAnswer(msg);
    } else if (isInterrupt(msg)) {
      sessionManager?.handleInterrupt();
    } else if (isPermissionMode(msg)) {
      sessionManager?.handlePermissionMode(msg);
    } else if (isModelChange(msg)) {
      sessionManager?.handleModelChange(msg.model);
    } else if (isEffortChange(msg)) {
      // Reasoning-effort change ([#step-4]). Respawn-with-resume (no live
      // control verb in 2.1.158, [R07]) — fire-and-forget like
      // session_command: awaiting here would block the IPC loop while
      // killAndCleanup drains the old process.
      sessionManager?.handleEffortChange(msg.effort).catch((err) => {
        console.error("Effort change failed:", err);
        writeLine({
          type: "error",
          message: `Effort change failed: ${err}`,
          recoverable: true,
          ipc_version: 2,
        });
      });
    } else if (isStopTask(msg)) {
      sessionManager?.handleStopTask(msg.task_id);
    } else if (isRequestReplay(msg)) {
      // Phase A-R1 / [D12]. Tugdeck dispatched a request_replay
      // CONTROL frame on services construction for a resume binding;
      // tugcast forwarded it here. Fire-and-forget: runReplay's
      // re-entrancy guard drops a request that arrives while another
      // replay is in flight, and the iterator is async — awaiting it
      // here would block the IPC loop from reading subsequent frames
      // (a user_message that lands during replay would queue behind
      // the replay tail).
      if (sessionManager) {
        console.log(`[dev::replay::request] session_id=${sessionId}`);
        sessionManager.runReplay().catch((err) => {
          console.error("request_replay failed:", err);
        });
      } else {
        console.error("request_replay received before session initialized");
      }
    } else if (isRewindPreview(msg)) {
      // `/rewind` diff-stat preview ([#step-7-1]). Synchronous send +
      // correlate (the `control_response` is caught turn-free in
      // `handleClaudeLine`); no IPC-loop-blocking await.
      sessionManager?.handleRewindPreview(msg).catch((err) => {
        console.error("Rewind preview failed:", err);
        writeLine({
          type: "rewind_preview_result",
          promptUuid: msg.promptUuid,
          canRewind: false,
          error: `Rewind preview failed: ${err}`,
          ipc_version: 2,
        });
      });
    } else if (isSessionRewind(msg)) {
      // `/rewind` apply. Code dimension reverts the working tree via
      // `rewind_files` ([#step-7-1]); the conversation dimension truncates
      // the session JSONL + silent-respawns `--resume` ([#step-7-2]). The
      // handler is async (file I/O + respawn) and emits its own
      // `rewind_result`; surface any unexpected throw as a failed ack rather
      // than an unhandled rejection.
      sessionManager?.handleSessionRewind(msg).catch((err) => {
        console.error("Session rewind failed:", err);
        writeLine({
          type: "rewind_result",
          promptUuid: msg.promptUuid,
          scope: msg.scope,
          canRewind: false,
          error: `Session rewind failed: ${err}`,
          ipc_version: 2,
        });
      });
    } else if (isSkillsInventoryQuery(msg)) {
      // `/skills` listing ([#step-12d]). Read the plugin + user skill dirs and
      // answer with a single `skills_inventory` frame correlated by
      // `request_id`. Synchronous, idle-time, best-effort (a missing dir just
      // contributes no entries); tugcast relays the response verbatim on
      // CODE_OUTPUT — no Rust routing, no persistence.
      writeLine(
        buildSkillsInventory({
          sessionId,
          requestId: msg.request_id,
          homeDir: homedir(),
          pluginDir: join(projectDir, "tugplug"),
        }),
      );
    } else if (isSessionCommand(msg)) {
      if (sessionManager) {
        sessionManager.handleSessionCommand(msg.command).catch((err) => {
          console.error("Session command failed:", err);
          writeLine({
            type: "error",
            message: `Session command failed: ${err}`,
            recoverable: true,
            ipc_version: 2,
          });
        });
      }
    }
  }
}

main()
  .then(async () => {
    // stdin closed. Kill the claude subprocess (which would otherwise
    // hold the event loop open on its stdout pipe) and exit.
    console.log("stdin closed, shutting down");
    try {
      await sessionManager?.shutdown();
    } catch (err) {
      console.error("Shutdown error:", err);
    }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Fatal error in main loop:", err);
    try {
      await sessionManager?.shutdown();
    } catch {
      // best-effort
    }
    process.exit(1);
  });
