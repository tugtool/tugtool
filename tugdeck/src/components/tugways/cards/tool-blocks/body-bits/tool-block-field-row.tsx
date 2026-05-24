/**
 * `ToolBlockFieldRow` — a `<label>: <value>` row inside a tool-block
 * body. The shared shape three wrappers were already hand-rolling
 * three slightly-different times before this primitive landed.
 *
 * Two layouts:
 *  - `inline` (default) — label and value share one baseline-aligned
 *    line. Reads as a single `key: value` field; the dominant case
 *    for short string values (`until: ready`, `path: /wt/x`).
 *  - `stacked` — label on its own line above the value. Used only
 *    when the value is a block element that can't share a row
 *    (e.g. an embedded `TugMarkdownBlock` fenced code block).
 *
 * Composition:
 *
 *     <ToolBlockFieldRow label="until">
 *       <code>{untilExpression}</code>
 *     </ToolBlockFieldRow>
 *
 *     <ToolBlockFieldRow label="args" layout="stacked">
 *       <TugMarkdownBlock initialText={fencedArgs} />
 *     </ToolBlockFieldRow>
 *
 * Typography choices, pinned here so every wrapper inherits them:
 *  - Label is a `TugLabel size="sm" color="muted"` — same font scale
 *    as the value so it doesn't shrink into illegibility (a previous
 *    iteration used `2xs` and that was a UX regression). Muted
 *    color provides the visual subordination.
 *  - The colon is part of the label content (`"args:"`) rather than
 *    a pseudo-element so it copies cleanly when a user selects the
 *    field text.
 *  - Children carry their own typography — `<code>` values stay
 *    mono-via-cascade, `TugLabel` values stay sans-via-cascade.
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tool-block-field-row"` + a `data-layout` attribute
 *    for CSS-side branching.
 *  - [L20] owns only `--tugx-toolblock-field-row-*` slots (none
 *    today; layout values use the shared `--tug-space-*` family;
 *    the label's color rides `TugLabel`'s tokens).
 *
 * @module components/tugways/cards/tool-blocks/body-bits/tool-block-field-row
 */

import "./tool-block-field-row.css";

import React from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { cn } from "@/lib/utils";

/** Row layout — inline (default, single line) or stacked (label above value). */
export type ToolBlockFieldRowLayout = "inline" | "stacked";

export interface ToolBlockFieldRowProps {
  /**
   * The field label text. Rendered as `<TugLabel sm muted>label:</TugLabel>`
   * — the colon is appended here so callers pass the bare word.
   */
  label: string;
  /**
   * The field value — typically a `<code>` for short strings, a
   * `<TugLabel>` for short prose, or a block primitive
   * (`TugMarkdownBlock`, `<pre>`, etc.) when `layout="stacked"`.
   */
  children: React.ReactNode;
  /**
   * Row layout. `"inline"` (default) puts label + value on one
   * baseline-aligned line. `"stacked"` puts the label on its own
   * line above the value — use when the value is a block element
   * that can't share a row.
   * @default "inline"
   */
  layout?: ToolBlockFieldRowLayout;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

export const ToolBlockFieldRow: React.FC<ToolBlockFieldRowProps> = ({
  label,
  children,
  layout = "inline",
  className,
}) => (
  <div
    className={cn("tool-block-field-row", className)}
    data-slot="tool-block-field-row"
    data-layout={layout}
  >
    <TugLabel
      size="sm"
      color="muted"
      className="tool-block-field-row-key"
    >
      {`${label}:`}
    </TugLabel>
    <div
      className="tool-block-field-row-value"
      data-slot="tool-block-field-row-value"
    >
      {children}
    </div>
  </div>
);
