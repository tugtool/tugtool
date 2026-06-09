/**
 * effort-picker-sheet.tsx — the Z4B effort picker sheet + its card-hosted hook.
 *
 * The effort chip ([effort-chip.tsx]) and a future `/effort` slash command both
 * change the session's reasoning effort through one shared sheet.
 * {@link useEffortPicker} owns that sheet once at the card level (mirroring
 * {@link useModelPicker} / {@link usePermissionSheet}): the dev card wires
 * `openEffortPicker` to the chip's `onOpenPicker`, and renders the picker in
 * its content region — so the chip press and the command present the *same*
 * sheet ([#step-4], [D15]).
 *
 * The level list is resolved fresh at open time from `SessionMetadataStore`
 * ([L02], [L07]): the *active model's* `supportedEffortLevels` (opus offers
 * five, sonnet four), with the current level marked. Picking a level routes to
 * the card's `setEffort` ({@link useEffort}), which reflects it optimistically,
 * persists it, and sends the `effort_change` frame — tugcode respawns claude
 * with `--effort` + `--resume` to apply it ([R07]).
 *
 * Compositional component — composes `TugSheet`, `TugListView`, `TugListRow`,
 * and `TugPushButton`; its only own CSS is the option-list layout (shared with
 * the model picker). The composed children keep their own tokens [L20].
 *
 * Laws: [L02] store reads via the store API, [L06] no React state for
 *       appearance, [L19] authoring guide, [L20] composed children keep tokens
 * Decisions: [D04] SessionMetadataStore hub, [D07] per-card persistence,
 *            [D13] interactive chip, [D15] pane sheets are overlays
 *
 * @module components/tugways/cards/effort-picker-sheet
 */

import "./effort-picker-sheet.css";

import React, { useCallback, useMemo, useState } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import {
  DEFAULT_EFFORT_LEVEL,
  formatEffortLabel,
  resolveEffortSupport,
} from "@/lib/effort";

/**
 * Brief description per level, shown as the option's subtitle — paraphrasing
 * claude's `/effort` framing ("controls how long Claude thinks before
 * answering"). Presentational copy, so it lives here rather than in the pure
 * `lib/effort.ts`.
 */
const EFFORT_SUBTITLES: Record<string, string> = {
  low: "Quick edits and simple tasks",
  medium: "Balanced thinking",
  high: "Tricky bugs and harder tasks",
  xhigh: "The hardest problems",
  max: "Maximum thinking budget",
};

// ---------------------------------------------------------------------------
// useEffortPicker — the shared, card-hosted effort sheet
// ---------------------------------------------------------------------------

/** Args for {@link useEffortPicker}. */
export interface UseEffortPickerArgs {
  /** Metadata store supplying the active model's supported levels + current. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Apply the chosen level — wired by the dev card to {@link useEffort}'s
   * `setEffort`, which reflects it optimistically, persists it per card, and
   * sends the `effort_change` frame.
   */
  onSelectEffort: (effort: string) => void;
  /**
   * The card's shared sheet host (`useTugSheet().showSheet`). Routing every
   * card picker through one host means opening this picker replaces any other
   * open picker instead of stacking a second sheet.
   */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
  /**
   * What a committed pick does to an enclosing focus cycle ([P15]) — forwarded
   * to the sheet. `"relinquish"` exits cycling (caret to the prompt); `"retain"`
   * keeps cycling (ring back on the chip). Default `"retain"`.
   */
  commitDisposition?: "retain" | "relinquish";
}

/** Imperative handle to the card-hosted effort picker sheet. */
export interface EffortPickerController {
  /** Present the sheet, resolving supported levels + current at open time. */
  openEffortPicker: () => void;
}

/**
 * Own the effort picker sheet once, at the card level, so the chip press and a
 * future `/effort` slash command present the *same* sheet ([#step-4]). The
 * level list is read fresh from the store at open time ([L07]).
 */
export function useEffortPicker({
  sessionMetadataStore,
  onSelectEffort,
  showSheet,
  commitDisposition,
}: UseEffortPickerArgs): EffortPickerController {
  const openEffortPicker = useCallback(() => {
    const snapshot = sessionMetadataStore.getSnapshot();
    const { levels } = resolveEffortSupport(snapshot.models, snapshot.model);
    // No levels ⇒ the chip would be hidden; defensively no-op rather than
    // present an empty sheet.
    if (levels.length === 0) return;
    // Mark the explicit override if set, else the effective default the chip
    // shows — so the sheet opens with the current level checkmarked, not blank.
    const activeValue = snapshot.effort ?? DEFAULT_EFFORT_LEVEL;
    void showSheet({
      title: "Reasoning Effort",
      description: "Choose how long Claude thinks before answering.",
      onCommitDisposition: commitDisposition,
      content: (close) => (
        <EffortPickerSheetBody
          levels={levels}
          activeValue={activeValue}
          onConfirm={(picked) => {
            if (picked !== null && picked !== activeValue) {
              onSelectEffort(picked);
            }
            close(picked ?? undefined);
          }}
          onCancel={() => close()}
        />
      ),
    });
  }, [showSheet, sessionMetadataStore, onSelectEffort, commitDisposition]);

  return { openEffortPicker };
}

// ---------------------------------------------------------------------------
// Picker sheet body — a TugListView of effort levels
// ---------------------------------------------------------------------------

/**
 * The level marked active when the sheet opened, published to the cell
 * renderers so the matching row paints selected. `onPick` lives on the
 * delegate, so the context carries only the read-only "which row is current".
 */
const EffortPickerListContext = React.createContext<string | null>(null);

/**
 * Static, single-section data source over the supported level list. The set is
 * fixed for a sheet's lifetime, so `subscribe` is a no-op and `getVersion` a
 * stable constant.
 */
class EffortPickerDataSource implements TugListViewDataSource {
  private readonly levels: readonly string[];

  constructor(levels: readonly string[]) {
    this.levels = levels;
  }

  numberOfItems(): number {
    return this.levels.length;
  }

  idForIndex(index: number): string {
    return this.levels[index];
  }

  kindForIndex(): string {
    return "effort";
  }

  /** Cell-renderer accessor — the level string at `index`. */
  levelAt(index: number): string {
    return this.levels[index];
  }

  subscribe(): () => void {
    return () => {};
  }

  getVersion(): unknown {
    return 0;
  }
}

/**
 * One effort-level row. A flush `TugListRow` whose title is the formatted level
 * label over a brief description; the row paints selected (with a leading
 * checkmark) when its level matches the sheet-open-time current level.
 * `selectedGlyph="check"` reserves the fixed-width check column on every row —
 * empty when unselected — so the titles align whether or not a row carries the
 * mark.
 */
const EffortPickerCell: TugListViewCellRenderer<EffortPickerDataSource> =
  function EffortPickerCell({
    index,
    dataSource,
  }: TugListViewCellProps<EffortPickerDataSource>): React.ReactElement {
    const activeValue = React.useContext(EffortPickerListContext);
    const level = dataSource.levelAt(index);
    const selected = level === activeValue;
    return (
      <TugListRow
        title={formatEffortLabel(level)}
        subtitle={EFFORT_SUBTITLES[level]}
        selected={selected}
        selectedGlyph="check"
        data-effort={level}
      />
    );
  };

const EFFORT_PICKER_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<EffortPickerDataSource>
> = {
  effort: EffortPickerCell,
};

interface EffortPickerSheetBodyProps {
  /** The supported levels to render, in canonical order. */
  levels: string[];
  /** The level marked selected when the sheet opened (`null` if none). */
  activeValue: string | null;
  /** Commit the chosen level (no-op if unchanged) and dismiss — OK / Enter. */
  onConfirm: (value: string | null) => void;
  /** Dismiss without changing the level — Cancel / Escape / Cmd-. */
  onCancel: () => void;
}

/**
 * The effort-level sheet body: a `TugListView` of level rows above a
 * Cancel / OK action row. Clicking a row only moves the in-sheet selection;
 * nothing commits until OK (or Enter). Cancel / Escape / Cmd-. dismiss with no
 * change — a confirm-style dialog, not a pick-to-apply menu (mirrors the model
 * picker, since each commit triggers a respawn).
 */
function EffortPickerSheetBody({
  levels,
  activeValue,
  onConfirm,
  onCancel,
}: EffortPickerSheetBodyProps): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(activeValue);
  const dataSource = useMemo(() => new EffortPickerDataSource(levels), [levels]);
  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => setSelected(levels[index]),
    }),
    [levels],
  );

  // Author the sheet's controls into its trapped focus mode (TugSheet pushes it;
  // FocusModeScope wraps the body): Tab walks list → Cancel → OK. Single-select
  // picker: the engine seeds the key view onto the LIST (arrows move + select the
  // row immediately), and OK keeps its ring the whole time (`persistentDefaultRing`)
  // as the sole Return consumer — Return falls through the list to OK.
  const focusGroup = React.useId();
  const LIST_ORDER = 0;
  const CANCEL_ORDER = 1;
  const OK_ORDER = 2;
  useSeedKeyView(`${focusGroup}:${LIST_ORDER}`);
  // Open the cursor on the active level so arrows start from the current choice.
  const activeIndex = activeValue === null ? -1 : levels.indexOf(activeValue);

  const confirm = (): void => onConfirm(selected);

  return (
    <div className="effort-picker-sheet">
      <EffortPickerListContext.Provider value={selected}>
        <div className="effort-picker-sheet-list">
          <TugListView<EffortPickerDataSource>
            dataSource={dataSource}
            delegate={delegate}
            cellRenderers={EFFORT_PICKER_CELL_RENDERERS}
            rowLayout="flush"
            inline
            className="effort-picker-list"
            focusGroup={focusGroup}
            focusOrder={LIST_ORDER}
            singleSelect
            initialSelectedIndex={activeIndex}
          />
        </div>
      </EffortPickerListContext.Provider>
      <div className="tug-sheet-actions">
        <TugPushButton
          data-slot="effort-picker-cancel"
          emphasis="outlined"
          role="action"
          onClick={onCancel}
          focusGroup={focusGroup}
          focusOrder={CANCEL_ORDER}
        >
          Cancel
        </TugPushButton>
        <TugPushButton
          data-slot="effort-picker-ok"
          emphasis="primary"
          onClick={confirm}
          focusGroup={focusGroup}
          focusOrder={OK_ORDER}
          persistentDefaultRing
        >
          OK
        </TugPushButton>
      </div>
    </div>
  );
}
