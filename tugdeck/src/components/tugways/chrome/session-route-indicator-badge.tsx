/**
 * `SessionRouteIndicatorBadge` — the Z4B route-aware indicator badge for
 * the Dev prompt entry's toolbar.
 *
 * Names what the active route targets. One component, two branches
 * (Table T01 reduced to the two live routes after Command's retirement):
 *
 *   route  | indicator content                          | data source
 *   -------|--------------------------------------------|-----------------------------------
 *   ❯ Code | `Claude Code <version>` (drift-aware)      | sessionMetadataStore + drift detectors
 *   $ Shell| `<shell name>`                             | HostFactsStore.shell
 *
 * Rendered as a two-line `TugPushButton` (`layout="label-top"`): an
 * uppercase caption over the value — `CLAUDE CODE` / version on the
 * Code route, `SHELL` / shell-path on the Shell route — matching the
 * other Z4B chrome chips.
 *
 * **Mount identity ([L26], Risk R03).** The badge keeps its mount
 * across a route flip — the returned tree always has the same shape:
 * a single `TugPopover` wrapping a `TugPopoverAnchor` wrapping one
 * `TugPushButton`. Only the button's `label`, children, icon, click
 * behavior, and the conditional `TugPopoverContent` swap. React
 * reconciles the `TugPushButton` element as the same type at the same
 * position; the `Code`-route drift report's open/closed state survives
 * a flip-away-and-back through Shell.
 *
 * **Code branch ([D13] interactive Z4B chip).** Caption `Claude Code`,
 * value the running stream-json version (with `· N events` appended on
 * drift, flagged with a `TriangleAlert` icon and a `data-drift` hook
 * when the dispatch detected drift, [D04] / [Q03]). A **left click**
 * opens Anthropic's Claude Code changelog in the system browser; a
 * **right click** opens the report popover listing running / validated
 * versions and any drift events. Falls back to the tugbank-persisted
 * last-known version before the live `system_metadata.version` lands,
 * or `?` when none has ever been seen.
 *
 * **Shell branch.** Caption `Shell`, value the full `$SHELL` path
 * (`/bin/zsh`, `/usr/local/bin/fish`, …), read from {@link useHostFacts}
 * ([D04]). Falls back to the basename (`shell`) if `shellPath` is empty
 * (an older tugcast that predates the field), then to the `shell`
 * placeholder before host facts resolve at all (the fetch is one-shot
 * at app load, so this is brief). No report; clicking is a placeholder
 * no-op today — someday it opens the shell in the user's terminal app.
 *
 * **Width stabilization.** The chip pins its footprint across the
 * route flip so its neighbors (Project / Session / … chips) never
 * shift when the user toggles Code ↔ Shell. Both lines wrap a
 * `TugStableOverlay`: the caption overlays `Claude Code` / `Shell` and
 * the value overlays version / shell-path, each cell reserving the
 * wider of its two faces ([R01]). A face that grows past the reserved
 * width (the Code route's `· N events` drift annotation) still fits —
 * the active face is a real layout item, so the box grows to it rather
 * than clipping.
 *
 * Laws:
 *  - [L02] external state enters through `useSyncExternalStore` — the
 *    `CodeSessionStore` transcript, `SessionMetadataStore` version,
 *    `HostFactsStore` host facts, and `RouteLifecycle` route are all
 *    subscribed, never mirrored into React state.
 *  - [L06] no React state for appearance — the report popover's
 *    open/closed state is owned by `TugPopover` and driven imperatively
 *    (`handle.open()` on right-click); the drift treatment is pure
 *    render from the derived summary.
 *  - [L11] the chip emits no chain action — its left click opens an
 *    external URL and its right click opens the report popover via the
 *    imperative handle; `TugPopover` owns the disclosure.
 *  - [L19] file pair (`.tsx` + `.css`); the report node carries
 *    `data-slot="session-route-indicator-badge-report"`.
 *  - [L20] owns only the `--tugx-route-indicator-*` report-geometry
 *    slots; composes `TugPushButton` (the chip) and `SessionCautionBadge`
 *    (the report rows), each of which keeps its own tokens.
 *  - [L26] one component-type at one React position; no per-route
 *    keying — mount identity is preserved across route flips.
 *
 * @module components/tugways/chrome/session-route-indicator-badge
 */

import "./session-route-indicator-badge.css";

import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import {
  TugPopover,
  TugPopoverAnchor,
  TugPopoverContent,
  type TugPopoverHandle,
} from "@/components/tugways/tug-popover";
import { openUrlInOS } from "@/lib/os-open";
import {
  VALIDATED_CC_VERSION,
  logDriftEvent,
  summarizeDrift,
  type DriftEvent,
} from "@/components/tugways/cards/session-assistant-renderer-dispatch";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { useHostFacts } from "@/lib/host-facts-store";
import { useRoute } from "@/lib/route-lifecycle";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";

import { SessionCautionBadge } from "./session-caution-badge";

// ── Route values ───────────────────────────────────────────────────────────
//
// Mirror the values in `tug-prompt-entry.tsx`'s `ROUTE_ITEMS`. Kept inline
// (not re-exported from there) so this component depends only on the
// route's *value* — a `string` — not on the prompt-entry's item list.
const ROUTE_SHELL = "$";

// ── External links ─────────────────────────────────────────────────────────

/**
 * Anthropic's Claude Code changelog. Clicking the Code-route chip opens this
 * in the system browser ([D13] interactive Z4B chip). The version/drift report
 * moves to the chip's right-click menu.
 */
const CLAUDE_CODE_CHANGELOG_URL =
  "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";

// ── Last-known version persistence ─────────────────────────────────────────

/**
 * tugbank slot for the most recent Claude Code version seen in any
 * session. The badge falls back to it before the live session's
 * `system_metadata` lands, so a version number shows immediately.
 */
const CC_VERSION_DOMAIN = "dev.tugtool.dev";
const CC_VERSION_KEY = "ccVersion";

/** Read the persisted last-known version from its tugbank tagged value. */
function parseLastKnownVersion(entry: TaggedValue | undefined): string | null {
  return entry?.kind === "string" && typeof entry.value === "string"
    ? entry.value
    : null;
}

/** Persist `version` as the last-known Claude Code version (fire-and-forget). */
function persistLastKnownVersion(version: string): void {
  fetch(`/api/defaults/${CC_VERSION_DOMAIN}/${CC_VERSION_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: version }),
  }).catch((err) => {
    console.warn("[SessionRouteIndicatorBadge] persist version failed:", err);
  });
}

export interface SessionRouteIndicatorBadgeProps {
  /**
   * Session store — its committed transcript is walked for tool-call
   * drift (unknown tool names, unknown structured-result shapes). Read
   * only on the `Code` branch.
   */
  codeSessionStore: CodeSessionStore;
  /**
   * Session-metadata store — supplies `system_metadata.version`, both
   * for display and for the version-drift check. Omitted in gallery /
   * fixture mounts, where the badge has no version to show. Read only
   * on the `Code` branch.
   */
  sessionMetadataStore?: SessionMetadataStore;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
  /** Author the chip into a focus group ([P02]) — forwarded to the composed
   *  {@link TugPushButton}. The session card passes its cycle group so the chip
   *  becomes a keyboard-focus-cycling stop; omitted elsewhere. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

/** Stable list key for a drift event row. */
function driftEventKey(event: DriftEvent): string {
  return `${event.caution.reason}:${event.toolUseId ?? "version"}`;
}

/** `1 event` / `N events`. */
function eventCountLabel(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

/**
 * The route-aware indicator badge. See the module docstring for the
 * route→content table, mount-identity contract, and per-branch
 * behavior.
 */
export function SessionRouteIndicatorBadge({
  codeSessionStore,
  sessionMetadataStore,
  className,
  focusGroup,
  focusOrder,
}: SessionRouteIndicatorBadgeProps): React.ReactElement {
  // Route from the per-prompt-entry `RouteLifecycle`. `null` outside a
  // provider; treated the same as the `Code` default below.
  const route = useRoute();
  const isShell = route === ROUTE_SHELL;

  // Host facts — read once on app load; null while unresolved. Only
  // the shell branch reads it for display, but the subscription is
  // unconditional so mount identity is route-independent ([L26]).
  const hostFacts = useHostFacts();

  // Narrowed to `transcript` — the only snapshot field the drift walk
  // reads. The committed transcript array's reference changes once per
  // turn commit, so the badge does not re-render on every streaming
  // delta the way a whole-snapshot subscription would.
  const transcript = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().transcript,
      [codeSessionStore],
    ),
  );
  const version = useSyncExternalStore(
    useCallback(
      (listener) =>
        sessionMetadataStore !== undefined
          ? sessionMetadataStore.subscribe(listener)
          : () => {},
      [sessionMetadataStore],
    ),
    useCallback(
      () => sessionMetadataStore?.getSnapshot().version ?? null,
      [sessionMetadataStore],
    ),
  );

  // Last version seen in any prior session — the fallback the badge
  // shows before the live `system_metadata` version lands. [L02].
  const lastKnownVersion = useTugbankValue<string | null>(
    CC_VERSION_DOMAIN,
    CC_VERSION_KEY,
    parseLastKnownVersion,
    null,
  );

  const summary = useMemo(() => {
    const toolCalls = transcript.flatMap((turn) =>
      turn.messages.filter(
        (m): m is import("@/lib/code-session-store").ToolUseMessage =>
          m.kind === "tool_use",
      ),
    );
    return summarizeDrift({ toolCalls, version });
  }, [transcript, version]);

  // Triage logging. `logDriftEvent` dedupes by occurrence, so this
  // effect re-running on unrelated renders never spams the console.
  useEffect(() => {
    for (const event of summary.events) logDriftEvent(event);
  }, [summary]);

  // Persist each live version as it arrives so the next session has a
  // fallback. Skipped when it already matches what's stored.
  useEffect(() => {
    if (version !== null && version !== lastKnownVersion) {
      persistLastKnownVersion(version);
    }
  }, [version, lastKnownVersion]);

  // The version shown on the badge face: the live version when the
  // session has reported one, else the last-known version.
  const displayVersion = version ?? lastKnownVersion;

  const hasDrift = !isShell && summary.count > 0;
  const cls =
    className === undefined
      ? "session-route-indicator-badge"
      : `session-route-indicator-badge ${className}`;

  // Per-branch faces. The Shell face is the full `$SHELL` path, with
  // graceful fall-back to the basename (older tugcast) or a `shell`
  // placeholder (host facts not yet resolved). The Code face is the
  // running Claude Code version with optional drift annotation.
  const shellFace =
    hostFacts?.shellPath !== undefined && hostFacts.shellPath.length > 0
      ? hostFacts.shellPath
      : hostFacts?.shell !== undefined && hostFacts.shell.length > 0
        ? hostFacts.shell
        : "shell";

  // Content line for the Code route: the running version, with the
  // drift event count appended when drift is present (the running /
  // validated split and the full event list live in the click-expand
  // report). `?` until any version has been seen.
  let codeContent: string;
  if (displayVersion === null) {
    codeContent = "?";
  } else if (!hasDrift) {
    codeContent = displayVersion;
  } else {
    codeContent = `${version ?? displayVersion} · ${eventCountLabel(summary.count)}`;
  }

  // Two-line faces: an uppercase caption (CSS-transformed) over the
  // value. Caption and value both swap with the route. The *inactive*
  // face is overlaid (hidden) in the same cell via `TugStableOverlay` so
  // the chip reserves the wider of the two and a route flip never
  // reflows its neighbors ([R01]).
  const caption = isShell ? "Shell" : "Claude Code";
  const content = isShell ? shellFace : codeContent;
  const inactiveCaption = isShell ? "Claude Code" : "Shell";
  const inactiveContent = isShell ? codeContent : shellFace;

  // Imperative handle for the report popover — opened on right-click of
  // the Code-route chip ([D13]). Left click is reassigned to the
  // changelog, so the disclosure is driven imperatively rather than by a
  // `TugPopoverTrigger`'s click-toggle.
  const popoverRef = React.useRef<TugPopoverHandle>(null);

  // Click: Code opens Anthropic's changelog in the system browser; Shell
  // is a placeholder no-op today (someday it opens the shell in the
  // user's terminal app).
  const handleClick = isShell
    ? undefined
    : () => openUrlInOS(CLAUDE_CODE_CHANGELOG_URL);

  // Right-click: Code opens the version / drift report popover; Shell has
  // no report, so its native context menu is left alone.
  const handleContextMenu = isShell
    ? undefined
    : (e: React.MouseEvent) => {
        e.preventDefault();
        popoverRef.current?.open();
      };

  // Tooltip carries the route's face plus the affordance hint; on the
  // Code route it surfaces the drift count so the signal survives even
  // without opening the report.
  const title = isShell
    ? `${content} — opens in your terminal (coming soon)`
    : hasDrift
      ? `Claude Code ${version ?? displayVersion ?? "?"} · ${eventCountLabel(summary.count)} drift — click for changelog, right-click for report`
      : `Claude Code ${displayVersion ?? "?"} — click for changelog, right-click for report`;

  // One-shape render: `TugPopover` always wraps the `TugPushButton`
  // anchor ([L26], Risk R03) so the chip's mount survives a route flip.
  // The `TugPopoverContent` is the only piece that varies — Shell renders
  // none (nothing to expand to), Code renders the running/validated
  // versions and any drift events.
  return (
    <TugPopover ref={popoverRef}>
      <TugPopoverAnchor>
        <TugPushButton
          layout="label-top"
          label={
            <TugStableOverlay
              active={caption}
              alternates={[inactiveCaption]}
            />
          }
          emphasis="tinted"
          role="action"
          size="sm"
          icon={hasDrift ? <TriangleAlert aria-hidden="true" /> : undefined}
          className={cls}
          data-route={isShell ? "shell" : "code"}
          data-drift={hasDrift ? "" : undefined}
          data-slot="session-route-indicator-badge"
          focusGroup={focusGroup}
          focusOrder={focusOrder}
          aria-label={isShell ? "Shell" : "Claude Code — open changelog"}
          title={title}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        >
          <TugStableOverlay
            active={content}
            alternates={[inactiveContent]}
          />
        </TugPushButton>
      </TugPopoverAnchor>
      {isShell ? null : (
        <TugPopoverContent side="top" align="end" sideOffset={8} arrow spaceDismisses>
          <div
            className="session-route-indicator-badge-report"
            data-slot="session-route-indicator-badge-report"
          >
            <div className="session-route-indicator-badge-report-title">
              Claude Code stream-json
            </div>
            <div className="session-route-indicator-badge-versions">
              <div className="session-route-indicator-badge-version-row">
                <span className="session-route-indicator-badge-version-label">
                  running
                </span>
                <span className="session-route-indicator-badge-version-value">
                  {version ?? "—"}
                </span>
              </div>
              <div className="session-route-indicator-badge-version-row">
                <span className="session-route-indicator-badge-version-label">
                  validated
                </span>
                <span className="session-route-indicator-badge-version-value">
                  {VALIDATED_CC_VERSION}
                </span>
              </div>
            </div>
            {hasDrift && (
              <ul className="session-route-indicator-badge-report-list">
                {summary.events.map((event) => (
                  <li
                    key={driftEventKey(event)}
                    className="session-route-indicator-badge-report-row"
                  >
                    <SessionCautionBadge caution={event.caution} />
                    <span className="session-route-indicator-badge-report-detail">
                      {event.caution.detail ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TugPopoverContent>
      )}
    </TugPopover>
  );
}
