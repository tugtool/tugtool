// Permission mode management for CLI --permission-mode flag

// The mode value space is part of the shared wire contract ([#step-13c1]);
// authored once in tugproto and re-exported so this module's consumers keep
// importing `PermissionMode` from here.
import type { PermissionMode } from "@tugproto/inbound";
export type { PermissionMode };

/** Every permission mode claude accepts, for validating untrusted strings. */
const ALL_PERMISSION_MODES: ReadonlySet<string> = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "auto",
  "dontAsk",
  "delegate",
]);

/**
 * Whether `value` is a permission mode claude accepts. Used to narrow the
 * untrusted `--permission-mode` CLI argument before it seeds a session: an
 * unknown string (future / corrupt client) is rejected rather than forwarded
 * to claude as a bogus `--permission-mode`.
 */
export function isPermissionMode(value: string): value is PermissionMode {
  return ALL_PERMISSION_MODES.has(value);
}

/**
 * Manages permission mode state.
 * Mode is passed as --permission-mode flag to the claude CLI.
 *
 * The default is `"default"` — the same baseline tugdeck's chip falls back to
 * (`resolvePermissionMode` in tugdeck's `permission-mode.ts`). Keeping the two
 * sides on one baseline means a session that never receives a seed (no
 * per-card mode, no configured deck default) shows and behaves identically on
 * both ends, rather than the chip reading "Default" while claude silently ran
 * in some other mode.
 *
 * An explicit initial mode (tugdeck's resolved per-card / deck default,
 * forwarded as `--permission-mode` at spawn) overrides the baseline so the
 * spawned claude starts in the right mode from its first instant — no
 * post-spawn `permission_mode` frame racing the first turn.
 */
export class PermissionManager {
  private currentMode: PermissionMode;

  constructor(initialMode: PermissionMode = "default") {
    this.currentMode = initialMode;
  }

  setMode(mode: PermissionMode): void {
    this.currentMode = mode;
  }

  getMode(): PermissionMode {
    return this.currentMode;
  }
}
