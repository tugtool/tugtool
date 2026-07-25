/**
 * Commit presentation — the shared vocabulary every surface that shows a
 * commit draws from: the History shade's rows, the `/commit` durable receipt
 * in the transcript, and the Changes shade's commit affordances.
 *
 * Three surfaces render the same facts (a sha, a subject, a message body, a
 * committer, a timestamp, a file list) and today each states them its own way.
 * This module holds the parts they can share:
 *
 *  - {@link formatCommitStamp} — one timestamp formatter with three grains
 *    (`time`, `datetime`, `full`), so a commit's clock never reads differently
 *    on two surfaces.
 *  - {@link CommitStamp} — the timestamp as a tabular mono cell.
 *  - {@link CommitIdentityLine} — `<sha> : <subject>` with the mono hanging
 *    indent, the shared line box, and the tighter continuation leading.
 *  - {@link CommitCopyControl} — the standard header Copy affordance
 *    ({@link BlockCopyButton}), matched to the fold cue's scale.
 *  - {@link commitCopyText} — the copy payload: header line, full message,
 *    attribution, and the changed-file roster.
 *
 * The type scale and the layout skeleton live in `commit-presentation.css`
 * under the `.tugx-commit` scope class ([L06] appearance is CSS).
 *
 * @module components/tugways/commit-presentation
 */

import "./commit-presentation.css";

import type React from "react";

import { CommitShaText } from "@/components/tugways/commit-sha-text";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";

/** How much of the clock a stamp states. */
export type CommitStampGrain =
  /** `12:51:25` — the time alone. */
  | "time"
  /** `2026-07-24` — the date alone. */
  | "date"
  /** `2026-07-24 12:51:25` — sortable date + time, the full row stamp. */
  | "datetime"
  /** `Friday, July 24, 2026 at 12:51:25 PM` — the expanded detail's stamp. */
  | "full";

/**
 * Format a strict-ISO commit date at one of three grains. Returns the input
 * verbatim when it doesn't parse (a truncated record still shows something),
 * and the empty string for empty input.
 */
export function formatCommitStamp(iso: string, grain: CommitStampGrain): string {
  if (iso.length === 0) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (grain === "full") {
    return d.toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  if (grain === "time") return time;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return grain === "date" ? date : `${date} ${time}`;
}

/** The timestamp as a tabular mono cell — the trailing column of a commit row. */
export function CommitStamp({
  iso,
  grain,
  className,
}: {
  iso: string;
  grain: CommitStampGrain;
  className?: string;
}): React.ReactElement {
  const text = formatCommitStamp(iso, grain);
  return (
    <span
      className={className !== undefined ? `tugx-commit-stamp ${className}` : "tugx-commit-stamp"}
      data-slot="commit-stamp"
      title={formatCommitStamp(iso, "full")}
    >
      {text}
    </span>
  );
}

/** The metadata a reader can ask a commit row to carry. */
export type CommitMetaField = "author" | "date" | "time";

/**
 * The trailing metadata cell: whichever of author / date / time the reader has
 * turned on. Date + time together read as one stamp (`2026-07-24 12:51:25`),
 * either alone reads as its own grain, and neither leaves the cell empty — the
 * cell still renders so the grid's columns hold their measure across rows.
 */
export function CommitMetaCell({
  author,
  iso,
  fields,
}: {
  author: string;
  iso: string;
  fields: readonly CommitMetaField[];
}): React.ReactElement {
  const wantsDate = fields.includes("date");
  const wantsTime = fields.includes("time");
  const grain: CommitStampGrain | null =
    wantsDate && wantsTime ? "datetime" : wantsDate ? "date" : wantsTime ? "time" : null;
  return (
    <span className="tugx-commit-meta" data-slot="commit-meta">
      {fields.includes("author") ? <span>{author}</span> : null}
      {grain !== null ? <CommitStamp iso={iso} grain={grain} /> : null}
    </span>
  );
}

/**
 * `<sha> <subject>` — the commit's identity line, the two parted by a single
 * space (the sha's own tint is what separates them; a heavier delimiter only
 * spent width). The sha is a
 * {@link CommitShaText} (right-click → copy the full hash); a trailing
 * `badge` slot carries surface-specific marks (the History shade's dash-join
 * badge, say) inside the same text flow so it wraps with the subject.
 */
export function CommitIdentityLine({
  sha,
  subject,
  badge,
  className,
}: {
  sha: string;
  subject: string;
  badge?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={
        className !== undefined ? `tugx-commit-identity ${className}` : "tugx-commit-identity"
      }
      data-slot="commit-identity"
      title={subject}
    >
      <CommitShaText sha={sha} />
      {" "}
      {subject}
      {badge}
    </span>
  );
}

/**
 * The Copy affordance for a commit — the same icon button the tool-block
 * headers carry, at the fold cue's scale so the two read as a matched pair.
 */
export function CommitCopyControl({
  getText,
  subject,
}: {
  getText: () => string;
  /** Names the commit in the a11y label. */
  subject: string;
}): React.ReactElement {
  return (
    <BlockCopyButton
      subtype="icon"
      size="2xs"
      getText={getText}
      aria-label={`Copy commit ${subject}`}
      data-slot="commit-copy"
    />
  );
}

/** The facts a copy payload states — a superset of every surface's record. */
export interface CommitCopyFacts {
  sha: string;
  subject: string;
  /** The message body below the subject; empty for a subject-only commit. */
  body?: string;
  /** Committer (or author) display name. */
  author?: string;
  email?: string;
  /** Strict-ISO commit date. */
  dateIso?: string;
  /** The changed files, when the surface knows them. */
  files?: readonly { path: string; status: string; added: number; removed: number }[];
}

/**
 * The commit as text: the full hash and subject, the message body, the
 * attribution, and the changed-file roster — what the row shows collapsed
 * PLUS everything it reveals expanded, whatever its current fold state. A
 * pasteable record, not a screenshot of the row.
 */
export function commitCopyText(facts: CommitCopyFacts): string {
  const lines: string[] = [`commit ${facts.sha}`];
  if (facts.author !== undefined && facts.author.length > 0) {
    const email = facts.email !== undefined && facts.email.length > 0 ? ` <${facts.email}>` : "";
    lines.push(`Author: ${facts.author}${email}`);
  }
  if (facts.dateIso !== undefined && facts.dateIso.length > 0) {
    lines.push(`Date:   ${formatCommitStamp(facts.dateIso, "full")}`);
  }
  lines.push("", facts.subject);
  const body = facts.body ?? "";
  if (body.length > 0) lines.push("", body.replace(/\s+$/, ""));
  const files = facts.files ?? [];
  if (files.length > 0) {
    lines.push("");
    for (const f of files) {
      lines.push(`  ${f.status.padEnd(9)} ${f.path}  +${f.added} −${f.removed}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
