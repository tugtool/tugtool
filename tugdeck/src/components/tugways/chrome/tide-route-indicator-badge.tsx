/**
 * `TideRouteIndicatorBadge` — the Z4B route-aware indicator badge for
 * the Tide prompt entry's toolbar.
 *
 * Names what the active route targets. One component, two branches
 * (Table T01 reduced to the two live routes after Command's retirement):
 *
 *   route  | indicator content                          | data source
 *   -------|--------------------------------------------|-----------------------------------
 *   ❯ Code | `Claude Code <version>` (drift-aware)      | sessionMetadataStore + drift detectors
 *   $ Shell| `<shell name>`                             | HostFactsStore.shell
 *
 * **Mount identity ([L26], Risk R03).** The badge keeps its mount
 * across a route flip — the returned tree always has the same shape:
 * a single `TugPopover` wrapping a `TugPopoverTrigger` wrapping one
 * `TugBadge`. Only the badge's children, role, icon, and the
 * conditional `TugPopoverContent` swap. React reconciles the
 * `TugBadge` element as the same type at the same position; the
 * `Code`-route drift popover's open/closed state survives a flip-
 * away-and-back through Shell.
 *
 * **Code branch.** Identical to the prior `TideVersionBadge`: shows
 * the running Claude Code stream-json version, escalates to `caution`
 * when the dispatch detected drift ([D04] / [Q03]). A click opens the
 * report popover listing running / validated versions and any drift
 * events. Falls back to the tugbank-persisted last-known version
 * before the live `system_metadata.version` lands, or `?` when none
 * has ever been seen.
 *
 * **Shell branch.** Shows the full `$SHELL` path (`/bin/zsh`,
 * `/usr/local/bin/fish`, …), read from {@link useHostFacts} ([D04]).
 * Falls back to the basename (`shell`) if `shellPath` is empty (an
 * older tugcast that predates the field), then to the `shell`
 * placeholder before host facts resolve at all (the fetch is one-shot
 * at app load, so this is brief). No popover content — clicking does
 * nothing visible.
 *
 * **Width is stable across the route flip.** Both faces are stacked in
 * one CSS-grid cell — the active face paints, the alternate stays
 * `visibility: hidden` but participates in layout — so the cell sizes
 * to `max(activeWidth, alternateWidth)` regardless of which branch is
 * live. Mirrors `TugButton`'s `widthStabilize` pattern. The drift case
 * (Code with `· N events` appended) still widens the badge — drift is
 * a separate state that demands attention, not the route flip.
 *
 * Laws:
 *  - [L02] external state enters through `useSyncExternalStore` — the
 *    `CodeSessionStore` transcript, `SessionMetadataStore` version,
 *    `HostFactsStore` host facts, and `RouteLifecycle` route are all
 *    subscribed, never mirrored into React state.
 *  - [L06] no React state for appearance — the popover's open/closed
 *    state is owned by the uncontrolled `TugPopover` (Radix), and the
 *    quiet/caution treatment is pure render from the derived summary.
 *  - [L11] the badge emits no chain action — it is a popover trigger
 *    only; `TugPopover` owns the disclosure.
 *  - [L19] file pair (`.tsx` + `.css`); the report node carries
 *    `data-slot="tide-route-indicator-badge-report"`.
 *  - [L20] owns only the `--tugx-route-indicator-*` report-geometry
 *    slots; composes `TugBadge` (the chip) and `TideCautionBadge`
 *    (the report rows), each of which keeps its own tokens.
 *  - [L26] one component-type at one React position; no per-route
 *    keying — mount identity is preserved across route flips.
 *
 * @module components/tugways/chrome/tide-route-indicator-badge
 */

import "./tide-route-indicator-badge.css";

import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import {
  VALIDATED_CC_VERSION,
  logDriftEvent,
  summarizeDrift,
  type DriftEvent,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { useHostFacts } from "@/lib/host-facts-store";
import { useRoute } from "@/lib/route-lifecycle";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";

import { TideCautionBadge } from "./tide-caution-badge";

// ── Route values ───────────────────────────────────────────────────────────
//
// Mirror the values in `tug-prompt-entry.tsx`'s `ROUTE_ITEMS`. Kept inline
// (not re-exported from there) so this component depends only on the
// route's *value* — a `string` — not on the prompt-entry's item list.
const ROUTE_SHELL = "$";

// ── Last-known version persistence ─────────────────────────────────────────

/**
 * tugbank slot for the most recent Claude Code version seen in any
 * session. The badge falls back to it before the live session's
 * `system_metadata` lands, so a version number shows immediately.
 */
const CC_VERSION_DOMAIN = "dev.tugtool.tide";
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
    console.warn("[TideRouteIndicatorBadge] persist version failed:", err);
  });
}

export interface TideRouteIndicatorBadgeProps {
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
export function TideRouteIndicatorBadge({
  codeSessionStore,
  sessionMetadataStore,
  className,
}: TideRouteIndicatorBadgeProps): React.ReactElement {
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
    const toolCalls = transcript.flatMap((turn) => turn.toolCalls);
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
      ? "tide-route-indicator-badge"
      : `tide-route-indicator-badge ${className}`;

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

  let codeFace: string;
  if (displayVersion === null) {
    codeFace = "Claude Code ?";
  } else if (!hasDrift) {
    codeFace = `Claude Code ${displayVersion}`;
  } else if (version !== null && version !== VALIDATED_CC_VERSION) {
    codeFace = `Claude Code ${version} · validated ${VALIDATED_CC_VERSION} · ${eventCountLabel(summary.count)}`;
  } else {
    codeFace = `Claude Code ${displayVersion} · ${eventCountLabel(summary.count)}`;
  }

  // Active / alternate split for width stabilization. The active face
  // paints; the alternate participates in layout (`visibility: hidden`)
  // so the grid cell sizes to `max(active, alternate)` width — the
  // route flip never changes the badge's footprint.
  const activeFace = isShell ? shellFace : codeFace;
  const alternateFace = isShell ? codeFace : shellFace;

  // One-shape render: `TugPopover` always wraps the `TugBadge` ([L26],
  // Risk R03) so the badge's mount survives a route flip. The
  // `TugPopoverContent` is the only piece that varies — Shell renders
  // none (nothing to expand to), Code renders the running/validated
  // versions and any drift events.
  return (
    <TugPopover>
      <TugPopoverTrigger>
        <TugBadge
          role={hasDrift ? "caution" : "inherit"}
          emphasis="tinted"
          size="sm"
          icon={hasDrift ? <TriangleAlert aria-hidden="true" /> : undefined}
          className={cls}
          data-route={isShell ? "shell" : "code"}
          data-slot="tide-route-indicator-badge"
        >
          <span
            className="tide-route-indicator-badge-face"
            data-slot="tide-route-indicator-badge-face"
          >
            <span data-tug-stable-label="active">{activeFace}</span>
            <span data-tug-stable-label="alternate" aria-hidden="true">
              {alternateFace}
            </span>
          </span>
        </TugBadge>
      </TugPopoverTrigger>
      {isShell ? null : (
        <TugPopoverContent side="top" align="end" sideOffset={8} arrow>
          <div
            className="tide-route-indicator-badge-report"
            data-slot="tide-route-indicator-badge-report"
          >
            <div className="tide-route-indicator-badge-report-title">
              Claude Code stream-json
            </div>
            <div className="tide-route-indicator-badge-versions">
              <div className="tide-route-indicator-badge-version-row">
                <span className="tide-route-indicator-badge-version-label">
                  running
                </span>
                <span className="tide-route-indicator-badge-version-value">
                  {version ?? "—"}
                </span>
              </div>
              <div className="tide-route-indicator-badge-version-row">
                <span className="tide-route-indicator-badge-version-label">
                  validated
                </span>
                <span className="tide-route-indicator-badge-version-value">
                  {VALIDATED_CC_VERSION}
                </span>
              </div>
            </div>
            {hasDrift && (
              <ul className="tide-route-indicator-badge-report-list">
                {summary.events.map((event) => (
                  <li
                    key={driftEventKey(event)}
                    className="tide-route-indicator-badge-report-row"
                  >
                    <TideCautionBadge caution={event.caution} />
                    <span className="tide-route-indicator-badge-report-detail">
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
