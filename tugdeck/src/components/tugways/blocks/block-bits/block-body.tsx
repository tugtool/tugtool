/**
 * `BlockBody` — the standard padded vertical-flex container every
 * tool-block wrapper's body section uses.
 *
 * Before this primitive, every wrapper (`SkillToolBlock`,
 * `MonitorToolBlock`, `WorktreeToolBlock`, etc.) declared its own
 * `.<wrapper>-body { display: flex; flex-direction: column; gap:
 * var(--tug-space-xs); padding: var(--tug-space-sm); }` rule. Three
 * copies of the same declaration, three places to keep in sync if
 * the body-padding ever needs to change.
 *
 * Wrappers now compose this primitive:
 *
 *     <BlockBody>
 *       <BlockFieldRow label="args"><code>{value}</code></BlockFieldRow>
 *       <BlockFieldRow label="result">{text}</BlockFieldRow>
 *     </BlockBody>
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tool-block-body"` for debug targeting.
 *  - [L20] owns only the `--tugx-block-body-*` slots (none today;
 *    layout values use the shared `--tug-space-*` family).
 *
 * @module components/tugways/blocks/block-bits/block-body
 */

import "./block-body.css";

import React from "react";

import { cn } from "@/lib/utils";

export interface BlockBodyProps {
  /** Body content — typically a stack of `BlockFieldRow` rows. */
  children?: React.ReactNode;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

export const BlockBody: React.FC<BlockBodyProps> = ({
  children,
  className,
}) => (
  <div
    className={cn("tool-block-body", className)}
    data-slot="tool-block-body"
  >
    {children}
  </div>
);
