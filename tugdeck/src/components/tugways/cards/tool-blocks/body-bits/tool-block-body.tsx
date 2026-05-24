/**
 * `ToolBlockBody` — the standard padded vertical-flex container every
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
 *     <ToolBlockBody>
 *       <ToolBlockFieldRow label="args"><code>{value}</code></ToolBlockFieldRow>
 *       <ToolBlockFieldRow label="result">{text}</ToolBlockFieldRow>
 *     </ToolBlockBody>
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tool-block-body"` for debug targeting.
 *  - [L20] owns only the `--tugx-toolblock-body-*` slots (none today;
 *    layout values use the shared `--tug-space-*` family).
 *
 * @module components/tugways/cards/tool-blocks/body-bits/tool-block-body
 */

import "./tool-block-body.css";

import React from "react";

import { cn } from "@/lib/utils";

export interface ToolBlockBodyProps {
  /** Body content — typically a stack of `ToolBlockFieldRow` rows. */
  children?: React.ReactNode;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

export const ToolBlockBody: React.FC<ToolBlockBodyProps> = ({
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
