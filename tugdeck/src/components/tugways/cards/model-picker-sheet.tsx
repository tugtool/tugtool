/**
 * model-picker-sheet.tsx — the Z4B model picker sheet + its card-hosted hook.
 *
 * The `/model` command and the Z4B model chip both change the session's
 * model through one shared sheet. {@link useModelPicker} owns that sheet once
 * at the card level (mirroring {@link usePermissionSheet}): the dev card wires
 * `openModelPicker` to the chip's `onOpenPicker` AND to its `model`
 * `RUN_SLASH_COMMAND` handler, and renders `renderModelPicker` in its content
 * region — so the chip press and the slash command present the *same* sheet
 * ([#step-2b], [D15]).
 *
 * The option list is resolved fresh at open time from
 * `SessionMetadataStore` ([L02], [L07]): the turn-free `initialize` model
 * list when present, else the static `KNOWN_MODELS` fallback (resumed
 * sessions carry no `initialize` list) — see {@link resolvePickerModels}.
 * Picking a row sends a `model_change` control frame via {@link
 * DevControlSender}; the chip reflects the new model on the next
 * `system_metadata` round-trip ([D03]), matching the plan's round-trip model.
 *
 * Compositional component — composes `TugSheet`, `TugListView`, `TugListRow`,
 * and `TugPushButton`; its only own CSS is the option-list layout. The
 * composed children keep their own tokens [L20].
 *
 * Laws: [L02] store reads via the store API, [L06] no React state for
 *       appearance, [L19] authoring guide, [L20] composed children keep tokens
 * Decisions: [D04] SessionMetadataStore hub, [D13] Z4B model is the second
 *            interactive chip, [D15] pane sheets are overlays
 *
 * @module components/tugways/cards/model-picker-sheet
 */

import "./model-picker-sheet.css";

import React, { useCallback, useMemo, useState } from "react";
import { Check } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  CapabilityModel,
  SessionMetadataStore,
} from "@/lib/session-metadata-store";
import { resolvePickerModels, selectorToModelId } from "@/lib/model-picker-data";

// ---------------------------------------------------------------------------
// useModelPicker — the shared, card-hosted model sheet
// ---------------------------------------------------------------------------

/** Args for {@link useModelPicker}. */
export interface UseModelPickerArgs {
  /** Store that sends the `model_change` frame to tugcode → claude. */
  codeSessionStore: CodeSessionStore;
  /** Metadata store supplying the live model + the `initialize` model list. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * The card's shared sheet host (`useTugSheet().showSheet`). Routing every
   * card picker through one host means opening this picker replaces any other
   * open picker instead of stacking a second sheet.
   */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

/** Imperative handle to the card-hosted model picker sheet. */
export interface ModelPickerController {
  /** Present the sheet, resolving the option list + active row at open time. */
  openModelPicker: () => void;
}

/**
 * Own the model picker sheet once, at the card level, so the chip press and
 * the `/model` slash command present the *same* sheet ([#step-2b]). The dev
 * card passes `openModelPicker` to the chip's `onOpenPicker` and to its
 * `model` command handler, and renders `renderModelPicker` in its content
 * region (card-scoped per [D15]).
 *
 * The model list is read fresh from the store at open time ([L07]): the
 * `initialize` list when present, else the static fallback.
 */
export function useModelPicker({
  codeSessionStore,
  sessionMetadataStore,
  showSheet,
}: UseModelPickerArgs): ModelPickerController {
  const openModelPicker = useCallback(() => {
    const snapshot = sessionMetadataStore.getSnapshot();
    const { options, activeValue } = resolvePickerModels(
      snapshot.models,
      snapshot.model,
    );
    void showSheet({
      title: "Model",
      description: "Choose the model for this session.",
      content: (close) => (
        <ModelPickerSheetBody
          options={options}
          activeValue={activeValue}
          onConfirm={(picked) => {
            if (picked !== null && picked !== activeValue) {
              codeSessionStore.setModel(picked);
              // Optimistic chip update — claude answers with a control_response,
              // not a fresh system_metadata, so reflect the pick immediately.
              sessionMetadataStore.applyModel(selectorToModelId(picked));
            }
            close(picked ?? undefined);
          }}
          onCancel={() => close()}
        />
      ),
    });
  }, [showSheet, sessionMetadataStore, codeSessionStore]);

  return { openModelPicker };
}

// ---------------------------------------------------------------------------
// Picker sheet body — a TugListView of model options
// ---------------------------------------------------------------------------

/**
 * The model marked active when the sheet opened, published to the cell
 * renderers so the matching row paints selected. `onPick` lives on the
 * delegate (in scope where the sheet is built), so the context only carries
 * the read-only "which row is current" value.
 */
const ModelPickerListContext = React.createContext<string | null>(null);

/**
 * Static, single-section data source over the resolved option list. The set
 * is fixed for a sheet's lifetime, so `subscribe` is a no-op and `getVersion`
 * a stable constant.
 */
class ModelPickerDataSource implements TugListViewDataSource {
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
 * One model-option row. A flush `TugListRow` whose title is the model's
 * display name over its optional description; the row paints selected (with a
 * leading checkmark) when its value matches the sheet-open-time active model.
 * Every row renders the fixed-width check holder — empty when unselected — so
 * the titles align whether or not a row carries the mark. Presentational —
 * activation is the enclosing `TugListView` cell wrapper's job.
 */
const ModelPickerCell: TugListViewCellRenderer<ModelPickerDataSource> =
  function ModelPickerCell({
    index,
    dataSource,
  }: TugListViewCellProps<ModelPickerDataSource>): React.ReactElement {
    const activeValue = React.useContext(ModelPickerListContext);
    const model = dataSource.modelAt(index);
    const selected = model.value === activeValue;
    return (
      <TugListRow
        title={model.displayName}
        subtitle={model.description}
        selected={selected}
        leading={
          <span className="model-picker-check" aria-hidden="true">
            {selected ? <Check /> : null}
          </span>
        }
        data-model={model.value}
      />
    );
  };

const MODEL_PICKER_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<ModelPickerDataSource>
> = {
  model: ModelPickerCell,
};

interface ModelPickerSheetBodyProps {
  /** The resolved options to render. */
  options: CapabilityModel[];
  /** The value marked selected when the sheet opened (`null` if none). */
  activeValue: string | null;
  /** Commit the chosen model (no-op if unchanged) and dismiss — OK / Enter. */
  onConfirm: (value: string | null) => void;
  /** Dismiss without changing the model — Cancel / Escape / Cmd-. */
  onCancel: () => void;
}

/**
 * The model-options sheet body: a `TugListView` of model rows above a
 * Cancel / OK action row. Clicking a row only moves the in-sheet selection
 * (the checkmark) — nothing commits until OK (or Enter). Cancel / Escape /
 * Cmd-. dismiss with no change. This is a confirm-style dialog, not a
 * pick-to-apply menu.
 */
function ModelPickerSheetBody({
  options,
  activeValue,
  onConfirm,
  onCancel,
}: ModelPickerSheetBodyProps): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(activeValue);
  const dataSource = useMemo(
    () => new ModelPickerDataSource(options),
    [options],
  );
  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => setSelected(options[index].value),
    }),
    [options],
  );

  const confirm = (): void => onConfirm(selected);

  return (
    <div
      className="model-picker-sheet"
      onKeyDown={(e) => {
        // Enter accepts (OK) regardless of which control holds focus;
        // preventDefault suppresses a focused button's native Enter-click so
        // the accept path is single + consistent. Escape / Cmd-. are handled
        // by TugSheet (cancelDialog → dismiss, no commit).
        if (e.key === "Enter") {
          e.preventDefault();
          confirm();
        }
      }}
    >
      <ModelPickerListContext.Provider value={selected}>
        <div className="model-picker-sheet-list">
          <TugListView<ModelPickerDataSource>
            dataSource={dataSource}
            delegate={delegate}
            cellRenderers={MODEL_PICKER_CELL_RENDERERS}
            rowLayout="flush"
            inline
            className="model-picker-list"
          />
        </div>
      </ModelPickerListContext.Provider>
      <div className="tug-sheet-actions">
        <TugPushButton onClick={onCancel}>Cancel</TugPushButton>
        <TugPushButton emphasis="filled" onClick={confirm}>
          OK
        </TugPushButton>
      </div>
    </div>
  );
}
