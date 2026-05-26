/**
 * gallery-tool-block-default.tsx — visual fixture for
 * `DefaultToolBlock`.
 *
 * `DefaultToolBlock` ([tool-blocks/default-tool-block.tsx]) is
 * the [D04] / [D11] day-one guarantee: any `tool_use` with no bespoke
 * wrapper — a genuinely unknown tool, or an audit-confirmed long-tail
 * tool — renders through it rather than blank or raw JSON. The chrome
 * is a wrench icon + tool name; the body is a `JsonTreeBlock` over the
 * input plus a smart-picked result section.
 *
 * This card mounts the wrapper with module-scope mock `ToolBlockProps`
 * across the states the dispatch can hand it:
 *
 *  1. **Unknown + JSON result** — a truly unknown tool: the dispatch
 *     attaches an `unknown_tool` caution (the chrome paints the inline
 *     `TideCautionBadge`), the input renders depth-1, and an object
 *     `structured_result` smart-picks to a second `JsonTreeBlock`.
 *  2. **Unknown + text result** — same caution, but a plain-text
 *     `tool_result.output` smart-picks to `TugMarkdownBlock` instead.
 *  3. **Audit-confirmed, no caution** — a long-tail tool that routes
 *     here *by design* (`AUDIT_CONFIRMED_DEFAULT_TOOLS`): no caution
 *     badge, just the clean input/result composition.
 *  4. **Streaming** — `status: "streaming"`; the input is still
 *     arriving, so the body is the streaming placeholder.
 *  5. **Error** — `status: "error"`; the input section still renders
 *     (context for the failed call), the chrome paints the error band
 *     from `textOutput`, and there is no result section.
 *  6. **No output** — `status: "ready"` with neither a structured nor
 *     a text result: input section only, no separator, no result.
 *
 * The `caution` prop is hand-constructed here to mirror what
 * `dispatchToolCallState` would attach — the gallery renders the
 * wrapper directly rather than routing through the dispatch.
 *
 * Laws: [L19] gallery-card authoring (module docstring, exported
 *       component, registered). The wrapper owns all painted surfaces.
 *
 * @module components/tugways/cards/gallery-tool-block-default
 */

import "./gallery-tool-block-default.css";

import React from "react";

import { DefaultToolBlock } from "./tool-blocks/default-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNKNOWN_JSON: ToolBlockProps = {
  toolUseId: "gallery-default-unknown-json",
  toolName: "WeatherLookup",
  seq: 0,
  input: { city: "Kyoto", units: "metric", includeForecast: true },
  structuredResult: {
    location: { city: "Kyoto", country: "JP" },
    current: { tempC: 18, condition: "light rain", humidity: 0.82 },
    forecast: [
      { day: "Thu", highC: 21, lowC: 14 },
      { day: "Fri", highC: 24, lowC: 15 },
    ],
  },
  status: "ready",
  caution: { reason: "unknown_tool", detail: "WeatherLookup" },
};

const UNKNOWN_TEXT: ToolBlockProps = {
  toolUseId: "gallery-default-unknown-text",
  toolName: "FormatProse",
  seq: 1,
  input: { style: "concise", text: "the quick brown fox" },
  textOutput:
    "Reformatted **3 sentences**. The output keeps the original meaning while\ntightening clause structure — see the `style: concise` setting.",
  status: "ready",
  caution: { reason: "unknown_tool", detail: "FormatProse" },
};

const AUDIT_CONFIRMED: ToolBlockProps = {
  toolUseId: "gallery-default-audit-confirmed",
  toolName: "TaskUpdate",
  seq: 2,
  input: { taskId: "7", status: "completed" },
  structuredResult: { taskId: "7", status: "completed", updatedAt: "2026-05-14T00:00:00Z" },
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "gallery-default-streaming",
  toolName: "SlowImport",
  seq: 3,
  input: {},
  status: "streaming",
  caution: { reason: "unknown_tool", detail: "SlowImport" },
};

const ERRORED: ToolBlockProps = {
  toolUseId: "gallery-default-error",
  toolName: "DeployService",
  seq: 4,
  input: { service: "tugcast", environment: "staging" },
  textOutput: "Deploy rejected: environment 'staging' is locked for the release freeze.",
  isError: true,
  status: "error",
  caution: { reason: "unknown_tool", detail: "DeployService" },
};

const NO_OUTPUT: ToolBlockProps = {
  toolUseId: "gallery-default-no-output",
  toolName: "TouchFile",
  seq: 5,
  input: { path: "/tmp/marker" },
  status: "ready",
  caution: { reason: "unknown_tool", detail: "TouchFile" },
};

// ---------------------------------------------------------------------------
// GalleryToolBlockDefault
// ---------------------------------------------------------------------------

interface VariantProps {
  title: string;
  props: ToolBlockProps;
  last?: boolean;
}

function Variant({ title, props, last }: VariantProps): React.ReactElement {
  return (
    <>
      <div className="cg-section gallery-tool-block-default-variant">
        <TugLabel className="cg-section-title">{title}</TugLabel>
        <DefaultToolBlock {...props} />
      </div>
      {last ? null : <TugSeparator />}
    </>
  );
}

export function GalleryToolBlockDefault(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-tool-block-default">
      <Variant
        title="Unknown tool — caution badge + object result (JSON / JSON)"
        props={UNKNOWN_JSON}
      />
      <Variant
        title="Unknown tool — caution badge + text result (JSON / Markdown)"
        props={UNKNOWN_TEXT}
      />
      <Variant
        title="Audit-confirmed long-tail tool — routes here by design, no caution"
        props={AUDIT_CONFIRMED}
      />
      <Variant title="Streaming — input still arriving" props={STREAMING} />
      <Variant
        title="Error — input as context, chrome error band, no result section"
        props={ERRORED}
      />
      <Variant
        title="No output — input section only, no separator"
        props={NO_OUTPUT}
        last
      />
    </div>
  );
}
