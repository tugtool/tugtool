#!/usr/bin/env bun
// Tugcode: Claude Code bridge — stream-json IPC between Claude Code and tugcast

import { readLine, writeLine } from "./ipc.ts";
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
import { ResumeFailedError, SessionManager } from "./session.ts";

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
  }
}

// If tugcast didn't supply a session id (standalone invocation), mint
// one so SessionManager always has a stable identifier.
if (!sessionId) {
  sessionId = crypto.randomUUID();
}

console.log(
  `Starting tugcode (projectDir: ${projectDir}, sessionId: ${sessionId}, sessionMode: ${sessionMode})`,
);

// Session manager (initialized after protocol handshake)
let sessionManager: SessionManager | null = null;

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

      // Create session manager and initialize claude process
      sessionManager = new SessionManager(projectDir, sessionId, sessionMode);

      // Send protocol_ack first (with placeholder session_id)
      writeLine({
        type: "protocol_ack",
        version: 1,
        session_id: "pending", // Will be replaced by session_init
        ipc_version: 2,
      });

      // Initialize session (blocks loop until ready, emits session_init)
      try {
        await sessionManager.initialize();
      } catch (err) {
        if (err instanceof ResumeFailedError) {
          // attemptResumeSpawn already wrote the `resume_failed` IPC
          // line. tugcode does NOT silently fresh-spawn on resume
          // failure; it exits cleanly so the bridge promotes the EOF
          // to a terminal `ResumeFailed` outcome and the card sees
          // the failure instead of a silent rebrand.
          console.error(
            `Resume failed for ${err.staleSessionId}: ${err.reason}; exiting`,
          );
          process.exit(0);
        }
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
