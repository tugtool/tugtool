// Permission mode management for CLI --permission-mode flag

// The mode value space is part of the shared wire contract ([#step-13c1]);
// authored once in tugproto and re-exported so this module's consumers keep
// importing `PermissionMode` from here.
import type { PermissionMode } from "@tugproto/inbound";
export type { PermissionMode };

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
