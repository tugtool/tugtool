/**
 * `AiChip` — the Z4B composite AI chip.
 *
 * One chip where four stood: `CLAUDE CODE`, `MODE`, `AI MODEL`, and `EFFORT`
 * were four faces of one question — how the AI runs — and four chips plus three
 * pickers is chrome, not information. This is a two-line `TugPushButton`
 * carrying an `AI` caption over `Fable 5 · High · Auto` (model · effort · mode),
 * and pressing it opens the one mixer sheet ([ai-config-sheet.tsx]).
 *
 * **Nothing is lost in the merge.** Each value resolves through the same single
 * helper its old chip used — `resolveModelLabel`, `resolveEffortDisplay`,
 * `resolvePermissionMode` — so the composite reads byte-identically to the four
 * faces it replaces, with the effort token OMITTED (not dashed) when the model
 * supports none. The Claude Code chip was never a picker: its drift tick and
 * right-click report survive here as chip adornments, and its version line and
 * changelog door move to the sheet's footer.
 *
 * **Right-click is the report's.** Today's badge binds `onContextMenu` to the
 * drift report while the three value chips bind it to a copy menu — different
 * chips, no conflict. Merging them creates one, and the report wins it: the
 * report is the ONLY door to the drift detail, whereas the summary string is
 * readable on the chip's face. The copy affordance survives as a row inside the
 * report, so nothing is taken away — which is why this chip does not use
 * `useCopyableButton`.
 *
 * Laws: [L02] every value enters through `useSyncExternalStore` on the metadata
 *       and session stores — the transcript subscription stays narrowed to
 *       `transcript` so the chip does not re-render per streaming delta;
 *       [L06] the report popover's disclosure is `TugPopover`'s, opened
 *       imperatively; [L19]/[L20] composes `TugPushButton`, `TugPopover`,
 *       `TugStableOverlay`, `TugCopyBadge`, and `SessionCautionBadge`, each
 *       keeping its own tokens.
 *
 * @module components/tugways/cards/ai-chip
 */

import "./ai-chip.css";

import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugActionTooltip } from "@/components/tugways/tug-action-tooltip";
import { TugCopyBadge } from "@/components/tugways/tug-copy-badge";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import {
  TugPopover,
  TugPopoverAnchor,
  TugPopoverContent,
  type TugPopoverHandle,
} from "@/components/tugways/tug-popover";
import {
  VALIDATED_CC_VERSION,
  logDriftEvent,
  summarizeDrift,
  type DriftEvent,
} from "@/components/tugways/cards/session-assistant-renderer-dispatch";
import { SessionCautionBadge } from "@/components/tugways/chrome/session-caution-badge";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { ReadableMetadataStore } from "@/lib/session-metadata-store";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { readModelCatalog } from "@/lib/model-catalog";
import {
  knownModelRows,
  modelRowTitle,
  resolveModelLabel,
} from "@/lib/model-label";
import {
  EFFORT_LEVELS,
  formatEffortLabel,
  resolveEffortDisplay,
} from "@/lib/effort";
import {
  PERMISSION_MODE_DOMAIN,
  PERMISSION_MODE_MENU,
  formatPermissionMode,
  parsePersistedPermissionMode,
  resolvePermissionMode,
} from "@/lib/permission-mode";
import { formatAiConfigSummary } from "@/lib/ai-config";

// ---------------------------------------------------------------------------
// Claude Code version — persistence shared with the sheet footer
// ---------------------------------------------------------------------------

/** Anthropic's Claude Code changelog — the sheet footer's link target. */
export const CLAUDE_CODE_CHANGELOG_URL =
  "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";

/**
 * tugbank slot for the most recent Claude Code version seen in any session.
 * The chip's report and the sheet's footer both fall back to it before the
 * live session's `system_metadata` lands, so a version number shows at once.
 */
export const CC_VERSION_DOMAIN = "dev.tugtool.dev";
export const CC_VERSION_KEY = "ccVersion";

/** Read the persisted last-known version from its tugbank tagged value. */
export function parseLastKnownVersion(
  entry: import("@/lib/tugbank-client").TaggedValue | undefined,
): string | null {
  return entry?.kind === "string" && typeof entry.value === "string"
    ? entry.value
    : null;
}

/** Persist `version` as the last-known Claude Code version (fire-and-forget). */
export function persistLastKnownVersion(version: string): void {
  fetch(`/api/defaults/${CC_VERSION_DOMAIN}/${CC_VERSION_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: version }),
  }).catch((err) => {
    console.warn("[AiChip] persist version failed:", err);
  });
}

// ---------------------------------------------------------------------------
// AiChip
// ---------------------------------------------------------------------------

export interface AiChipProps {
  /**
   * The card whose persisted permission mode pre-populates the mode token
   * before the live `system_metadata` round-trips ([D07]). **Omit for the
   * defaults context** (Settings → Assistant): with no card behind the chip
   * there is no per-card value, so the store's mode — the deck default —
   * stands alone.
   */
  cardId?: string;
  /** Metadata store supplying model, effort, permission mode, and version. */
  sessionMetadataStore: ReadableMetadataStore;
  /**
   * Session store whose committed transcript is walked for tool-call drift.
   * Omitted in the defaults context, where there is no session to drift.
   */
  codeSessionStore?: CodeSessionStore;
  /** Open the shared mixer sheet — the same opener `/ai` routes to. */
  onOpenSheet: () => void;
  /** Dim + disable the chip (e.g. on the Shell route). */
  disabled?: boolean;
  /** Author the chip into a focus group ([P02]). */
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

/** The widest composition the chip can ever show, for width stabilization. */
function widestSummary(modelTitles: string[]): string {
  const widestModel = modelTitles.reduce(
    (widest, title) => (title.length > widest.length ? title : widest),
    "",
  );
  const widestEffort = EFFORT_LEVELS.map((l) => formatEffortLabel(l)).reduce(
    (widest, label) => (label.length > widest.length ? label : widest),
    "",
  );
  const widestMode = PERMISSION_MODE_MENU.map((m) => formatPermissionMode(m)).reduce(
    (widest, label) => (label.length > widest.length ? label : widest),
    "",
  );
  return formatAiConfigSummary({
    modelLabel: widestModel.length > 0 ? widestModel : null,
    effortLabel: widestEffort,
    modeLabel: widestMode,
  });
}

/**
 * The composite Z4B chip. See the module docstring for what it absorbed and
 * why right-click resolves to the drift report.
 */
export function AiChip({
  cardId,
  sessionMetadataStore,
  codeSessionStore,
  onOpenSheet,
  disabled,
  focusGroup,
  focusOrder,
}: AiChipProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  // Per-card persisted mode — the pre-population fallback before the live
  // round-trip ([D07]). In the defaults context the read misses and the
  // fallback is forced null, so the store's mode wins.
  const persistedMode = useTugbankValue<string | null>(
    PERMISSION_MODE_DOMAIN,
    cardId ?? "",
    parsePersistedPermissionMode,
    null,
  );

  // Narrowed to `transcript` — the only field the drift walk reads. The
  // committed transcript's reference changes once per turn commit, so the chip
  // does not re-render on every streaming delta.
  const transcript = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        codeSessionStore !== undefined
          ? codeSessionStore.subscribe(listener)
          : () => {},
      [codeSessionStore],
    ),
    useCallback(
      () => codeSessionStore?.getSnapshot().transcript ?? null,
      [codeSessionStore],
    ),
  );

  const lastKnownVersion = useTugbankValue<string | null>(
    CC_VERSION_DOMAIN,
    CC_VERSION_KEY,
    parseLastKnownVersion,
    null,
  );

  const version = snapshot.version ?? null;

  const summary = useMemo(() => {
    if (transcript === null) return null;
    const toolCalls = transcript.flatMap((turn) =>
      turn.messages.filter(
        (m): m is import("@/lib/code-session-store").ToolUseMessage =>
          m.kind === "tool_use",
      ),
    );
    return summarizeDrift({ toolCalls, version });
  }, [transcript, version]);

  // Triage logging. `logDriftEvent` dedupes by occurrence, so this effect
  // re-running on unrelated renders never spams the console.
  useEffect(() => {
    if (summary === null) return;
    for (const event of summary.events) logDriftEvent(event);
  }, [summary]);

  // Persist each live version as it arrives so the next session has a
  // fallback. Skipped when it already matches what's stored.
  useEffect(() => {
    if (version !== null && version !== lastKnownVersion) {
      persistLastKnownVersion(version);
    }
  }, [version, lastKnownVersion]);

  // ---- The composite value ----

  const rows = knownModelRows(snapshot.models, readModelCatalog());
  const modelLabel = resolveModelLabel(snapshot.model, rows);
  const effortDisplay = resolveEffortDisplay(
    snapshot.models,
    snapshot.model,
    snapshot.effort,
    readModelCatalog(),
  );
  const mode = resolvePermissionMode(
    snapshot.permissionMode,
    cardId === undefined ? null : persistedMode,
  );

  const value = formatAiConfigSummary({
    modelLabel,
    effortLabel: effortDisplay.supported
      ? formatEffortLabel(effortDisplay.level)
      : null,
    modeLabel: formatPermissionMode(mode),
  });

  const hasDrift = summary !== null && summary.count > 0;
  const displayVersion = version ?? lastKnownVersion;

  // The hover names the exact model — the chip's face is abbreviated and the
  // resolved id is what a reader is actually checking — plus the drift count
  // when there is one, so the signal survives without opening the report.
  const modelDetail =
    snapshot.model !== null
      ? snapshot.model
      : modelLabel !== null
        ? `${modelLabel} — exact model resolves on the first turn`
        : "Model not reported by the session";
  const tooltip = hasDrift
    ? `${modelDetail} · ${eventCountLabel(summary.count)} drift — right-click for report`
    : modelDetail;

  // The report popover's disclosure is imperative: left click belongs to the
  // sheet, so there is no trigger to click-toggle ([L06]).
  const popoverRef = React.useRef<TugPopoverHandle>(null);
  const handleContextMenu = (e: React.MouseEvent): void => {
    // With no session store there is no report to show — leave the platform
    // menu alone rather than opening an empty popover.
    if (summary === null) return;
    e.preventDefault();
    popoverRef.current?.open();
  };

  return (
    <TugPopover ref={popoverRef}>
      <TugPopoverAnchor>
        <TugActionTooltip
          action={`${TUG_ACTIONS.RUN_SLASH_COMMAND}:ai`}
          content={tooltip}
        >
          <TugPushButton
            layout="label-top"
            label="AI"
            size="sm"
            emphasis="tinted"
            role="action"
            className="ai-chip"
            data-slot="ai-chip"
            data-drift={hasDrift ? "" : undefined}
            aria-label="AI configuration"
            icon={hasDrift ? <TriangleAlert aria-hidden="true" /> : undefined}
            disabled={disabled}
            focusGroup={focusGroup}
            focusOrder={focusOrder}
            // Wrapped, not passed through: the button hands its click event to
            // the handler, and the opener's first parameter is a row name.
            onClick={() => onOpenSheet()}
            onContextMenu={handleContextMenu}
          >
            {/* Width-stabilized against the widest composition the catalog can
                produce, so changing any of the three values never reflows the
                chip. A live value wider than the sizer still fits — the active
                face is a real layout item. */}
            <TugStableOverlay
              data-slot="ai-chip-value"
              active={value}
              alternates={[widestSummary(rows.map((r) => modelRowTitle(r)))]}
            />
          </TugPushButton>
        </TugActionTooltip>
      </TugPopoverAnchor>
      <TugPopoverContent side="top" align="end" sideOffset={8} arrow spaceDismisses>
        <div className="ai-chip-report" data-slot="ai-chip-report">
          <div className="ai-chip-report-title">Claude Code stream-json</div>
          <div className="ai-chip-report-versions">
            <div className="ai-chip-report-version-row">
              <span className="ai-chip-report-version-label">running</span>
              <span className="ai-chip-report-version-value">
                {displayVersion ?? "—"}
              </span>
            </div>
            <div className="ai-chip-report-version-row">
              <span className="ai-chip-report-version-label">validated</span>
              <span className="ai-chip-report-version-value">
                {VALIDATED_CC_VERSION}
              </span>
            </div>
          </div>
          {hasDrift && (
            <ul className="ai-chip-report-list">
              {summary.events.map((event) => (
                <li key={driftEventKey(event)} className="ai-chip-report-row">
                  <SessionCautionBadge caution={event.caution} />
                  <span className="ai-chip-report-detail">
                    {event.caution.detail ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* The copy affordance the three merged chips each carried on
              right-click. It could not stay on the gesture (the report owns
              that now), so it lives here as its own row. */}
          <div className="ai-chip-report-copy">
            <TugCopyBadge value={value} copyLabel="Copy AI configuration">
              {value}
            </TugCopyBadge>
          </div>
        </div>
      </TugPopoverContent>
    </TugPopover>
  );
}
