/**
 * landing-receipt — pure formatting for landing receipts ([P09], Spec S04).
 *
 * A successful landing (commit, join, release) appends a non-context row to
 * the transcript — the session's own record of the act, never sent to
 * Claude. This module renders the receipt payloads into the `{command,
 * output}` ink the shell-exchange row mechanism displays, plus the
 * `Tug-Dash:` trailer parser the History join badge reads.
 *
 * @module lib/landing-receipt
 */

/** One receipt row's ink: the verb line and the receipt body. */
export interface ReceiptInk {
  command: string;
  output: string;
}

/** Aggregate counts parsed from a `git show --numstat --format=` receipt. */
export interface NumstatAggregate {
  files: number;
  insertions: number;
  deletions: number;
}

/**
 * Parse the numstat receipt (`<added>\t<deleted>\t<path>` per line; binary
 * files report `-`). Malformed lines are skipped.
 */
export function parseNumstatReceipt(receipt: string): NumstatAggregate {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of receipt.split("\n")) {
    const fields = line.split("\t");
    if (fields.length < 3 || fields[2].trim().length === 0) continue;
    files += 1;
    const added = Number.parseInt(fields[0], 10);
    const deleted = Number.parseInt(fields[1], 10);
    if (Number.isFinite(added)) insertions += added;
    if (Number.isFinite(deleted)) deletions += deleted;
  }
  return { files, insertions, deletions };
}

const plural = (n: number): string => (n === 1 ? "" : "s");

/** The commit receipt: verb, short sha, subject, and the numstat counts. */
export function formatCommitReceiptInk(args: {
  sha: string;
  message: string;
  numstatReceipt: string;
}): ReceiptInk {
  const subject = args.message.split("\n", 1)[0].trim();
  const { files, insertions, deletions } = parseNumstatReceipt(
    args.numstatReceipt,
  );
  return {
    command: "/commit",
    output:
      `committed ${args.sha.slice(0, 9)} — ${subject}\n` +
      `${files} file${plural(files)} +${insertions} −${deletions}`,
  };
}

/** The join receipt: verb, short sha, and the dash provenance. */
export function formatJoinReceiptInk(args: {
  commitHash: string | null;
  dashName: string;
  rounds: number;
}): ReceiptInk {
  const sha = args.commitHash !== null ? ` ${args.commitHash.slice(0, 9)}` : "";
  return {
    command: `/join ${args.dashName}`,
    output:
      `joined${sha} — from dash ${args.dashName} · ` +
      `${args.rounds} round${plural(args.rounds)}`,
  };
}

/** The release receipt ([P14]): no sha — names what was discarded. */
export function formatReleaseReceiptInk(args: {
  dashName: string;
  rounds: number;
  dirty: boolean;
}): ReceiptInk {
  const lost: string[] = [];
  if (args.rounds > 0) lost.push(`${args.rounds} round${plural(args.rounds)}`);
  if (args.dirty) lost.push("a dirty worktree");
  return {
    command: `release ${args.dashName}`,
    output:
      lost.length > 0
        ? `released dash ${args.dashName} · discarded ${lost.join(", ")}`
        : `released dash ${args.dashName} · clean release`,
  };
}

/**
 * The dash short name from a `Tug-Dash:` trailer value
 * (`tugdash/<name> onto <base>`, or a bare branch ref from older commits).
 * Null when the value doesn't carry a dash ref — the badge does not render.
 */
export function dashNameFromTrailer(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const ref = value.trim().split(/\s+/, 1)[0] ?? "";
  if (!ref.startsWith("tugdash/")) return null;
  const name = ref.slice("tugdash/".length);
  return name.length > 0 ? name : null;
}
