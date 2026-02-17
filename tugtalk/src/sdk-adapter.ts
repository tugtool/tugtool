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
        env: options.cwd ? { ...process.env, PWD: options.cwd } : undefined,
      };

      // Map canUseTool callback if provided
      if (options.canUseTool) {
        sdkOptions.canUseTool = options.canUseTool;
      }

      // Map onStderr callback if provided
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
        env: options.cwd ? { ...process.env, PWD: options.cwd } : undefined,
      };

      // Map canUseTool callback if provided
      if (options.canUseTool) {
        sdkOptions.canUseTool = options.canUseTool;
      }

      // Map onStderr callback if provided
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

    /**
     * Send a message to the current session.
     * Note: This method is deprecated in favor of using session.send() directly.
     */
    async sendMessage(sessionId: string, message: string): Promise<void> {
      throw new Error("sendMessage is deprecated - use session.send() directly");
    },

    /**
     * Stream responses from the current session.
     * Note: This method is deprecated in favor of using session.stream() directly.
     */
    async *streamResponse(sessionId: string): AsyncGenerator<unknown, void, unknown> {
      throw new Error("streamResponse is deprecated - use session.stream() directly");
    },

    /**
     * Cancel the current turn.
     * Note: This method is deprecated - use AbortController instead.
     */
    async cancelTurn(sessionId: string): Promise<void> {
      throw new Error("cancelTurn is deprecated - use AbortController instead");
    },

    /**
     * Set permission mode for the session.
     * Note: This is handled by the PermissionManager in session.ts.
     */
    async setPermissionMode(
      sessionId: string,
      mode: "default" | "acceptEdits" | "bypassPermissions" | "plan"
    ): Promise<void> {
      throw new Error("setPermissionMode is deprecated - use PermissionManager instead");
    },
  };
}
