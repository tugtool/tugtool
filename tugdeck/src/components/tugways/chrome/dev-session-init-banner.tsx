/**
 * `DevSessionInitBanner` — top-of-card chrome that surfaces the
 * session's runtime metadata on first observation and again on any
 * change.
 *
 * Per [D03] (`system_metadata` renders per-turn only when something
 * changed), the dispatch routes every `system_metadata` event through
 * this banner with the *previous* metadata snapshot in its props. The
 * banner uses `hasSessionMetadataChanged` to decide whether to render:
 *
 *   - No previous snapshot → render (first observation; the session-
 *     init reading).
 *   - Previous and current shallow-differ on `model`, `permissionMode`,
 *     `version` OR deep-differ on `tools` / `skills` / `agents` →
 *     render.
 *   - Otherwise → render `null` (the dispatch still routes through,
 *     but the user sees no ink).
 *
 * Display fields (every change-relevant scalar surfaces):
 *  - `model` — the active Claude model id.
 *  - `permissionMode` — `acceptEdits` / `plan` / `default`.
 *  - `cwd` — the current working directory (useful provenance for
 *    multi-project users).
 *  - The drift caution chip if the dispatch raised `version_drift`
 *    (the chip lives in the dispatch's `caution` prop and threads
 *    through here).
 *
 * Composition (Table T03 / [#bk-conformance] item 6):
 *  - **Header chrome** — a single row at the top of the card; pinned
 *    via the standard `--tugx-pin-stack-top` telescoping stack if a
 *    consumer wants it sticky. The banner itself is a flat row; the
 *    enclosing card owns position.
 *  - **No body** — the banner is one-line; if a future redesign wants
 *    expandable "tools loaded" detail, that's an [#bk-conformance]
 *    item 5 fold affordance addition.
 *
 * Laws:
 *  - [L02] no external state subscription — `previousMetadata` rides
 *    on the dispatch props.
 *  - [L06] no React state for appearance.
 *  - [L19] file pair (`.tsx` + `.css`),
 *    `data-slot="dev-session-init-banner"`, this docstring.
 *  - [L20] owns the `--tugx-banner-*` slot family.
 *
 * Decisions:
 *  - [D03] on-change render — `hasSessionMetadataChanged` encodes the
 *    shallow + deep comparison rule.
 *  - [Q03] / [D04] — drift caution surfaces via the threaded
 *    `caution` prop.
 *
 * @module components/tugways/chrome/dev-session-init-banner
 */

import "./dev-session-init-banner.css";

import React from "react";
import { Cpu } from "lucide-react";

import { DevCautionBadge } from "./dev-caution-badge";
import type { CautionFlag } from "@/components/tugways/cards/tool-blocks/types";

// ---------------------------------------------------------------------------
// Wire-shape narrowing
// ---------------------------------------------------------------------------

/**
 * The change-relevant fields of `system_metadata`. Only these drive
 * the diff comparison; ipc-plumbing fields (`session_id`,
 * `tug_session_id`, `ipc_version`) ride the wire but don't change the
 * user-visible reading and are ignored.
 */
export interface SessionMetadata {
  model?: string;
  permissionMode?: string;
  version?: string;
  cwd?: string;
  tools?: readonly string[];
  skills?: readonly string[];
  agents?: readonly string[];
}

function narrowStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
  }
  return out;
}

/**
 * Narrow the wire `unknown` payload to `SessionMetadata`. Defensive:
 * returns `{}` for non-object inputs, drops mistyped fields silently.
 * Exported for tests.
 */
export function narrowSessionMetadata(value: unknown): SessionMetadata {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    model: typeof v.model === "string" ? v.model : undefined,
    permissionMode:
      typeof v.permissionMode === "string" ? v.permissionMode : undefined,
    version: typeof v.version === "string" ? v.version : undefined,
    cwd: typeof v.cwd === "string" ? v.cwd : undefined,
    tools: narrowStringArray(v.tools),
    skills: narrowStringArray(v.skills),
    agents: narrowStringArray(v.agents),
  };
}

// ---------------------------------------------------------------------------
// Diff comparison ([D03])
// ---------------------------------------------------------------------------

/**
 * Shallow string array equality — same length, same contents in
 * the same order. Mutual-exclusive `undefined` cases compare equal.
 */
function arraysEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Per [D03]: shallow on `model` / `permissionMode` / `version`; deep
 * on `tools` / `skills` / `agents`. `cwd` is shallow too — a project
 * change matters for provenance. Returns `true` when the banner
 * should re-render (anything user-visible changed).
 *
 * `previous` being `undefined` always returns `true` (first
 * observation).
 *
 * Exported for tests.
 */
export function hasSessionMetadataChanged(
  current: SessionMetadata,
  previous: SessionMetadata | undefined,
): boolean {
  if (previous === undefined) return true;
  if (current.model !== previous.model) return true;
  if (current.permissionMode !== previous.permissionMode) return true;
  if (current.version !== previous.version) return true;
  if (current.cwd !== previous.cwd) return true;
  if (!arraysEqual(current.tools, previous.tools)) return true;
  if (!arraysEqual(current.skills, previous.skills)) return true;
  if (!arraysEqual(current.agents, previous.agents)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `RenderInput` for the `system_metadata` kind, mirrored here as the
 * props shape so the dispatch can route to the component without an
 * adapter. The discriminant + payload match the dispatch's
 * `RenderInput`.
 */
export interface DevSessionInitBannerInputProps {
  kind: "system_metadata";
  metadata: unknown;
  previousMetadata?: unknown;
}

/**
 * Props the dispatch passes to its kind renderers — `input` (the
 * `RenderInput` itself), `context` (the dispatch context), and the
 * dispatch-threaded `caution`.
 */
export interface DevSessionInitBannerProps {
  input: DevSessionInitBannerInputProps;
  caution?: CautionFlag;
}

export const DevSessionInitBanner: React.FC<DevSessionInitBannerProps> = ({
  input,
  caution,
}) => {
  const current = React.useMemo(
    () => narrowSessionMetadata(input.metadata),
    [input.metadata],
  );
  const previous = React.useMemo(
    () =>
      input.previousMetadata === undefined
        ? undefined
        : narrowSessionMetadata(input.previousMetadata),
    [input.previousMetadata],
  );
  const shouldRender = hasSessionMetadataChanged(current, previous);
  if (!shouldRender) return null;

  return (
    <div
      data-slot="dev-session-init-banner"
      className="dev-session-init-banner"
    >
      <Cpu size={14} aria-hidden="true" className="dev-session-init-banner-icon" />
      {current.model !== undefined ? (
        <span
          className="dev-session-init-banner-field"
          data-slot="dev-session-init-banner-model"
        >
          <span className="dev-session-init-banner-field-label">model</span>
          <code className="dev-session-init-banner-field-value">
            {current.model}
          </code>
        </span>
      ) : null}
      {current.permissionMode !== undefined ? (
        <span
          className="dev-session-init-banner-field"
          data-slot="dev-session-init-banner-permission-mode"
        >
          <span className="dev-session-init-banner-field-label">
            permission
          </span>
          <code className="dev-session-init-banner-field-value">
            {current.permissionMode}
          </code>
        </span>
      ) : null}
      {current.cwd !== undefined ? (
        <span
          className="dev-session-init-banner-field"
          data-slot="dev-session-init-banner-cwd"
        >
          <span className="dev-session-init-banner-field-label">cwd</span>
          <code className="dev-session-init-banner-field-value">
            {current.cwd}
          </code>
        </span>
      ) : null}
      {caution !== undefined ? <DevCautionBadge caution={caution} /> : null}
    </div>
  );
};
