/**
 * `DefaultToolWrapper` — Layer-2 fallback wrapper for `tool_use`
 * events with no bespoke wrapper.
 *
 * Per [D04] / [D11] this is the day-one guarantee: any `tool_use`
 * whose `tool_name` is not in the registry — a genuinely unknown
 * tool, *or* an audit-confirmed long-tail tool that routes here by
 * design — renders through this wrapper rather than blank or raw
 * JSON. The dispatch (`dispatchToolCallState`) routes here and, for a
 * *truly* unknown name, also raises a `caution` flag.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolWrapperChrome` owns the frame: a wrench icon + the tool
 *    name, the status stripe, the inline `TideCautionBadge` (when the
 *    dispatch flagged drift), and the error band.
 *  - Body — two stacked, labelled sections:
 *      1. **input** — a `JsonTreeBlock` over `tool_use.input`,
 *         `defaultDepth={1}` so it opens *collapsed by default*
 *         (root expanded, top-level keys folded) — enough to see the
 *         tool's input shape at a glance without drowning in nesting.
 *      2. **result** — smart-picked from the output ([D11]): an
 *         object / array `structured_result` → `JsonTreeBlock`;
 *         otherwise the plain-text `tool_result.output` →
 *         `TugMarkdownBlock`. `pickOutputBody` is the pure picker.
 *    A `TugSeparator` divides the two.
 *
 * The two `JsonTreeBlock`s render *standalone* (each with its own
 * frame + header), not `embedded`: `embedded` mode portals a body
 * kind's actions cluster into the chrome's single actions slot, and
 * two embedded trees would collide there. Standalone keeps each
 * section self-contained — the right shape for "show me the input
 * and the output of this unknown tool, clearly delineated."
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → `<StreamingPlaceholder />`; the input
 *    is still arriving.
 *  - `status === "error"` → the input section still renders (it is
 *    useful context — "this unknown tool was called with X and
 *    failed"); the chrome paints the error band from `textOutput`;
 *    no result section.
 *  - `status === "ready"` → input + separator + result.
 *
 * Registration: `DefaultToolWrapper` is the dispatch *fallback*, not
 * a registry entry — `resolveToolWrapper` returns it for every miss,
 * and `dispatchToolCallState` returns it (with `caution` for unknown
 * names) directly. No `registerToolWrapper` call.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM attributes;
 *    body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="default-tool-wrapper"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*`, the body kinds'
 *    `--tugx-json-*` / `--tugx-md-*`, and `TideCautionBadge`'s
 *    `--tugx-caut-*`; introduces no new tokens.
 *
 * Decisions:
 *  - [D04] drift fallback is `JsonTreeBlock` + caution badge.
 *  - [D11] `DefaultToolWrapper` covers unknown tools day-one.
 *  - [D05] two-layer hybrid — body kinds own rendering, the wrapper
 *    owns chrome and the input/output composition.
 *
 * @module components/tugways/cards/tool-wrappers/default-tool-wrapper
 */

import "./default-tool-wrapper.css";

import React from "react";
import { Wrench } from "lucide-react";

import { JsonTreeBlock } from "@/components/tugways/body-kinds/json-tree-block";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugSeparator } from "@/components/tugways/tug-separator";

import {
  StreamingPlaceholder,
  ToolWrapperChrome,
} from "./tool-wrapper-chrome";
import type { ToolWrapperProps } from "./types";

// ---------------------------------------------------------------------------
// Output smart-pick — pure helper (exported because tests pin it)
// ---------------------------------------------------------------------------

/**
 * The picked output body. `json` carries an object / array to render
 * via `JsonTreeBlock`; `markdown` carries plain text to render via
 * `TugMarkdownBlock`; `none` means there is no output to show.
 */
export type DefaultOutputBody =
  | { kind: "json"; data: unknown }
  | { kind: "markdown"; text: string }
  | { kind: "none" };

/**
 * Smart-pick the result body from a `tool_use`'s output, per [D11]:
 * an object / array `structured_result` is the richer shape → render
 * it as a JSON tree; otherwise plain-text `tool_result.output` →
 * render it as markdown. A `structured_result` that is a bare
 * primitive (or `null`) is not the "object" branch — it falls
 * through to the text branch, and `none` only when neither output is
 * present.
 */
export function pickOutputBody(
  structuredResult: unknown,
  textOutput: string | undefined,
): DefaultOutputBody {
  if (structuredResult !== null && typeof structuredResult === "object") {
    return { kind: "json", data: structuredResult };
  }
  if (textOutput !== undefined && textOutput.length > 0) {
    return { kind: "markdown", text: textOutput };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DefaultToolWrapper: React.FC<ToolWrapperProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const outputBody = React.useMemo(
    () => pickOutputBody(structuredResult, textOutput),
    [structuredResult, textOutput],
  );

  // Errored tools carry the failure message in `textOutput`; surface
  // it through the chrome's error band rather than the result section.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="default-tool-wrapper-error-output">{textOutput}</span>
    ) : undefined;

  // Body. Streaming → placeholder. Otherwise the input section always
  // renders (it is the context for an unknown tool); the result
  // section is `ready`-only — on error the chrome's error band is the
  // output.
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else {
    const showResult = status === "ready" && outputBody.kind !== "none";
    body = (
      <div
        className="default-tool-wrapper-sections"
        data-slot="default-tool-wrapper-sections"
      >
        <JsonTreeBlock
          data={input}
          label="input"
          defaultDepth={1}
          componentStatePreservationKey={`${toolUseId}-input`}
        />
        {showResult ? (
          <>
            <TugSeparator />
            {outputBody.kind === "json" ? (
              <JsonTreeBlock
                data={outputBody.data}
                label="result"
                componentStatePreservationKey={`${toolUseId}-result`}
              />
            ) : (
              <TugMarkdownBlock
                initialText={outputBody.text}
                className="default-tool-wrapper-result-md"
              />
            )}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <ToolWrapperChrome
      rootSlot="default-tool-wrapper"
      toolName={toolName}
      toolIcon={<Wrench size={14} aria-hidden="true" />}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolWrapperChrome>
  );
};
