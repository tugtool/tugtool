/**
 * ai-config-sheet.tsx — the one sheet that configures how the AI runs.
 *
 * Model, reasoning effort, and permission mode used to be three chips opening
 * three confirm-style pickers. They are one thought — "how should Claude run
 * for this session?" — and this sheet is that thought's single surface.
 *
 * **The mixer convention.** The pending state is the loudest thing on the
 * surface: a **readout** in large type at the top, the model name loudest, so what
 * OK will commit is legible at a glance rather than decoded from which segments
 * happen to be lit. Under it, one **channel** per parameter, and each channel
 * gets the control its parameter's shape deserves rather than a uniform row of
 * equal-weight segments:
 *
 *  - **Model** — a `TugListView` option list, because a model is the decision
 *    people actually deliberate: every option carries its own name AND
 *    description, at a size worth reading.
 *  - **Effort** — a `TugSlider` **stepped track** (`showTicks` + `tickLabel`),
 *    because effort is ordinal. Geometry says "more/less" in a way five equal
 *    chips cannot, and the track spans exactly the levels the pending model
 *    offers, so an unreachable level is absent rather than mysteriously greyed.
 *  - **Mode** — a compact `TugChoiceGroup`, the right control for a small flat
 *    set of named alternatives.
 *
 * Each channel carries its **own** description line, under its own control, so
 * a description names the thing it sits beneath instead of being deciphered
 * from a shared line at the far end of the sheet.
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
 * Effort is model-gated, so the EFFORT channel recomputes as the pending model
 * moves: the track spans the pending model's own levels, and a stranded pending
 * level clamps downward ({@link clampEffortToSupport}). The model↔effort
 * coupling is visible on one screen for the first time; it used to be
 * discoverable only by crossing two dialogs.
 *
 * **Choosing is free; committing is not.** Every control selects *live* into
 * the sheet's pending state — arrows audition a value and the readout and the
 * channel's own description follow at once — because inside a transaction a
 * selection has no side effect to defer ([P24]'s deferred form is for controls
 * whose selection acts). Only OK sends anything.
 *
 * Compositional component — composes `TugSheet`, `TugLabel`, `TugListView`,
 * `TugListRow`, `TugSlider`, `TugChoiceGroup`, and `TugPushButton`; its own CSS
 * is the readout type scale and the channel stack. Composed children keep their
 * own tokens [L20].
 *
 * Laws: [L02] store state is read through the store API; [L06] no React state
 *       for appearance (the pending SELECTION is dialog-local data, not
 *       appearance, so it is ordinary `useState`); [L07] the open-time baseline
 *       is read fresh from the store, never from a render closure; [L11] every
 *       control emits through the responder chain — `selectValue` from the
 *       choice group, `setValue` from the slider, the list's own delegate — and
 *       none has a change callback; [L19]/[L20] composed `Tug*` components.
 *
 * @module components/tugways/cards/ai-config-sheet
 */

import "./ai-config-sheet.css";
import "./sheet-option-list.css";

import React, { useCallback, useMemo, useState } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSlider } from "@/components/tugways/tug-slider";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
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
  resolveModelLabel,
} from "@/lib/model-label";
import {
  DEFAULT_EFFORT_LEVEL,
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
  AI_CONFIG_UNKNOWN_MODEL,
  clampEffortToSupport,
  computeAiConfigCommit,
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

/**
 * Stable `event.sender` per channel, so the body's handlers tell them apart.
 * The model channel has none: a `TugListView` reports through its delegate, not
 * through the chain.
 */
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
   * One line saying **whose** settings these are — the sheet is the same body
   * in two contexts, and only this line tells them apart, so neither context
   * leaves the reader guessing whether OK reaches one session or every new
   * one.
   */
  scopeNote: string;
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
  scopeNote,
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
        title: "AI Model Settings",
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
            scopeNote={scopeNote}
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
// The model channel's option list
// ---------------------------------------------------------------------------

/**
 * The pending model, published to the cell renderers so the matching row paints
 * selected. Selection changes live through the list's delegate, so this only
 * carries the read-only "which row is current" value.
 */
const ModelListContext = React.createContext<string | null>(null);

/**
 * Static, single-section data source over the model options resolved at open
 * time. The set is fixed for a sheet's lifetime, so `subscribe` is a no-op and
 * `getVersion` a stable constant.
 */
class ModelListDataSource implements TugListViewDataSource {
  private readonly models: readonly CapabilityModel[];

  constructor(models: readonly CapabilityModel[]) {
    this.models = models;
  }

  numberOfItems(): number {
    return this.models.length;
  }

  idForIndex(index: number): string {
    return this.models[index].value;
  }

  kindForIndex(): string {
    return "model";
  }

  /** Cell-renderer accessor — the model at `index`. */
  modelAt(index: number): CapabilityModel {
    return this.models[index];
  }

  subscribe(): () => void {
    return () => {};
  }

  getVersion(): unknown {
    return 0;
  }
}

/**
 * One model row: the display name over its description, with a leading check on
 * the pending one. `selectedGlyph="check"` reserves the check column on every
 * row so the names align whether or not a row carries the mark. The verbose
 * context phrase is compressed to the ` · 1M` idiom and may wrap to a second
 * line rather than truncate — the description is the reason this channel is a
 * list instead of a row of chips.
 */
const ModelListCell: TugListViewCellRenderer<ModelListDataSource> =
  function ModelListCell({
    index,
    dataSource,
  }: TugListViewCellProps<ModelListDataSource>): React.ReactElement {
    const pending = React.useContext(ModelListContext);
    const model = dataSource.modelAt(index);
    return (
      <TugListRow
        title={model.displayName}
        subtitle={
          model.description !== undefined
            ? compressContextPhrase(model.description)
            : undefined
        }
        subtitleMaxLines={2}
        selected={model.value === pending}
        selectedGlyph="check"
        data-model={model.value}
      />
    );
  };

const MODEL_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<ModelListDataSource>
> = {
  model: ModelListCell,
};

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
  /** Whose settings these are — see {@link UseAiConfigSheetArgs.scopeNote}. */
  scopeNote: string;
  renderFooter?: (close: () => void) => React.ReactNode;
  close: () => void;
}

function AiConfigSheetBody({
  options,
  models,
  catalog,
  baseline,
  openRow,
  onCommit,
  scopeNote,
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
  // narrows the track the instant it is chosen rather than at commit.
  const support = resolveEffortSupport(models, pendingModel, catalog);

  // The label rows behind `resolveModelLabel` — the readout's model name comes
  // through the same single helper the chip uses, so the two always agree.
  const rows = knownModelRows(models, catalog);

  // ---- Channel selection ([L11]) ----

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
        if (event.sender === MODE_SENDER_ID && isPermissionMode(value)) {
          setPendingMode(value);
          setLastChangedRow("mode");
        }
      },
      // The effort track is a `TugSlider`, so it reports a NUMBER — the index
      // of a notch on the pending model's own level list — through `setValue`
      // rather than `selectValue`. Every phase is applied, including the drag's
      // `cancel` (which carries the pre-drag value, i.e. the restore).
      [TUG_ACTIONS.SET_VALUE]: (event: ActionEvent) => {
        if (event.sender !== EFFORT_SENDER_ID) return;
        const index = event.value;
        if (typeof index !== "number") return;
        const level = support.levels[index];
        if (level === undefined) return;
        setPendingEffort(level);
        setLastChangedRow("effort");
      },
    },
  });

  // ---- The model channel's list ----

  const dataSource = useMemo(() => new ModelListDataSource(options), [options]);
  const delegate = useMemo<TugListViewDelegate>(
    () => ({ onSelect: (index) => selectModel(options[index].value) }),
    [options, selectModel],
  );
  const openModelIndex = options.findIndex(
    (option) => option.value === baseline.modelSelector,
  );

  // ---- The effort channel's track ----
  //
  // The track is indexed over the PENDING model's own supported levels, not
  // over the canonical five. That is what makes an unreachable level
  // unreachable: there is no notch to land on, so no clamping is needed at the
  // control layer and a non-contiguous support set (a model offering low and
  // high but not medium) still cannot produce an invalid pick.
  const levels = support.levels;
  const effortIndex = Math.max(
    0,
    levels.findIndex((level) => level === pendingEffort),
  );
  const effortDescription =
    levels.length === 0
      ? `${resolveModelLabel(pendingModel, rows) ?? "This model"} does not offer reasoning effort`
      : pendingEffort === null
        ? NO_DESCRIPTION
        : (EFFORT_SUBTITLES[pendingEffort] ?? NO_DESCRIPTION);

  // ---- The mode channel's segments ----

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
        {/* The readout: what OK will commit, in the largest type on the
            surface. The model carries the most weight because it is the
            decision the other two qualify. */}
        <div className="ai-config-readout" data-slot="ai-config-summary">
          <span className="ai-config-readout-model">
            {resolveModelLabel(pendingModel, rows) ?? AI_CONFIG_UNKNOWN_MODEL}
          </span>
          <span className="ai-config-readout-rest">
            {/* The spaces live in the text, not in a margin, so the readout
                reads correctly when it is taken as a string. */}
            {pendingEffort !== null && (
              <>
                <span className="ai-config-readout-sep"> · </span>
                {formatEffortLabel(pendingEffort)}
              </>
            )}
            <span className="ai-config-readout-sep"> · </span>
            {formatPermissionMode(pendingMode)}
          </span>
        </div>

        {/* Directly under the readout, because it qualifies it: the readout
            says what OK commits, this says where it lands. */}
        <div className="ai-config-scope" data-slot="ai-config-scope">
          {scopeNote}
        </div>

        <div className="ai-config-channels">
          <div className="ai-config-channel ai-config-channel-model">
            <TugLabel size="md" emphasis="proposal" className="ai-config-caption">
              Model
            </TugLabel>
            {/* The test hook rides the wrapper, not the list: `TugListView`
                does not forward unknown props to its root. */}
            <div
              className="ai-config-model-list sheet-option-list"
              data-testid="ai-config-model"
            >
              <ModelListContext.Provider value={pendingModel}>
                <TugListView<ModelListDataSource>
                  dataSource={dataSource}
                  delegate={delegate}
                  cellRenderers={MODEL_CELL_RENDERERS}
                  rowLayout="flush"
                  inline
                  focusGroup={focusGroup}
                  focusOrder={ROW_FOCUS_ORDER.model}
                  singleSelect
                  initialSelectedIndex={openModelIndex}
                />
              </ModelListContext.Provider>
            </div>
          </div>

          <div className="ai-config-channel">
            <TugLabel size="md" emphasis="proposal" className="ai-config-caption">
              Effort
            </TugLabel>
            {/* The stepped track spans exactly the pending model's levels, so
                a model that offers none renders a disabled single-notch track
                and says so in its description rather than presenting five
                greyed chips to decode. */}
            <div className="ai-config-track">
              <TugSlider
                value={effortIndex}
                senderId={EFFORT_SENDER_ID}
                min={0}
                max={Math.max(0, levels.length - 1)}
                step={1}
                size="sm"
                showTicks
                showValue={false}
                tickLabel={(_value, index) => formatEffortLabel(levels[index])}
                disabled={levels.length === 0}
                focusGroup={focusGroup}
                focusOrder={ROW_FOCUS_ORDER.effort}
                aria-label="Reasoning effort"
                data-testid="ai-config-effort"
              />
            </div>
            <div className="ai-config-note">{effortDescription}</div>
          </div>

          <div className="ai-config-channel">
            <TugLabel size="md" emphasis="proposal" className="ai-config-caption">
              Mode
            </TugLabel>
            <TugChoiceGroup
              items={modeItems}
              value={pendingMode}
              senderId={MODE_SENDER_ID}
              size="sm"
              sidePadding="xs"
              columns="proportional"
              commit="live"
              focusGroup={focusGroup}
              focusOrder={ROW_FOCUS_ORDER.mode}
              aria-label="Permission mode"
              data-testid="ai-config-mode"
            />
            <div className="ai-config-note">
              {PERMISSION_MODE_SUBTITLES[pendingMode] ?? NO_DESCRIPTION}
            </div>
          </div>
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
