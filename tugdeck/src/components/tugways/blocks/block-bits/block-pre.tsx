/**
 * `BlockPre` — the standard mono-font, pre-wrap, no-margin `<pre>`
 * for tool-block output blocks.
 *
 * Before this primitive, every wrapper that surfaced a chunk of raw
 * output (`MonitorToolBlock`'s tail and head, the error-output `<pre>`
 * the chrome forwards) declared its own
 *
 *     <pre className="<wrapper>-output">{text}</pre>
 *
 *     .<wrapper>-output {
 *       margin: 0;
 *       font-family: var(--tug-font-family-mono);
 *       font-size: var(--tug-font-size-sm);
 *       white-space: pre-wrap;
 *       word-break: break-word;
 *     }
 *
 * Wrappers now compose this primitive:
 *
 *     <BlockPre>{output}</BlockPre>
 *
 * Use this for *short, non-terminal* output — log tails, watch
 * snapshots, raw text echoes. Full terminal output with collapse
 * thresholds, virtualization, and ANSI-styled spans belongs in the
 * `TerminalBlock` body kind, not here.
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tool-block-pre"`.
 *  - [L20] no `--tugx-block-pre-*` tokens; mono font and size
 *    use the shared `--tug-font-family-mono` / `--tug-font-size-sm`.
 *
 * @module components/tugways/blocks/block-bits/block-pre
 */

import "./block-pre.css";

import React from "react";

import { cn } from "@/lib/utils";

export interface BlockPreProps {
  /** The text content to render in the `<pre>` block. */
  children?: React.ReactNode;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

export const BlockPre: React.FC<BlockPreProps> = ({
  children,
  className,
}) => (
  <pre className={cn("tool-block-pre", className)} data-slot="tool-block-pre">
    {children}
  </pre>
);
