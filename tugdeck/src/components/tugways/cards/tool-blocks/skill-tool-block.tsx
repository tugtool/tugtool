/**
 * `SkillToolBlock` — Layer-2 wrapper for the `Skill` tool.
 *
 * `Skill` invokes a slash-command-style skill within the assistant's
 * working session. The wire shape is small: `{ skill: string, args?:
 * string }` for the input, and a free-form text result. Volume is low
 * (0.02% per the audit), so the wrapper is intentionally compact —
 * the header carries the load-bearing UX (which skill ran, with which
 * args) and the body is at most one inline `<code>` of args.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a `Sparkles` icon + the tool
 *    name `Skill` + a `/<skill-name>` args summary, the status stripe,
 *    the inline `DevCautionBadge` (when the dispatch flagged drift),
 *    and the error band.
 *  - **Header** — `Skill · /<skill-name>` (the `/` prefix mirrors how
 *    skills are referenced in Claude Code prompts; the `<code>`
 *    container truncates via the chrome's args slot when the name is
 *    long, with a hover tooltip).
 *  - **Body** — three branches:
 *      1. `args === undefined || args === ""` → no body content
 *         (the chrome's footer / error band remains the only
 *         interactive surface; for streaming, `StreamingPlaceholder`).
 *      2. `args.length <= INLINE_ARGS_MAX_CHARS` → a single
 *         `<code>` row showing the args verbatim, prefixed by an
 *         `args:` label so a reader scanning the transcript
 *         immediately knows what they're looking at.
 *      3. otherwise → an embedded `TugMarkdownBlock` rendering the
 *         args as a fenced text block so multi-line args (e.g. a
 *         multi-paragraph instruction) lay out as a proper code
 *         block instead of a one-line truncation.
 *  - **Footer (`result` summary)** — when the result is a short
 *    non-empty string, surface it as a one-line `TugLabel` so the
 *    reader sees the acknowledgement at a glance. Longer results
 *    fall back through `DefaultToolBlock`'s smart-pick — but in
 *    practice `Skill` returns short acknowledgements ("done", "ok",
 *    a small status line), so the one-line label covers the
 *    dominant case.
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → header shows whatever fragment has
 *    arrived (`skill` may be empty); body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band from
 *    `textOutput`; body still renders the args section (the input is
 *    diagnostic context — "this skill was invoked with X and
 *    failed").
 *  - `status === "ready"` → header + args body + optional result
 *    label.
 *
 * Laws:
 *  - [L06] no React state for appearance — every render branch is a
 *    pure derivation from props.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="skill-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the markdown
 *    body's `--tugx-md-*`; introduces only the small
 *    `--tugx-skill-*` slots scoped to this wrapper.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — the wrapper owns chrome; the body is a
 *    minimal composition of existing primitives (`TugLabel`,
 *    `TugMarkdownBlock`, `<code>`).
 *  - [D101] visibility policy — `skill` moves from `default-intent`
 *    to bespoke once this wrapper ships; the policy entry is removed
 *    in the same change.
 *
 * @module components/tugways/cards/tool-blocks/skill-tool-block
 */

import "./skill-tool-block.css";

import React from "react";
import { Sparkles } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugTooltip } from "@/components/tugways/tug-tooltip";

import { ToolBlockBody, ToolBlockFieldRow } from "./body-bits";
import { ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings — `Skill` carries `{ skill, args? }`. The wrapper
// narrows defensively because the structured result is free-form text and
// the only field a `Skill` invocation *requires* is `skill`.
// ---------------------------------------------------------------------------

/** `Skill` tool input (from `tool_use.input`). */
export interface SkillToolInput {
  /** The skill's slash-command name (without the leading `/`). */
  skill?: string;
  /** Optional args passed to the skill (may be multi-line). */
  args?: string;
}

/**
 * Narrow the wrapper-side `unknown` input to `SkillToolInput`.
 * Defensive: returns `{}` for non-object inputs, drops non-string
 * fields silently.
 */
export function narrowSkillInput(value: unknown): SkillToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    skill: typeof v.skill === "string" ? v.skill : undefined,
    args: typeof v.args === "string" ? v.args : undefined,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Args length under which the body shows a single inline `<code>`
 * row; over this, the body switches to a fenced `TugMarkdownBlock`.
 * 80 was picked to match the conventional terminal-width breakpoint
 * — anything shorter typically fits on one line in the transcript.
 */
export const INLINE_ARGS_MAX_CHARS = 80;

/**
 * Max length of a result text the wrapper surfaces as a one-line
 * label. Longer than this and we suppress the result entirely (a
 * future iteration could fall through to `JsonTreeBlock` or
 * `TugMarkdownBlock`, but in practice `Skill` returns short
 * acknowledgements — the one-line label is the right default).
 */
export const ONE_LINE_RESULT_MAX_CHARS = 200;

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the args-summary node for the chrome's header slot. Returns
 * `undefined` when there is no skill name yet (early in streaming).
 *
 * Exported for the gallery card and the tests, which exercise it
 * independently of the React render.
 */
export function composeSkillHeaderArgs(
  skill: string | undefined,
): { label: string } | undefined {
  if (skill === undefined || skill.length === 0) return undefined;
  return { label: `/${skill}` };
}

// ---------------------------------------------------------------------------
// Result presentation
// ---------------------------------------------------------------------------

/**
 * Decide how the chrome's *body* should present the tool result.
 *  - `none`: no result text, or the wrapper deliberately suppresses
 *    it (errored — chrome's error band already has the text;
 *    streaming — placeholder owns the body).
 *  - `label`: short non-empty result; render as a one-line
 *    `TugLabel`.
 *
 * Longer results are not surfaced here — they fall through to
 * `none` and the user can switch to JSON-tree inspection via the
 * default-tool path when really needed. The wrapper's contract is
 * "compact"; multi-line result rendering belongs in a different
 * wrapper if a need ever materialises.
 */
export type SkillResultPresentation =
  | { kind: "none" }
  | { kind: "label"; text: string };

export function pickSkillResultPresentation(
  textOutput: string | undefined,
  status: ToolBlockProps["status"],
): SkillResultPresentation {
  if (status !== "ready") return { kind: "none" };
  if (textOutput === undefined) return { kind: "none" };
  const trimmed = textOutput.trim();
  if (trimmed.length === 0) return { kind: "none" };
  if (trimmed.length > ONE_LINE_RESULT_MAX_CHARS) return { kind: "none" };
  return { kind: "label", text: trimmed };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SkillToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  textOutput,
  status,
  phase,
  caution,
}) => {
  const skillInput = React.useMemo(() => narrowSkillInput(input), [input]);

  const headerArgs = composeSkillHeaderArgs(skillInput.skill);
  const argsSummary = headerArgs !== undefined ? (
    <TugTooltip content={headerArgs.label} side="bottom" truncated>
      <code data-slot="skill-tool-block-name">{headerArgs.label}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="skill-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  const resultPresentation = React.useMemo(
    () => pickSkillResultPresentation(textOutput, status),
    [textOutput, status],
  );

  // Body composition. Streaming gets the shared placeholder; otherwise
  // the body stacks the args section (always shown if args exist) and
  // the result label (only when picked as `label`).
  let body: React.ReactNode;
  if (status === "streaming") {
    body = null;
  } else {
    const hasArgs =
      skillInput.args !== undefined && skillInput.args.length > 0;
    const argsLong =
      hasArgs && (skillInput.args as string).length > INLINE_ARGS_MAX_CHARS;
    const hasResultLabel = resultPresentation.kind === "label";
    if (!hasArgs && !hasResultLabel) {
      body = null;
    } else {
      body = (
        <ToolBlockBody>
          {hasArgs ? (
            <ToolBlockFieldRow
              label="args"
              layout={argsLong ? "stacked" : "inline"}
            >
              {argsLong ? (
                <TugMarkdownBlock
                  initialText={`\`\`\`\n${skillInput.args}\n\`\`\``}
                  className="skill-tool-block-args-markdown"
                />
              ) : (
                <code data-slot="skill-tool-block-args-inline">
                  {skillInput.args}
                </code>
              )}
            </ToolBlockFieldRow>
          ) : null}
          {hasResultLabel ? (
            <ToolBlockFieldRow label="result">
              <TugLabel size="sm">{resultPresentation.text}</TugLabel>
            </ToolBlockFieldRow>
          ) : null}
        </ToolBlockBody>
      );
    }
  }

  // Fold + copy affordances. Default OPEN (the args + result body is
  // the user's direct evidence of "what skill ran with what input")
  // — fold here is an opt-out for a user who wants a quieter
  // transcript, not a hide-by-default. Copy collects the result
  // acknowledgement.
  const hasBody = body !== null;
  const fold = hasBody && status !== "streaming"
    ? {
        defaultFolded: false,
        preservationKey: `skill-tool-block/${toolUseId}/fold`,
        collapsedLabel: "details",
      }
    : undefined;
  const copyText =
    textOutput !== undefined && textOutput.length > 0 ? textOutput : undefined;

  return (
    <ToolBlockChrome
      rootSlot="skill-tool-block"
      toolName={toolName}
      argsSummary={argsSummary}
      status={status}
      phase={phase}
      caution={caution}
      errorMessage={errorMessage}
      fold={fold}
      copyText={copyText}
    >
      {body}
    </ToolBlockChrome>
  );
};
