/**
 * `ToolBlockDisclosure` — the native `<details>` + rotating
 * `ChevronRight` + accent-colored label expand affordance used by
 * tool-block wrappers that want to surface "earlier history" /
 * "hidden args" / "full output" without spending React state.
 *
 * The implementation is deliberately HTML-native: a `<details>`
 * element with a `<summary>` row carrying the chevron icon + label.
 * The chevron rotates 90° via CSS keyed on the `[open]` attribute,
 * so the open/close transition stays presentational ([L06] clean —
 * no `useState`, no `useReducer`, no observer). Browser back / forward,
 * cold-boot reload, and accessibility tree readers all get the
 * standard `<details>` semantics for free.
 *
 * Composition:
 *
 *     <ToolBlockDisclosure summary="show 4 earlier lines">
 *       <pre>{earlierLines}</pre>
 *     </ToolBlockDisclosure>
 *
 * Default-closed. Pass `defaultOpen` to flip the initial state — but
 * note this is an *initial* attribute (an uncontrolled DOM default),
 * not a controlled prop. Once mounted, the user's open/close action
 * lives in the DOM, never in React state.
 *
 * Laws:
 *  - [L06] no React state for appearance — `[open]` lives on the
 *    `<details>` element; CSS rotates the chevron via the attribute
 *    selector.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tool-block-disclosure"`.
 *  - [L20] no `--tugx-toolblock-disclosure-*` tokens — typography
 *    and color use the seven-slot system directly
 *    (`--tug7-element-tone-text-normal-active-rest` for the
 *    interactive accent on the summary label).
 *
 * @module components/tugways/cards/tool-blocks/body-bits/tool-block-disclosure
 */

import "./tool-block-disclosure.css";

import React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ToolBlockDisclosureProps {
  /**
   * The summary text rendered next to the chevron — typically a
   * verb phrase like `"show 4 earlier lines"` or `"show full
   * args"`. A `React.ReactNode` so callers can build richer summary
   * content (e.g. a pluralized count + a code snippet) when needed.
   */
  summary: React.ReactNode;
  /** Disclosure body — what the user reveals on expand. */
  children?: React.ReactNode;
  /**
   * Initial open state for the underlying `<details>` element. Pass
   * `true` to render expanded by default. This is an uncontrolled
   * default, not a controlled prop — once mounted, the open state
   * lives in the DOM.
   * @default false
   */
  defaultOpen?: boolean;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

export const ToolBlockDisclosure: React.FC<ToolBlockDisclosureProps> = ({
  summary,
  children,
  defaultOpen = false,
  className,
}) => (
  <details
    className={cn("tool-block-disclosure", className)}
    data-slot="tool-block-disclosure"
    {...(defaultOpen ? { open: true } : {})}
  >
    <summary
      className="tool-block-disclosure-summary"
      data-slot="tool-block-disclosure-summary"
    >
      <ChevronRight
        size={14}
        className="tool-block-disclosure-chevron"
        aria-hidden="true"
      />
      <span className="tool-block-disclosure-summary-text">{summary}</span>
    </summary>
    <div
      className="tool-block-disclosure-body"
      data-slot="tool-block-disclosure-body"
    >
      {children}
    </div>
  </details>
);
