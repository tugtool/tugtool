// Permission mode management for CLI --permission-mode flag

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "delegate";

/**
 * Manages permission mode state.
 * Mode is passed as --permission-mode flag to the claude CLI.
 * Default mode is "acceptEdits" per D07/D08.
 */
export class PermissionManager {
  private currentMode: PermissionMode = "acceptEdits";

  setMode(mode: PermissionMode): void {
    this.currentMode = mode;
  }

  getMode(): PermissionMode {
    return this.currentMode;
  }
}
