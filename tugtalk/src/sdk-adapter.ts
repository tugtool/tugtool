// SDK adapter layer isolating the V2 unstable API
// Package: @anthropic-ai/claude-agent-sdk@0.2.44

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Adapter session interface - stable internal API
 */
export interface AdapterSession {
  sessionId: string;
  send(message: string): Promise<void>;
  stream(): AsyncIterable<unknown>;
  close(): void;
}

/**
 * Session creation options
 */
export interface AdapterSessionOptions {
  model: string;
  cwd?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  canUseTool?: (toolName: string, input: unknown) => Promise<{ behavior: "allow" | "deny"; message?: string }>;
  allowedTools?: string[];
  onStderr?: (data: string) => void;
  pathToClaudeCodeExecutable?: string;
  plugins?: { type: "local"; path: string }[];
}

/**
 * SDK adapter factory.
 * Wraps the V2 unstable API from @anthropic-ai/claude-agent-sdk.
 */
export function createSDKAdapter() {
  return {
    /**
     * Create a new SDK session.
     */
    async createSession(options: AdapterSessionOptions): Promise<AdapterSession> {
      const sdkOptions: any = {
        model: options.model,
        cwd: options.cwd,
        permissionMode: options.permissionMode,
        includePartialMessages: true,
      };

      if (options.pathToClaudeCodeExecutable) {
        sdkOptions.pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable;
      }

      if (options.plugins) {
        sdkOptions.plugins = options.plugins;
      }

      if (options.canUseTool) {
        sdkOptions.canUseTool = options.canUseTool;
      }

      if (options.onStderr) {
        sdkOptions.stderr = options.onStderr;
      }

      const session = unstable_v2_createSession(sdkOptions);

      return {
        get sessionId() {
          try {
            return session.sessionId;
          } catch {
            return "";
          }
        },
        send: session.send.bind(session),
        stream: session.stream.bind(session),
        close: session.close.bind(session),
      };
    },

    /**
     * Resume an existing SDK session.
     */
    async resumeSession(
      sessionId: string,
      options: AdapterSessionOptions
    ): Promise<AdapterSession> {
      const sdkOptions: any = {
        model: options.model,
        cwd: options.cwd,
        permissionMode: options.permissionMode,
        includePartialMessages: true,
      };

      if (options.pathToClaudeCodeExecutable) {
        sdkOptions.pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable;
      }

      if (options.plugins) {
        sdkOptions.plugins = options.plugins;
      }

      if (options.canUseTool) {
        sdkOptions.canUseTool = options.canUseTool;
      }

      if (options.onStderr) {
        sdkOptions.stderr = options.onStderr;
      }

      const session = unstable_v2_resumeSession(sessionId, sdkOptions);

      return {
        sessionId: session.sessionId || sessionId,
        send: session.send.bind(session),
        stream: session.stream.bind(session),
        close: session.close.bind(session),
      };
    },

  };
}
