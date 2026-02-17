// Permission mode management and canUseTool callback implementation

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface PermissionResult {
  behavior: "allow" | "deny";
  message?: string;
}

export type CanUseToolCallback = (toolName: string, input: unknown) => Promise<PermissionResult>;

/**
 * Manages permission mode state and provides canUseTool callback factory.
 * Default mode is "acceptEdits" per D08.
 */
export class PermissionManager {
  private currentMode: PermissionMode = "acceptEdits";

  setMode(mode: PermissionMode): void {
    this.currentMode = mode;
  }

  getMode(): PermissionMode {
    return this.currentMode;
  }

  /**
   * Create a canUseTool callback that implements permission logic.
   * The callback is injected with IPC communication functions for approval requests.
   */
  createCanUseToolCallback(
    emitApprovalRequest: (toolName: string, input: unknown) => string,
    waitForApproval: (requestId: string) => Promise<"allow" | "deny">
  ): CanUseToolCallback {
    return async (toolName: string, input: unknown): Promise<PermissionResult> => {
      const mode = this.currentMode;

      // bypassPermissions: auto-allow everything
      if (mode === "bypassPermissions") {
        return { behavior: "allow" };
      }

      // plan: deny all tool execution
      if (mode === "plan") {
        return {
          behavior: "deny",
          message: "Plan mode: tool execution disabled",
        };
      }

      // acceptEdits: auto-allow safe tools, prompt for dangerous ones
      if (mode === "acceptEdits") {
        const safeTools = ["Read", "Edit", "Write", "Glob", "Grep"];
        if (safeTools.includes(toolName)) {
          return { behavior: "allow" };
        }
        // Bash and other tools require approval
      }

      // default mode or acceptEdits for non-safe tools: prompt via IPC
      const requestId = emitApprovalRequest(toolName, input);
      const decision = await waitForApproval(requestId);

      return {
        behavior: decision,
        message: decision === "deny" ? "User denied tool execution" : undefined,
      };
    };
  }
}
