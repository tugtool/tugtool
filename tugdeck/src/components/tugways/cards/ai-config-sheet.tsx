/**
 * ai-config-sheet.tsx — the one sheet that configures how the AI runs.
 *
 * Model, reasoning effort, and permission mode used to be three chips opening
 * three confirm-style pickers. They are one thought — "how should Claude run
 * for this session?" — and this sheet is that thought's single surface: three
 * labeled rows of segments in the **Layouts idiom** (`TugLabel` + compact
 * `TugChoiceGroup`, the exact composition `layouts-section.tsx` uses), a live
 * composite caption that previews what OK will commit, and one description
 * line under them.
 *
 * **It is a transaction.** Nothing reaches the wire until OK. That matters
 * here specifically because an effort change costs a claude respawn: browsing
 * options must never bounce the process, and holding the change until OK is
 * what lets a model + effort pick collapse into ONE respawn carrying both
 * flags ({@link computeAiConfigCommit}). Cancel and Escape send nothing at all.
 *
 * **The executor is injected.** `onCommit` receives the ordered action array
 * and answers whether it applied — so the session card can re-check the
 * turn-idle guard and refuse (leaving the sheet open with its pending values
 * rather than closing on a commit that did nothing), while the Settings
 * defaults context, which has no turn to race, writes deck defaults through the
 * same body.
 *
 * Effort is model-gated, so the EFFORT row recomputes as the pending model
 * moves: unsupported levels disable **in place** (the row keeps its shape) and
 * a stranded pending level clamps downward ({@link clampEffortToSupport}). The
 * model↔effort coupling is visible on one screen for the first time; it used
 * to be discoverable only by crossing two dialogs.
 *
 * Compositional component — composes `TugSheet`, `TugLabel`, `TugChoiceGroup`,
 * and `TugPushButton`; its own CSS is the row grid and the description-layer
 * stack. Composed children keep their own tokens [L20].
 *
 * Laws: [L02] store state is read through the store API; [L06] the description
 *       preview is DOM attributes toggled by handlers and a `MutationObserver`,
 *       never React state (the pending SELECTION is dialog-local data, not
 *       appearance, so it is ordinary `useState`); [L07] the open-time baseline
 *       is read fresh from the store, never from a render closure; [L11] the
 *       rows dispatch `selectValue` through the responder chain — `TugChoiceGroup`
 *       has no change callback; [L19]/[L20] composed `Tug*` components.
 *
 * @module components/tugways/cards/ai-config-sheet
 */

import "./ai-config-sheet.css";

import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import type {
  CapabilityModel,
  ReadableMetadataStore,
} from "@/lib/session-metadata-store";
import { readModelCatalog } from "@/lib/model-catalog";
import { resolvePickerModels } from "@/lib/model-picker-data";
import {
  compressContextPhrase,
  knownModelRows,
  modelRowTitle,
  resolveModelLabel,
  stripDisplayNameParenthetical,
} from "@/lib/model-label";
import {
  DEFAULT_EFFORT_LEVEL,
  EFFORT_LEVELS,
  formatEffortLabel,
  resolveEffortSupport,
} from "@/lib/effort";
import {
  PERMISSION_MODE_DOMAIN,
  PERMISSION_MODE_MENU,
  formatPermissionMode,
  isPermissionMode,
  parsePersistedPermissionMode,
  resolvePermissionMode,
} from "@/lib/permission-mode";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  AI_CONFIG_DEFAULT_ROW,
  AI_CONFIG_DOMAIN,
  AI_CONFIG_LAST_ROW_KEY,
  clampEffortToSupport,
  computeAiConfigCommit,
  formatAiConfigSummary,
  parseAiConfigRow,
  type AiConfigAction,
  type AiConfigBaseline,
  type AiConfigRow,
} from "@/lib/ai-config";
import { PICKER_SHEET_ANCHOR } from "./picker-sheet-anchor";

/**
 * Brief description per effort level — claude's own `/effort` framing ("how
 * long Claude thinks before answering"). Presentational copy, so it lives with
 * the surface that shows it rather than in the pure `lib/effort.ts`.
 */
const EFFORT_SUBTITLES: Record<string, string> = {
  low: "Quick edits and simple tasks",
  medium: "Balanced thinking",
  high: "Tricky bugs and harder tasks",
  xhigh: "The hardest problems",
  max: "Maximum thinking budget",
};

/**
 * Brief description per permission mode. Wording tracks the Claude Code Agent
 * SDK permission-mode docs (code.claude.com/docs → Configure permissions):
 * `default` prompts; `acceptEdits` auto-approves file edits; `plan` is
 * read-only; `auto` uses a model classifier per call; `bypassPermissions`
 * skips prompts.
 */
const PERMISSION_MODE_SUBTITLES: Record<string, string> = {
  default: "Prompts before edits and commands",
  acceptEdits: "Auto-approves file edits",
  plan: "Read-only; plans without changes",
  auto: "Model approves or denies each call",
  bypassPermissions: "Runs all tools without prompts",
};

/** The description shown when a row's pending value has no copy of its own. */
const NO_DESCRIPTION = "";

/** Stable `event.sender` per row, so the body's one handler tells them apart. */
const MODEL_SENDER_ID = "ai-config-model";
const EFFORT_SENDER_ID = "ai-config-effort";
const MODE_SENDER_ID = "ai-config-mode";

/** Focus orders within the sheet's own group: rows, then the action buttons. */
const ROW_FOCUS_ORDER: Record<AiConfigRow, number> = {
  model: 0,
  effort: 1,
  mode: 2,
};
const CANCEL_FOCUS_ORDER = 3;
const OK_FOCUS_ORDER = 4;

// ---------------------------------------------------------------------------
// Sticky row
// ---------------------------------------------------------------------------

/**
 * Remember the row the user actually changed, so the sheet opens focused where
 * the habit is. Optimistic local-cache write (so readers reflect instantly)
 * plus a PUT to the defaults endpoint — the shape the three per-setting hooks
 * already use. A PUT failure logs and otherwise vanishes: the cache holds for
 * the session and a fresh load falls back to the default row.
 */
function writeStickyRow(row: AiConfigRow): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(AI_CONFIG_DOMAIN, AI_CONFIG_LAST_ROW_KEY, {
      kind: "string",
      value: row,
    });
  }
  fetch(`/api/defaults/${AI_CONFIG_DOMAIN}/${AI_CONFIG_LAST_ROW_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: row }),
  }).catch((err) => {
    console.warn("[ai-config] lastRow PUT failed:", err);
  });
}

// ---------------------------------------------------------------------------
// useAiConfigSheet — the shared, card-hosted mixer sheet
// ---------------------------------------------------------------------------

/** Args for {@link useAiConfigSheet}. */
export interface UseAiConfigSheetArgs {
  /**
   * The card whose persisted permission mode pre-populates the baseline.
   * **Omit for the defaults context** (Settings → Assistant): with no card
   * behind the sheet there is no per-card value, so the store's mode — the
   * deck default via `DefaultsMetadataAdapter` — stands alone.
   */
  cardId?: string;
  /**
   * Metadata store supplying the model list, the resolved model, the effort
   * override, and the live permission mode. A `ReadableMetadataStore`, so the
   * defaults adapter satisfies it as readily as the session store does.
   */
  sessionMetadataStore: ReadableMetadataStore;
  /**
   * The card's shared sheet host (`useTugSheet().showSheet`). Routing every
   * card sheet through one host means opening this one replaces any other open
   * sheet instead of stacking a second.
   */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
  /**
   * Apply the committed actions **in array order**, answering whether they
   * were applied. `false` keeps the sheet open with its pending values — the
   * session card returns it when the turn-idle guard refuses, so a commit that
   * did nothing never looks like one that succeeded.
   */
  onCommit: (actions: AiConfigAction[]) => boolean;
  /**
   * Extra content below the rows — the session context's rules-editor door and
   * Claude Code version line. Omitted in the defaults context, which has no
   * session cwd for rules and no live version to report.
   */
  renderFooter?: (close: () => void) => React.ReactNode;
  /**
   * What a committed change does to an enclosing focus cycle ([P15]) —
   * forwarded to the sheet. `"relinquish"` exits cycling (caret to the
   * prompt); `"retain"` keeps cycling (ring back on the chip).
   */
  commitDisposition?: "retain" | "relinquish";
}

/** Imperative handle to the card-hosted AI configuration sheet. */
export interface AiConfigSheetController {
  /**
   * Present the sheet, reading the baseline fresh from the store ([L07]).
   * `focusRow` deep-links the keyboard ring to a named row (`/model`,
   * `/effort`, `/mode`); omitted, the ring lands on the sticky row.
   */
  openAiConfigSheet: (focusRow?: AiConfigRow) => void;
}

/**
 * Own the mixer sheet once at the card level, so the AI chip, `/ai`, and the
 * three deep-link slash commands all present the *same* sheet.
 */
export function useAiConfigSheet({
  cardId,
  sessionMetadataStore,
  showSheet,
  onCommit,
  renderFooter,
  commitDisposition,
}: UseAiConfigSheetArgs): AiConfigSheetController {
  // The pre-population fallback before the first `system_metadata` round-trip
  // on a fresh card mount ([D07]), matching what the chip displays. In the
  // defaults context (no cardId) the read misses and the store's mode wins.
  const persistedMode = useTugbankValue<string | null>(
    PERMISSION_MODE_DOMAIN,
    cardId ?? "",
    parsePersistedPermissionMode,
    null,
  );

  const stickyRow = useTugbankValue<AiConfigRow | null>(
    AI_CONFIG_DOMAIN,
    AI_CONFIG_LAST_ROW_KEY,
    parseAiConfigRow,
    null,
  );

  const openAiConfigSheet = useCallback(
    (focusRow?: AiConfigRow) => {
      const snapshot = sessionMetadataStore.getSnapshot();
      const catalog = readModelCatalog();
      const { options, activeValue } = resolvePickerModels(
        snapshot.models,
        snapshot.model,
        catalog,
      );
      const support = resolveEffortSupport(
        snapshot.models,
        snapshot.model,
        catalog,
      );
      const baseline: AiConfigBaseline = {
        modelSelector: activeValue,
        // The EFFECTIVE level, matching what the chip shows — so re-confirming
        // the model's default never costs a respawn.
        effortLevel: support.supported
          ? (snapshot.effort ?? DEFAULT_EFFORT_LEVEL)
          : null,
        mode: resolvePermissionMode(
          snapshot.permissionMode,
          cardId === undefined ? null : persistedMode,
        ),
      };

      void showSheet({
        title: "AI",
        icon: "Sparkles",
        iconRole: "agent",
        onCommitDisposition: commitDisposition,
        presentation: "rise",
        bottomAnchorSelector: PICKER_SHEET_ANCHOR,
        content: (close) => (
          <AiConfigSheetBody
            options={options}
            models={snapshot.models}
            catalog={catalog}
            baseline={baseline}
            openRow={focusRow ?? stickyRow ?? AI_CONFIG_DEFAULT_ROW}
            onCommit={onCommit}
            renderFooter={renderFooter}
            close={() => close()}
          />
        ),
      });
    },
    [
      showSheet,
      sessionMetadataStore,
      cardId,
      persistedMode,
      stickyRow,
      onCommit,
      renderFooter,
      commitDisposition,
    ],
  );

  return { openAiConfigSheet };
}

// ---------------------------------------------------------------------------
// The description line's preview machinery ([L06])
// ---------------------------------------------------------------------------

/**
 * The preview id a segment stands for, or `null` when the element is not a
 * previewable segment.
 *
 * A sibling of `layouts-section.tsx`'s resolver, deliberately **without** its
 * `data-state="active"` bail. In Layouts, "no preview" means *show the
 * committed plan*, so hovering the current answer must not draw a tentative
 * copy of it. This sheet has no committed/tentative duality — a description
 * line has one job, describing whatever the pointer is over — so hovering the
 * already-pending segment must still describe it. Keeping the bail would fall
 * through to the default layer and describe a *different row*.
 */
function previewIdOf(el: Element | null): string | null {
  const segment = el?.closest("[data-choice-value]") ?? null;
  if (segment === null) return null;
  const row = segment.closest("[data-preview-row]");
  if (row === null) return null;
  return `${row.getAttribute("data-preview-row")}:${segment.getAttribute(
    "data-choice-value",
  )}`;
}

// ---------------------------------------------------------------------------
// Sheet body
// ---------------------------------------------------------------------------

interface AiConfigSheetBodyProps {
  /** The model rows to offer, resolved at open time. */
  options: CapabilityModel[];
  /** The live capability list, for recomputing effort support per model. */
  models: CapabilityModel[];
  /** The persisted catalog behind the live list. */
  catalog: CapabilityModel[] | null;
  /** What "unchanged" means for the commit diff. */
  baseline: AiConfigBaseline;
  /** The row the keyboard ring lands on. */
  openRow: AiConfigRow;
  /** Apply the ordered actions; `false` keeps the sheet open. */
  onCommit: (actions: AiConfigAction[]) => boolean;
  renderFooter?: (close: () => void) => React.ReactNode;
  close: () => void;
}

/** One layer of the description stack. */
interface DescriptionLayer {
  previewId: string;
  text: string;
}

/** The description copy for a row's value, empty when the row has none. */
function describe(
  row: AiConfigRow,
  value: string,
  options: CapabilityModel[],
): string {
  if (row === "effort") return EFFORT_SUBTITLES[value] ?? NO_DESCRIPTION;
  if (row === "mode") return PERMISSION_MODE_SUBTITLES[value] ?? NO_DESCRIPTION;
  const option = options.find((o) => o.value === value);
  if (option === undefined) return NO_DESCRIPTION;
  return option.description !== undefined
    ? compressContextPhrase(option.description)
    : modelRowTitle(option);
}

function AiConfigSheetBody({
  options,
  models,
  catalog,
  baseline,
  openRow,
  onCommit,
  renderFooter,
  close,
}: AiConfigSheetBodyProps): React.ReactElement {
  // The pending triple is dialog-local DATA, not appearance — the same
  // `useState` the three picker bodies this replaces used for their in-sheet
  // selection ([L06] governs the preview, not the choice).
  const [pendingModel, setPendingModel] = useState<string | null>(
    baseline.modelSelector,
  );
  const [pendingEffort, setPendingEffort] = useState<string | null>(
    baseline.effortLevel,
  );
  const [pendingMode, setPendingMode] = useState<string>(baseline.mode);
  /** The row the user last moved — the sticky value, and the default layer. */
  const [lastChangedRow, setLastChangedRow] = useState<AiConfigRow | null>(null);

  // Effort support follows the PENDING model, so choosing a narrower model
  // greys its missing levels the instant it is chosen rather than at commit.
  const support = resolveEffortSupport(models, pendingModel, catalog);

  const rows = knownModelRows(models, catalog);
  const summary = formatAiConfigSummary({
    modelLabel: resolveModelLabel(pendingModel, rows),
    effortLabel: pendingEffort === null ? null : formatEffortLabel(pendingEffort),
    modeLabel: formatPermissionMode(pendingMode),
  });

  // ---- Row selection ([L11]) ----

  const selectModel = useCallback(
    (value: string) => {
      setPendingModel(value);
      // The new model may not offer the pending level; clamp DOWN rather than
      // strand a selection the commit could not honor.
      const levels = resolveEffortSupport(models, value, catalog).levels;
      setPendingEffort((current) => clampEffortToSupport(current, levels));
      setLastChangedRow("model");
    },
    [models, catalog],
  );

  const { ResponderScope, responderRef } = useResponder({
    id: "ai-config-sheet",
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        const value = event.value;
        if (typeof value !== "string") return;
        switch (event.sender) {
          case MODEL_SENDER_ID:
            selectModel(value);
            return;
          case EFFORT_SENDER_ID:
            setPendingEffort(value);
            setLastChangedRow("effort");
            return;
          case MODE_SENDER_ID:
            if (isPermissionMode(value)) {
              setPendingMode(value);
              setLastChangedRow("mode");
            }
            return;
          default:
            return;
        }
      },
    },
  });

  // ---- The description line's preview switch ([L06]) ----

  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const setPreview = useCallback((id: string | null) => {
    const stack = descriptionRef.current;
    if (stack === null) return;
    let matched = false;
    for (const layer of stack.querySelectorAll("[data-description-preview-id]")) {
      const on =
        id !== null && layer.getAttribute("data-description-preview-id") === id;
      layer.toggleAttribute("data-description-active", on);
      matched = matched || on;
    }
    stack.toggleAttribute("data-previewing", matched);
  }, []);

  // The keyboard cursor previews exactly as the pointer does: the engine marks
  // the ringed group `data-key-view-kbd` and its cursor segment
  // `data-key-cursor`, so an observer on those attributes resolves the cursored
  // segment whenever either moves. With deferred commit, arrows read the
  // options and Space chooses one.
  useLayoutEffect(() => {
    const container = rowsRef.current;
    if (container === null) return;
    const recompute = (): void => {
      setPreview(
        previewIdOf(
          container.querySelector(
            "[data-key-view-kbd] [data-key-cursor][data-choice-value]",
          ),
        ),
      );
    };
    const observer = new MutationObserver(recompute);
    observer.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-key-cursor", "data-key-view-kbd"],
    });
    return () => observer.disconnect();
  }, [setPreview]);

  // ---- The layers ----

  const layers: DescriptionLayer[] = [
    ...options.map((option) => ({
      previewId: `model:${option.value}`,
      text: describe("model", option.value, options),
    })),
    ...EFFORT_LEVELS.map((level) => ({
      previewId: `effort:${level}`,
      text: describe("effort", level, options),
    })),
    ...PERMISSION_MODE_MENU.map((mode) => ({
      previewId: `mode:${mode}`,
      text: describe("mode", mode, options),
    })),
  ];

  // At rest the line describes the pending value of the row the user last
  // moved — and before anything has moved, of the row the sheet opened on, so
  // the line is never blank on the first frame.
  const defaultRow = lastChangedRow ?? openRow;
  const defaultValue =
    defaultRow === "model"
      ? pendingModel
      : defaultRow === "effort"
        ? pendingEffort
        : pendingMode;
  const defaultText =
    defaultValue === null ? NO_DESCRIPTION : describe(defaultRow, defaultValue, options);

  // ---- The rows ----

  const modelItems: TugChoiceItem[] = options.map((option) => ({
    value: option.value,
    // The parenthetical ("Default (recommended)") is the one thing that blows
    // a segment out of a five-across row; the shared stripper exists for
    // exactly these width-bound contexts.
    label: stripDisplayNameParenthetical(option.displayName),
  }));

  const effortItems: TugChoiceItem[] = EFFORT_LEVELS.map((level) => ({
    value: level,
    label: formatEffortLabel(level),
    // Unsupported levels grey IN PLACE — the row keeps its shape, and the
    // model↔effort coupling reads on one screen.
    disabled: !support.levels.includes(level),
  }));

  const modeItems: TugChoiceItem[] = PERMISSION_MODE_MENU.map((mode) => ({
    value: mode,
    label: formatPermissionMode(mode),
  }));

  // ---- Focus ----

  const focusGroup = React.useId();
  useSeedKeyView(`${focusGroup}:${ROW_FOCUS_ORDER[openRow]}`);

  const confirm = (): void => {
    const actions = computeAiConfigCommit(baseline, {
      modelSelector: pendingModel,
      effortLevel: pendingEffort,
      mode: pendingMode,
    });
    if (actions.length > 0) {
      // A refusal (the turn went in flight while the sheet was up) leaves the
      // sheet standing with its pending values — the caution says why, and no
      // part of the transaction has been applied.
      if (!onCommit(actions)) return;
      if (lastChangedRow !== null) writeStickyRow(lastChangedRow);
    }
    close();
  };

  return (
    <ResponderScope>
      <div
        className="ai-config-sheet"
        data-slot="ai-config-sheet"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <div className="ai-config-summary" data-slot="ai-config-summary">
          {summary}
        </div>

        <div
          className="ai-config-rows"
          ref={rowsRef}
          onPointerOver={(event) => setPreview(previewIdOf(event.target as Element))}
          onPointerLeave={() => setPreview(null)}
        >
          <div className="ai-config-row" data-preview-row="model">
            <TugLabel size="md" emphasis="proposal" className="ai-config-caption">
              Model
            </TugLabel>
            <TugChoiceGroup
              items={modelItems}
              value={pendingModel ?? ""}
              senderId={MODEL_SENDER_ID}
              size="xs"
              sidePadding="xs"
              focusGroup={focusGroup}
              focusOrder={ROW_FOCUS_ORDER.model}
              aria-label="Model"
              data-testid="ai-config-model"
            />
          </div>

          <div className="ai-config-row" data-preview-row="effort">
            <TugLabel size="md" emphasis="proposal" className="ai-config-caption">
              Effort
            </TugLabel>
            <TugChoiceGroup
              items={effortItems}
              // A model supporting no effort at all has no level to mark. An
              // empty value matches no segment, so none paints active and the
              // indicator measurement bails on its own — inert rather than
              // mispainted — and the group's `disabled` is what makes the
              // state legible.
              value={pendingEffort ?? ""}
              senderId={EFFORT_SENDER_ID}
              size="xs"
              sidePadding="xs"
              disabled={support.levels.length === 0}
              focusGroup={focusGroup}
              focusOrder={ROW_FOCUS_ORDER.effort}
              aria-label="Reasoning effort"
              data-testid="ai-config-effort"
            />
          </div>

          <div className="ai-config-row" data-preview-row="mode">
            <TugLabel size="md" emphasis="proposal" className="ai-config-caption">
              Mode
            </TugLabel>
            <TugChoiceGroup
              items={modeItems}
              value={pendingMode}
              senderId={MODE_SENDER_ID}
              size="xs"
              sidePadding="xs"
              focusGroup={focusGroup}
              focusOrder={ROW_FOCUS_ORDER.mode}
              aria-label="Permission mode"
              data-testid="ai-config-mode"
            />
          </div>
        </div>

        {/* One pre-rendered layer per option; which one shows is DOM
            attributes, so the preview costs no render ([L06]). */}
        <div
          className="ai-config-description"
          ref={descriptionRef}
          aria-hidden="true"
        >
          <div className="ai-config-description-layer" data-description-layer="default">
            {defaultText}
          </div>
          {layers.map((layer) => (
            <div
              className="ai-config-description-layer"
              data-description-preview-id={layer.previewId}
              key={layer.previewId}
            >
              {layer.text}
            </div>
          ))}
        </div>

        {renderFooter !== undefined && (
          <div className="ai-config-footer">{renderFooter(close)}</div>
        )}

        <div className="tug-sheet-actions">
          <TugPushButton
            size="sm"
            data-slot="ai-config-cancel"
            emphasis="outlined"
            role="action"
            onClick={close}
            focusGroup={focusGroup}
            focusOrder={CANCEL_FOCUS_ORDER}
          >
            Cancel
          </TugPushButton>
          <TugPushButton
            size="sm"
            data-slot="ai-config-ok"
            emphasis="primary"
            onClick={confirm}
            focusGroup={focusGroup}
            focusOrder={OK_FOCUS_ORDER}
            persistentDefaultRing
          >
            OK
          </TugPushButton>
        </div>
      </div>
    </ResponderScope>
  );
}
