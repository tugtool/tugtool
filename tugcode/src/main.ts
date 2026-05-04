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
  isSessionCommand,
  isStopTask,
} from "./types.ts";
import { SessionManager } from "./session.ts";
import { loadTranscript, StubReplayEngine } from "./stub-replay.ts";

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
let sessionId: string | undefined;
// `--session-mode new|resume` picks between a fresh spawn (claude
// claims `sessionId` as its own id) and resuming an existing
// conversation. Absent / unknown values fall through to "new".
let sessionMode: "new" | "resume" = "new";
// `--resume-session <id>` is [P14]'s persisted claude session id —
// the canonical key for the on-disk JSONL at
// `~/.claude/projects/<encoded-dir>/<id>.jsonl`. When tugcast has a
// persisted record for this card with `claude_session_id != null`,
// it passes the id through this flag so resume mode forwards
// `--resume <id>` to claude using the *claude* id rather than the
// tug session id (which only matches when no fork has occurred).
//
// Absent in two cases:
//   - Fresh spawns (`--session-mode new`): no resume id needed.
//   - Resume spawns whose claude id was never captured (a previous
//     session crashed pre-`session_init`, or a pre-P14 tugbank
//     record). In both cases `SessionManager` falls back to using
//     `sessionId` for the claude `--resume <id>` flag — the legacy
//     path that works for un-forked sessions.
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

// If tugcast didn't supply a session id (standalone invocation), mint
// one so SessionManager always has a stable identifier.
if (!sessionId) {
  sessionId = crypto.randomUUID();
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
        sessionId: sessionId ?? crypto.randomUUID(),
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
        writeLine({
          type: "error",
          message: `Unsupported protocol version: ${msg.version}`,
          recoverable: false,
          ipc_version: 2,
        });
        process.exit(1);
      }

      // Stub mode: synthesize the handshake from the replay engine
      // and skip claude-spawn entirely.
      if (stubReplay !== null) {
        stubReplay.synthesizeHandshake(msg.version);
        continue;
      }

      // Create session manager and initialize claude process
      sessionManager = new SessionManager(
        projectDir,
        sessionId,
        sessionMode,
        resumeSessionId,
      );

      // Send protocol_ack first (with placeholder session_id)
      writeLine({
        type: "protocol_ack",
        version: 1,
        session_id: "pending", // Will be replaced by session_init
        ipc_version: 2,
      });

      // Initialize session. Synchronous in both modes: spawns claude,
      // installs the early-exit watcher, and emits the synthetic
      // session_init IPC line. Any subsequent claude startup failure
      // surfaces via the watcher's IPC emit + process.exit, not via a
      // throw here.
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
    } else if (isStopTask(msg)) {
      sessionManager?.handleStopTask(msg.task_id);
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
