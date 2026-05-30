/**
 * tool-header-meta.tsx — the shared header metadata primitives ([D06]
 * of roadmap/tool-call-header.md).
 *
 * Before the regularization, the trailing count region had five idioms
 * for one concept: `edit` hand-rolled `+N −M` spans, `glob`/`grep`
 * hand-rolled "N files"/"N matches" + a "truncated" span, `read`/
 * `write`/`notebook` used raw `TugBadge`, and `read` also pushed a
 * count into the footer. These three primitives are the single source
 * every block now renders its header counts through ([Q02]: counts live
 * in the header, never the footer):
 *
 *  - {@link ToolHeaderCount} — a localized item/line count ("100 files",
 *    "1 match", "82 lines"). A quiet ghost `TugBadge`.
 *  - {@link ToolHeaderDiffStat} — a `+N −M` change summary. The one
 *    primitive that is NOT a single `TugBadge`: a diff stat is
 *    intrinsically two-toned (add green / remove red), which a single
 *    pill can't express, so it's a bespoke two-span element on the
 *    shared `--tugx-block-tone-{add,remove}` tones — the same look the
 *    `edit` block hand-rolled, now centralized.
 *  - {@link ToolHeaderTruncated} — the capped-result flag ("truncated",
 *    optionally "truncated at N"). A caution-toned `TugBadge`.
 *
 * Laws:
 *  - [L06] display-only; no React state drives appearance.
 *  - [L19] file pair, docstring, exported props, per-primitive `data-slot`.
 *  - [L20] owns the `--tugx-toolheader-diffstat-*` tones; the badge-backed
 *    primitives ride `TugBadge`'s tokens.
 *
 * @module components/tugways/cards/tool-blocks/tool-header-meta
 */

import "./tool-header-meta.css";

import React from "react";

import { TugBadge } from "@/components/tugways/tug-badge";

// ---------------------------------------------------------------------------
// Pure formatter (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Format a localized count label: `formatCount(100, "file")` →
 * `"100 files"`, `formatCount(1, "match", "matches")` → `"1 match"`.
 * Pluralizes by appending `s` to `noun` when `pluralNoun` is omitted;
 * thousands-group via `toLocaleString`. Negative / non-finite counts
 * clamp to `0`.
 */
export function formatCount(
  count: number,
  noun: string,
  pluralNoun?: string,
): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const word = n === 1 ? noun : (pluralNoun ?? `${noun}s`);
  return `${n.toLocaleString()} ${word}`;
}

// ---------------------------------------------------------------------------
// ToolHeaderCount
// ---------------------------------------------------------------------------

export interface ToolHeaderCountProps {
  /** The count value. */
  count: number;
  /** Singular noun ("file", "match", "line"). */
  noun: string;
  /** Explicit plural; defaults to `noun + "s"`. */
  pluralNoun?: string;
  /** Optional leading lucide icon. */
  icon?: React.ReactNode;
  /** Forwarded class name. */
  className?: string;
}

/**
 * A localized item/line count, rendered as a quiet ghost badge so it
 * reads as metadata beside the tool name rather than as an accent.
 */
export const ToolHeaderCount: React.FC<ToolHeaderCountProps> = ({
  count,
  noun,
  pluralNoun,
  icon,
  className,
}) => (
  <TugBadge
    emphasis="ghost"
    role="inherit"
    size="2xs"
    icon={icon}
    data-slot="tool-header-count"
    className={className}
  >
    {formatCount(count, noun, pluralNoun)}
  </TugBadge>
);

// ---------------------------------------------------------------------------
// ToolHeaderTruncated
// ---------------------------------------------------------------------------

export interface ToolHeaderTruncatedProps {
  /** Pre-truncation total, when known ("truncated at 500"). */
  at?: number;
  /** Forwarded class name. */
  className?: string;
}

/**
 * The capped-result flag — the producer returned a truncated list. A
 * caution-toned badge so it reads as "there is more than this."
 */
export const ToolHeaderTruncated: React.FC<ToolHeaderTruncatedProps> = ({
  at,
  className,
}) => (
  <TugBadge
    emphasis="tinted"
    role="caution"
    size="2xs"
    data-slot="tool-header-truncated"
    className={className}
  >
    {at !== undefined ? `truncated at ${at.toLocaleString()}` : "truncated"}
  </TugBadge>
);

// ---------------------------------------------------------------------------
// ToolHeaderDiffStat
// ---------------------------------------------------------------------------

export interface ToolHeaderDiffStatProps {
  /** Lines added. */
  added: number;
  /** Lines removed. */
  removed: number;
  /** Forwarded class name. */
  className?: string;
}

/**
 * A `+N −M` change summary on the shared add/remove tones. Bespoke
 * (not a `TugBadge`) because the two-tone reading needs two colored
 * spans. An `aria-label` carries the spoken form.
 */
export const ToolHeaderDiffStat: React.FC<ToolHeaderDiffStatProps> = ({
  added,
  removed,
  className,
}) => {
  const a = Number.isFinite(added) && added > 0 ? Math.floor(added) : 0;
  const r = Number.isFinite(removed) && removed > 0 ? Math.floor(removed) : 0;
  return (
    <span
      data-slot="tool-header-diffstat"
      className={["tool-header-diffstat", className].filter(Boolean).join(" ")}
      aria-label={`${a} added, ${r} removed`}
    >
      <span className="tool-header-diffstat-add">+{a}</span>
      <span className="tool-header-diffstat-remove">−{r}</span>
    </span>
  );
};
