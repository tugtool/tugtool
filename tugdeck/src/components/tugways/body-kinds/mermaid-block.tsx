/**
 * `MermaidBlock` — Layer-1 body kind for a Mermaid diagram.
 *
 * Per [D10] Mermaid (not a synchronously-loaded SVG engine) is the
 * renderer; the library loads on first encounter. The component is
 * a thin React surface over the shared `renderMermaidInto` helper
 * that powers the markdown-prose mermaid pipeline ([D07]
 * block-transformer pass + post-`innerHTML` enhance-mermaid pass) —
 * keeping one path through Mermaid so a fenced ` ```mermaid ` block
 * and a `<MermaidBlock>` mount produce visually identical SVG.
 *
 * Conformance ([#bk-conformance]): scope note — this is a
 * display-only inline block (no identity header, no actions row, no
 * fold affordance). Only items 1–2 and 6–7 apply:
 *  - **Item 1** (text engine): N/A — this block has no editor
 *    surface; the diagram source is a prop, never an in-block
 *    text-entry.
 *  - **Item 2** (single text-entry surface): satisfied by construction
 *    — the block carries no input UI of its own.
 *  - **Item 6** (tokens): owns `--tugx-mermaid-*` (declared in the
 *    component CSS body{}); the surface composes `--tugx-block-*`
 *    via the shared `tugx-block.css` family.
 *  - **Item 7** (state preservation): the rendered SVG is a pure
 *    function of `(source, themeName)` — no scroll, no collapse, no
 *    component state to preserve across reload.
 *
 * Error handling ([R04]). Any Mermaid parse / render error is
 * contained to this instance: `renderMermaidInto` restores the raw
 * source to `textContent` and stamps `data-tugx-mermaid-error="true"`
 * so the CSS can paint a caution surface. The parent block continues
 * rendering; the host can hook the `onError` callback for a toast.
 *
 * Theme awareness. Mermaid's built-in `dark` / `default` themes are
 * picked based on the current `--tugx-host-canvas-color` value. A
 * theme switch is one full markdown re-render away — there's no
 * subscription to the theme context here because the diagram DOM
 * lives outside React's render tree after Mermaid writes the SVG.
 *
 * Laws:
 *  - [L06] no React state for visual state — Mermaid's render writes
 *    DOM directly; React owns only the mount/effect plumbing.
 *  - [L19] file pair (`.tsx` + `.css`), module docstring, exported
 *    props interface, `data-slot="mermaid-body"` on the root.
 *  - [L20] component-token sovereignty — owns `--tugx-mermaid-*`;
 *    consumes `--tugx-block-*` for the shared block scaffold.
 *
 * @module components/tugways/body-kinds/mermaid-block
 */

import "./mermaid-block.css";

import React from "react";

import { renderMermaidInto } from "@/lib/markdown/enhance-mermaid";

/**
 * Props for `MermaidBlock`. The source is the full surface; anything
 * the consumer wants to change about the rendered output is a
 * function of that string, plus the optional error hook.
 */
export interface MermaidBlockProps {
  /** Diagram source (Mermaid DSL). Re-renders when this changes. */
  source: string;
  /**
   * Called once per failed render with Mermaid's error message and
   * the source that produced it. The component already paints a
   * caution surface via `data-tugx-mermaid-error`; this callback
   * lets the host surface a toast or telemetry counter on top.
   */
  onError?: (message: string, source: string) => void;
  /**
   * Forwarded class name. Cascade-scoped customization happens here
   * — consumers tune `--tugx-mermaid-*` for their instance via a
   * wrapping selector, not by reaching into the primitive's CSS
   * ([L20]).
   */
  className?: string;
}

export const MermaidBlock: React.FC<MermaidBlockProps> = ({
  source,
  onError,
  className,
}) => {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    void renderMermaidInto(el, source, { onError });
  }, [source, onError]);

  const baseClass = "tugx-mermaid";
  const composed = className === undefined ? baseClass : `${baseClass} ${className}`;

  return (
    <div
      ref={ref}
      data-slot="mermaid-body"
      className={composed}
    />
  );
};
