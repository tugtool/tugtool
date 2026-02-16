// SDK adapter layer isolating the V2 unstable API
// Package: @anthropic-ai/claude-agent-sdk@0.2.42

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
  canUseTool?: (toolName: string) => boolean;
  allowedTools?: string[];
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
      // TODO: implement in Step 1 using unstable_v2_createSession
      throw new Error("createSession not yet implemented");
    },

    /**
     * Resume an existing SDK session.
     */
    async resumeSession(
      sessionId: string,
      options: AdapterSessionOptions
    ): Promise<AdapterSession> {
      // TODO: implement in Step 1 using unstable_v2_resumeSession
      throw new Error("resumeSession not yet implemented");
    },

    /**
     * Send a message to the current session.
     */
    async sendMessage(sessionId: string, message: string): Promise<void> {
      // TODO: implement in Step 1
      throw new Error("sendMessage not yet implemented");
    },

    /**
     * Stream responses from the current session.
     */
    async *streamResponse(sessionId: string): AsyncGenerator<unknown, void, unknown> {
      // TODO: implement in Step 1
      throw new Error("streamResponse not yet implemented");
    },

    /**
     * Cancel the current turn.
     */
    async cancelTurn(sessionId: string): Promise<void> {
      // TODO: implement in Step 1
      throw new Error("cancelTurn not yet implemented");
    },

    /**
     * Set permission mode for the session.
     */
    async setPermissionMode(
      sessionId: string,
      mode: "default" | "acceptEdits" | "bypassPermissions" | "plan"
    ): Promise<void> {
      // TODO: implement in Step 1
      throw new Error("setPermissionMode not yet implemented");
    },
  };
}
