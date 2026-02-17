#!/usr/bin/env bun
// Tugtalk: Conversation engine IPC process

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
import { SessionManager } from "./session.ts";

// Redirect console.log/warn/error to stderr to keep stdout clean for JSON-lines
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: unknown[]) => {
  originalError("[tugtalk]", ...args);
};
console.warn = (...args: unknown[]) => {
  originalError("[tugtalk WARN]", ...args);
};
console.error = (...args: unknown[]) => {
  originalError("[tugtalk ERROR]", ...args);
};

// Parse CLI arguments
let projectDir: string = process.cwd();
const args = Bun.argv.slice(2); // Skip bun and script path
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir" && i + 1 < args.length) {
    projectDir = args[i + 1];
    i++;
  }
}

console.log(`Starting tugtalk (projectDir: ${projectDir})`);

// Session manager (initialized after protocol handshake)
let sessionManager: SessionManager | null = null;

// Graceful SIGTERM handler: close stdin and kill claude process.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  if (sessionManager) {
    sessionManager.shutdown().catch((err) => {
      console.error("Shutdown error:", err);
    }).finally(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// IPC loop
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
      sessionManager = new SessionManager(projectDir);

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

main().catch((err) => {
  console.error("Fatal error in main loop:", err);
  process.exit(1);
});
