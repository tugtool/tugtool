/**
 * Pure view-derivation for a shell exchange row ([P06], Spec S04). Maps a
 * `ShellExchangeMessage` to the `TerminalBlock` data + the header/footer
 * labels the `ShellExchangeBlock` paints. Kept pure so it is unit-tested
 * without a render (the rendered DOM is covered by the app-test).
 */

import type { ShellExchangeMessage } from "@/lib/code-session-store/types";
import type { TerminalData } from "../body-kinds/terminal-block";

export interface ShellExchangeView {
  command: string;
  /**
   * Output-only `TerminalData` for the settled block — no `exitCode` /
   * `durationMs` / `interrupted`, so the embedded `TerminalBlock` draws no
   * in-block footer. The exit + duration are the Z1B's job (the end-state
   * row below the block), matching the assistant turn's grammar.
   */
  terminal: TerminalData;
  /** True until the exchange settles (`settledAtMs === null`). */
  inFlight: boolean;
  /** `exit 0` / `exit 1` / `killed`; `null` while in flight. */
  exitLabel: string | null;
  /** `12ms` / `1.2s`; `null` while in flight. */
  durationLabel: string | null;
  /** `true` for a settled non-zero exit or a kill — drives the danger tone. */
  failed: boolean;
}

export function formatShellDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

/**
 * Character cap on the output portion of a shared exchange ([P08]).
 * Sharing routes the text into the prompt editor — a Claude turn's
 * input — so an oversized capture is truncated with a marker; the
 * full output stays available in the transcript row.
 */
export const SHELL_SHARE_OUTPUT_CAP = 8_000;

/** Truncation marker appended when a shared output exceeds the cap. */
export const SHELL_SHARE_TRUNCATION_MARKER = "…truncated";

/**
 * Compose the share text for an exchange ([P08]): one fenced block
 * carrying the `$`-prefixed command, the (possibly truncated) output,
 * and the exit line. The fence is lengthened past any backtick run in
 * the content so output containing ``` never breaks the block. Ends
 * with a newline so the user can continue typing after the block.
 */
export function composeShellShareText(
  msg: ShellExchangeMessage,
  outputCap: number = SHELL_SHARE_OUTPUT_CAP,
): string {
  const lines: string[] = [`$ ${msg.command}`];
  let output = msg.output.replace(/\n$/, "");
  if (output.length > outputCap) {
    const slice = output.slice(0, outputCap);
    const lastNewline = slice.lastIndexOf("\n");
    output = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
    output += `\n${SHELL_SHARE_TRUNCATION_MARKER}`;
  }
  if (output.length > 0) lines.push(output);
  const settled = msg.settledAtMs !== null;
  if (settled) {
    lines.push(msg.exitCode === null ? "[killed]" : `[exit ${msg.exitCode}]`);
  }
  const body = lines.join("\n");
  // A fence must be longer than any backtick run inside the block.
  const longestRun = body.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${body}\n${fence}\n`;
}

export function deriveShellExchangeView(
  msg: ShellExchangeMessage,
): ShellExchangeView {
  const inFlight = msg.settledAtMs === null;
  const durationMs = inFlight
    ? undefined
    : Math.max(0, (msg.settledAtMs ?? msg.startedAtMs) - msg.startedAtMs);
  // A killed / timed-out exchange settles with a null exit code.
  const killed = !inFlight && msg.exitCode === null;
  return {
    command: msg.command,
    // Output only — the exit code and duration render in the Z1B end-state
    // row, not inside the terminal block (parity with the assistant turn).
    terminal: {
      stdout: msg.output,
      stderr: "",
    },
    inFlight,
    exitLabel: inFlight ? null : killed ? "killed" : `exit ${msg.exitCode}`,
    durationLabel: durationMs === undefined ? null : formatShellDuration(durationMs),
    failed: !inFlight && msg.exitCode !== 0,
  };
}
