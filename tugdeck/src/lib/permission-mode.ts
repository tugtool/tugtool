/**
 * permission-mode.ts — pure helpers for the dev-card permission-mode chip
 * and its `Shift+Tab` cycle.
 *
 * No React, no DOM, no I/O — every export here is a pure function or a
 * constant, so the cycle and label logic is unit-testable without a store
 * or a rendered component. The chip ([permission-mode-chip.tsx]) and the
 * cycle hook ([use-permission-mode.ts]) consume these; tugbank persistence
 * and IPC live in the hook, not here.
 *
 * The cycle matches the Claude Code terminal's `Shift+Tab` exactly per the
 * dev-card / Claude-Code-parity plan: `default → acceptEdits → plan → auto`,
 * wrapping back to `default`. `bypassPermissions`, `dontAsk`, and `delegate`
 * are real modes claude reports but are deliberately NOT in the cycle — they
 * are reached only via `/permissions`, matching the terminal.
 */

import type { TaggedValue } from "@/lib/tugbank-client";
import type { PermissionMode } from "@tugproto/inbound";

/**
 * The four modes the `Shift+Tab` cycle steps through, in order. Index `i`
 * advances to `i + 1` (mod length), so `auto` wraps back to `default`.
 */
export const PERMISSION_MODE_CYCLE = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
] as const satisfies readonly PermissionMode[];

/** A mode that participates in the `Shift+Tab` cycle. */
export type CyclePermissionMode = (typeof PERMISSION_MODE_CYCLE)[number];

/**
 * Modes offered in the chip's behavior sheet. The four cycle modes plus
 * `bypassPermissions` — the dangerous mode [Q07]/[D02] keep out of the
 * `Shift+Tab` cycle but reachable through the sheet (the sheet is the graphical
 * surface for modes the cycle skips).
 */
export const PERMISSION_MODE_MENU = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
] as const satisfies readonly PermissionMode[];

/**
 * Human-readable labels for the chip's content line. Covers the four cycle
 * modes plus the three out-of-cycle modes claude can still report (so a
 * session restored into `bypassPermissions` reads sensibly even though the
 * cycle never lands there).
 */
export const PERMISSION_MODE_LABELS: Record<string, string> = {
  default: "Default",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  auto: "Auto",
  bypassPermissions: "Bypass",
  dontAsk: "Don't Ask",
  delegate: "Delegate",
};

/**
 * The chip's content-line text for a given mode. `null` (no mode known yet)
 * renders the transient ellipsis; an unknown mode string falls back to the
 * raw value so a future claude mode is legible rather than blank.
 */
export function formatPermissionMode(mode: string | null): string {
  if (mode === null) return "…";
  return PERMISSION_MODE_LABELS[mode] ?? mode;
}

/**
 * The next mode for a `Shift+Tab` press.
 *
 * - A mode in the cycle advances to the next, wrapping `auto → default`.
 * - Any mode NOT in the cycle — `null` (unknown), or an out-of-cycle mode
 *   like `bypassPermissions` — resets to `default`, the safe baseline. A
 *   second press then continues `default → acceptEdits → …`. This means
 *   `Shift+Tab` always pulls an off-cycle session back onto the cycle
 *   rather than silently no-op'ing.
 */
export function cyclePermissionMode(current: string | null): CyclePermissionMode {
  const idx = PERMISSION_MODE_CYCLE.indexOf(current as CyclePermissionMode);
  if (idx === -1) return "default";
  return PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
}

/** Every mode claude accepts, for validating untrusted (persisted) strings. */
const ALL_PERMISSION_MODES: ReadonlySet<string> = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "auto",
  "dontAsk",
  "delegate",
]);

/** Whether `value` is a permission mode claude accepts. */
export function isPermissionMode(value: string): value is PermissionMode {
  return ALL_PERMISSION_MODES.has(value);
}

/**
 * Parse the per-card persisted mode out of its tugbank tagged value, narrowed
 * to a known {@link PermissionMode} (or `null`). The persisted string is
 * untrusted — a value from a future / corrupt build that isn't a real mode
 * yields `null` (no restore) rather than being pushed to claude as a bogus
 * mode. The chip's *display* stays string-tolerant ({@link formatPermissionMode});
 * only the send path is strict.
 */
export function parsePersistedPermissionMode(
  entry: TaggedValue | undefined,
): PermissionMode | null {
  if (entry?.kind === "string" && typeof entry.value === "string" && isPermissionMode(entry.value)) {
    return entry.value;
  }
  return null;
}

/** tugbank domain for per-card permission-mode persistence per [D07]. */
export const PERMISSION_MODE_DOMAIN = "dev.permission-mode";
