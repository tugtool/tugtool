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
} from "./types.ts";

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
let projectDir: string | undefined;
const args = Bun.argv.slice(2); // Skip bun and script path
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir" && i + 1 < args.length) {
    projectDir = args[i + 1];
    i++;
  }
}

console.log(`Starting tugtalk (projectDir: ${projectDir || "none"})`);

// Session state (will be used in Step 1)
let sessionId: string | null = null;

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
        });
        process.exit(1);
      }

      // Generate a session ID for the handshake (real session creation in Step 1)
      sessionId = crypto.randomUUID();

      writeLine({
        type: "protocol_ack",
        version: 1,
        session_id: sessionId,
      });
    } else if (isUserMessage(msg)) {
      // TODO: implement in Step 1
      console.log("Received user_message (not yet handled)");
    } else if (isToolApproval(msg)) {
      // TODO: implement in Step 1
      console.log("Received tool_approval (not yet handled)");
    } else if (isQuestionAnswer(msg)) {
      // TODO: implement in Step 1
      console.log("Received question_answer (not yet handled)");
    } else if (isInterrupt(msg)) {
      // TODO: implement in Step 1
      console.log("Received interrupt (not yet handled)");
    } else if (isPermissionMode(msg)) {
      // TODO: implement in Step 1
      console.log(`Received permission_mode: ${msg.mode} (not yet handled)`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error in main loop:", err);
  process.exit(1);
});
