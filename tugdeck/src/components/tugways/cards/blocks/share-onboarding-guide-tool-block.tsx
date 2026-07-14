/**
 * `ShareOnboardingGuideToolBlock` — Layer-2 wrapper for the
 * `ShareOnboardingGuide` tool.
 *
 * The tool uploads the local `ONBOARDING.md` to the org's shared
 * Claude Code guide store and returns a short share link teammates
 * can open in their own Claude Code. The link IS the entire reason
 * the tool exists — the load-bearing UX is "give me a URL I can
 * paste into Slack." The wrapper therefore extracts the URL from
 * the result text and surfaces it via `TugLink` (theme-token-
 * driven, external-target semantics, trailing `ExternalLink` glyph)
 * so the user can open it in one click. The chrome-level Copy
 * affordance, inherited from `BlockChrome.copyText`, copies the
 * whole result text including the URL.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `BlockChrome` owns the frame: a `BookOpen` icon + the
 *    composed tool-name string (`Share Onboarding Guide · <mode>`),
 *    the status stripe, the inline `DevCautionBadge` (when the
 *    dispatch flagged drift), and the error band.
 *  - **Header** — the mode rides the args slot (`check` / `update`
 *    / `create` / `delete`); the `Share Onboarding Guide ·` prefix
 *    keeps the wide name from collapsing into a generic mode label.
 *  - **Body** — `mode:` + optional `short_code:` field rows + the
 *    extracted URL rendered via `TugLink` (or, when no URL is
 *    recognisable, the raw result via `BlockPre`).
 *  - **Chrome-level fold + copy** — default OPEN (the URL IS the
 *    answer; folded by default would hide it). Copy collects the
 *    entire result text.
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → body is `null` (the header dot is the in-flight signal).
 *  - `status === "error"` → chrome paints the error band; body
 *    still renders the input rows (diagnostic context — "this
 *    create with short_code X failed").
 *  - `status === "ready"` → header + body.
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] `data-slot="share-onboarding-guide-tool-block"`. No
 *    paired `.css` file: composes purely from `body-bits/` and
 *    `TugLink` — every visible rule is owned by a shared primitive.
 *  - [L20] reuses the chrome's `--tugx-block-*` and the
 *    body-bits' shared layout values; introduces no new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid.
 *  - [D101] visibility policy — `shareonboardingguide` moves from
 *    `default-intent` to bespoke once this wrapper ships; the
 *    policy entry is removed in the same change.
 *
 * @module components/tugways/cards/blocks/share-onboarding-guide-tool-block
 */

import React from "react";

import { TugLink } from "@/components/tugways/tug-link";
import { TugTooltip } from "@/components/tugways/tug-tooltip";

import {
  BlockBody,
  BlockFieldRow,
  BlockPre,
} from "../../blocks/block-bits";
import { BlockChrome } from "../../blocks/block-chrome";
import type { ToolBlockProps } from "../../blocks/types";

// ---------------------------------------------------------------------------
// Wire-shape narrowing
// ---------------------------------------------------------------------------

/** `ShareOnboardingGuide` tool input (from `tool_use.input`). */
export interface ShareOnboardingGuideInput {
  /**
   * Operation mode — `check` (default), `update`, `create`, `delete`.
   * Validated against a known set; an unrecognised mode falls through
   * to `undefined` so the wrapper renders neutrally rather than
   * displaying an unfamiliar word as authoritative.
   */
  mode?: "check" | "update" | "create" | "delete";
  /** Short code of a specific guide to target. */
  short_code?: string;
}

const KNOWN_MODES: ReadonlySet<string> = new Set([
  "check",
  "update",
  "create",
  "delete",
]);

/**
 * Narrow the wrapper-side `unknown` input to
 * `ShareOnboardingGuideInput`. Defensive: returns `{}` for
 * non-object inputs, drops mistyped fields silently, drops an
 * unrecognised mode silently (so the header reads neutrally rather
 * than claiming a mode the runtime might not actually support).
 */
export function narrowShareOnboardingGuideInput(
  value: unknown,
): ShareOnboardingGuideInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const rawMode = typeof v.mode === "string" ? v.mode : undefined;
  return {
    mode:
      rawMode !== undefined && KNOWN_MODES.has(rawMode)
        ? (rawMode as ShareOnboardingGuideInput["mode"])
        : undefined,
    short_code:
      typeof v.short_code === "string" && v.short_code.length > 0
        ? v.short_code
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the chrome's `toolName` string — `Share Onboarding Guide`
 * standalone, or `Share Onboarding Guide · <mode>` when a mode is
 * present. The prefix carries the tool identity; the mode is the
 * verb-equivalent.
 */
export function composeShareOnboardingGuideToolName(
  mode: ShareOnboardingGuideInput["mode"],
): string {
  if (mode === undefined) return "Share Onboarding Guide";
  return `Share Onboarding Guide · ${mode}`;
}

// ---------------------------------------------------------------------------
// URL extraction — the result text typically contains a single
// http(s) URL (the share link). We extract the first match and
// render it as a clickable `<a>`; everything before / after the URL
// stays in the body for context.
// ---------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s)]+/;

/**
 * Extract the first http(s) URL from a tool-result string. Returns
 * `null` when the input is absent / empty or contains no URL.
 *
 * Conservative — picks the FIRST match and returns it verbatim. The
 * result text from this tool is typically a single short line
 * containing the URL, so a single-match extraction matches the
 * dominant case without surfacing every coincidental link in a
 * longer message.
 *
 * Exported for tests.
 */
export function extractShareLink(textOutput: string | undefined): string | null {
  if (textOutput === undefined || textOutput.length === 0) return null;
  const match = URL_PATTERN.exec(textOutput);
  return match !== null ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ShareOnboardingGuideToolBlock: React.FC<ToolBlockProps> = ({
  input,
  textOutput,
  status,
  phase,
  caution,
}) => {
  const sharedInput = React.useMemo(
    () => narrowShareOnboardingGuideInput(input),
    [input],
  );
  const composedToolName = composeShareOnboardingGuideToolName(sharedInput.mode);

  // Args slot: surface the short_code when present (the only
  // identifier in the input beyond `mode`, which already rides the
  // tool-name slot).
  const argsSummary = sharedInput.short_code !== undefined ? (
    <TugTooltip content={sharedInput.short_code} side="bottom" truncated>
      <code
        data-slot="share-onboarding-guide-tool-block-short-code"
        className="tool-call-header-clamp"
      >
        {`#${sharedInput.short_code}`}
      </code>
    </TugTooltip>
  ) : undefined;

  const shareLink = React.useMemo(
    () => extractShareLink(textOutput),
    [textOutput],
  );

  let body: React.ReactNode;
  if (status === "streaming") {
    body = null;
  } else {
    body = renderShareBody({ input: sharedInput, textOutput, shareLink });
  }

  // Default-open fold — the share link IS the user's reason for
  // calling the tool. Folded-by-default would hide it.
  const copyText =
    textOutput !== undefined && textOutput.length > 0 ? textOutput : undefined;

  return (
    <BlockChrome
      rootSlot="share-onboarding-guide-tool-block"
      toolName={composedToolName}
      argsSummary={argsSummary}
      status={status}
      phase={phase}
      caution={caution}
      notice={
        status === "error" && textOutput !== undefined && textOutput.length > 0
          ? { tone: "error", text: textOutput }
          : undefined
      }
      copyText={copyText}
    >
      {body}
    </BlockChrome>
  );
};

interface RenderBodyArgs {
  input: ShareOnboardingGuideInput;
  textOutput: string | undefined;
  shareLink: string | null;
}

function renderShareBody({
  input,
  textOutput,
  shareLink,
}: RenderBodyArgs): React.ReactNode {
  const hasMode = input.mode !== undefined;
  const hasShortCode = input.short_code !== undefined;
  const hasResult = textOutput !== undefined && textOutput.length > 0;
  if (!hasMode && !hasShortCode && !hasResult) return null;
  return (
    <BlockBody>
      {hasMode ? (
        <BlockFieldRow label="mode">
          <code>{input.mode}</code>
        </BlockFieldRow>
      ) : null}
      {hasShortCode ? (
        <BlockFieldRow label="short_code">
          <code>{input.short_code}</code>
        </BlockFieldRow>
      ) : null}
      {shareLink !== null ? (
        <BlockFieldRow label="link">
          <TugLink
            href={shareLink}
            external
            data-slot="share-onboarding-guide-tool-block-link"
          >
            <code>{shareLink}</code>
          </TugLink>
        </BlockFieldRow>
      ) : hasResult ? (
        <BlockFieldRow label="result" layout="stacked">
          <BlockPre>{textOutput}</BlockPre>
        </BlockFieldRow>
      ) : null}
    </BlockBody>
  );
}
