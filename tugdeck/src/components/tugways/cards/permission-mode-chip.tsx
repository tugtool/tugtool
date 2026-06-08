/**
 * `PermissionModeChip` — the Z4B permission-mode control chip.
 *
 * A two-line `TugPushButton` (`label-top` / `size="sm"` / `outlined` `agent`)
 * carrying an uppercase `/PERMISSIONS` caption (the slash command the user
 * would type) over the session's current permission-mode label. No icon — the
 * value stays centered in the chip. Sized and
 * tinted to family with the neighbor two-line `sm` `agent` badges (Project,
 * Session) — the unified two-line scale lands `sm` at the same height. Pushing it opens a `TugSheet` whose behavior options
 * ([PERMISSION_MODE_MENU]) live in a `TugListView`; picking one calls
 * `onSelectMode`. The `Shift+Tab` cycle (handled on the dev card's
 * card-content responder) and the `/permissions` slash command remain the
 * other two ways to change the mode; all three funnel through the dev card's
 * single `setMode`.
 *
 * Data sources ([L02] — external state enters through `useSyncExternalStore`
 * only):
 *  - live mode from `SessionMetadataStore.permissionMode` (the authority;
 *    updated by the post-mutation `system_metadata` round-trip);
 *  - per-card persisted mode from tugbank `dev.permission-mode.<cardId>`,
 *    read as the pre-population fallback so the chip shows the prior mode
 *    immediately on card relaunch, before the live metadata lands ([D07]).
 *
 * Compositional component — composes `TugPushButton`, `TugSheet`, and
 * `TugListView`; its only own CSS is the value-line width-stabilizer and the
 * sheet's option-list layout. The composed children keep their own tokens
 * [L20].
 *
 * Laws: [L02] store subscription, [L06] no React state for appearance,
 *       [L19] authoring guide, [L20] composed children keep own tokens
 * Decisions: [D04] SessionMetadataStore hub, [D07] per-card persistence
 *
 * @module components/tugways/cards/permission-mode-chip
 */

import "./permission-mode-chip.css";

import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
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
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  PERMISSION_MODE_DOMAIN,
  PERMISSION_MODE_MENU,
  formatPermissionMode,
  isPermissionMode,
  parsePersistedPermissionMode,
} from "@/lib/permission-mode";
import type { PermissionMode } from "@tugproto/inbound";

export interface PermissionModeChipProps {
  /** The card whose binding's permission mode the chip persists / restores. */
  cardId: string;
  /** Metadata store supplying the live `permissionMode`. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Open the shared permission sheet. Wired by the dev card to the single
   * opener from {@link usePermissionSheet} — the same opener the `/permissions`
   * slash command routes to, so the chip and the command present one sheet.
   */
  onOpenSheet: () => void;
  /** Dim + disable the chip (e.g. on the Shell route, where permission mode
   *  is inapplicable). Forwarded to the composed {@link TugPushButton}. */
  disabled?: boolean;
  /** Author the chip into a focus group ([P02]) — forwarded to the composed
   *  {@link TugPushButton}. The dev card passes its cycle group so the chip
   *  becomes a keyboard-focus-cycling stop; omitted elsewhere. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

/**
 * Display-only Z4B chip: a two-line `TugPushButton` showing the session's
 * current permission mode under a `/PERMISSIONS` caption. The chip owns no
 * sheet — clicking it calls `onOpenSheet`, the shared opener the dev card
 * also routes the `/permissions` slash command to ([#step-1c]).
 */
export function PermissionModeChip({
  cardId,
  sessionMetadataStore,
  onOpenSheet,
  disabled,
  focusGroup,
  focusOrder,
}: PermissionModeChipProps): React.ReactElement {
  const liveMode = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    useCallback(
      () => sessionMetadataStore.getSnapshot().permissionMode,
      [sessionMetadataStore],
    ),
  );

  // Per-card persisted mode — the pre-population fallback before the live
  // `system_metadata` round-trips on a fresh card mount ([D07]). [L02].
  const persistedMode = useTugbankValue<string | null>(
    PERMISSION_MODE_DOMAIN,
    cardId,
    parsePersistedPermissionMode,
    null,
  );

  // Absent live metadata and a persisted override, the session is in
  // `default` (what tugcode spawns with) — show that, not a "…" loading
  // dash, so a fresh session reads `Default` and the sheet checkmarks it.
  const mode = liveMode ?? persistedMode ?? "default";

  return (
    <TugPushButton
      layout="label-top"
      label="Mode"
      size="sm"
      emphasis="tinted"
      role="agent"
      data-slot="permission-mode-chip"
      aria-label="Permission mode"
      title={
        mode === null
          ? undefined
          : `Permission mode: ${formatPermissionMode(mode)}`
      }
      disabled={disabled}
      focusGroup={focusGroup}
      focusOrder={focusOrder}
      onClick={onOpenSheet}
    >
      {/* Width-stabilized value: the shown label plus a hidden sizer per menu
          mode reserve the widest label ("Accept Edits") so cycling the mode
          never reflows the chip ([R01]). A live value wider than any sizer
          still fits — the active face is a real layout item. */}
      <TugStableOverlay
        data-slot="permission-mode-value"
        active={formatPermissionMode(mode)}
        alternates={PERMISSION_MODE_MENU.map((m) => formatPermissionMode(m))}
      />
    </TugPushButton>
  );
}

// ---------------------------------------------------------------------------
// usePermissionSheet — the shared, card-hosted permission sheet
// ---------------------------------------------------------------------------

/** Args for {@link usePermissionSheet}. */
export interface UsePermissionSheetArgs {
  /** Card whose persisted mode pre-populates the sheet's selection. */
  cardId: string;
  /** Metadata store supplying the authoritative live `permissionMode`. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Called with the chosen mode when the user picks one. Wired by the dev
   * card to `usePermissionMode().setMode`, which sends the `permission_mode`
   * frame, optimistically reflects the mode, and persists it per card.
   */
  onSelectMode: (mode: PermissionMode) => void;
  /**
   * The card's shared sheet host (`useTugSheet().showSheet`). Routing every
   * card picker through one host means opening this sheet replaces any other
   * open picker instead of stacking a second sheet.
   */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

/** Imperative handle to the card-hosted permission sheet. */
export interface PermissionSheetController {
  /** Present the sheet, marking the current mode. */
  openPermissionSheet: () => void;
}

/**
 * Own the permission sheet once, at the card level, so the chip click and the
 * `/permissions` slash command present the *same* sheet ([#step-1c]). The dev
 * card calls this hook, passes `openPermissionSheet` to the chip's
 * `onOpenSheet` and to its `RUN_SLASH_COMMAND` handler, and renders
 * `renderPermissionSheet` in its content region (card-scoped per [D15]).
 *
 * The current mode is read fresh from the store at open time ([L07]), falling
 * back to the per-card persisted value before the first `system_metadata`
 * lands.
 */
export function usePermissionSheet({
  cardId,
  sessionMetadataStore,
  onSelectMode,
  showSheet,
}: UsePermissionSheetArgs): PermissionSheetController {
  const persistedMode = useTugbankValue<string | null>(
    PERMISSION_MODE_DOMAIN,
    cardId,
    parsePersistedPermissionMode,
    null,
  );

  const openPermissionSheet = useCallback(() => {
    const mode =
      sessionMetadataStore.getSnapshot().permissionMode ?? persistedMode ?? "default";
    void showSheet({
      title: "Permission Mode",
      description: "Choose how Claude handles file edits and commands.",
      content: (close) => (
        <PermissionModeSheetBody
          currentMode={mode}
          onConfirm={(picked) => {
            if (picked !== null && picked !== mode) {
              onSelectMode(picked);
            }
            close(picked ?? undefined);
          }}
          onCancel={() => close()}
        />
      ),
    });
  }, [showSheet, sessionMetadataStore, persistedMode, onSelectMode]);

  return { openPermissionSheet };
}

// ---------------------------------------------------------------------------
// Behavior sheet — a TugListView of mode options
// ---------------------------------------------------------------------------

/**
 * Brief description of each permission mode, shown as the option's subtitle.
 * Wording tracks the Claude Code Agent SDK permission-mode docs
 * (code.claude.com/docs → Configure permissions): `default` prompts;
 * `acceptEdits` auto-approves file edits; `plan` is read-only; `auto` uses a
 * model classifier per call; `bypassPermissions` skips prompts.
 */
const PERMISSION_MODE_SUBTITLES: Record<string, string> = {
  default: "Prompts before edits and commands",
  acceptEdits: "Auto-approves file edits",
  plan: "Read-only; plans without changes",
  auto: "Model approves or denies each call",
  bypassPermissions: "Runs all tools without prompts",
};

/**
 * The mode currently active when the sheet opened, published to the cell
 * renderers so the matching row paints selected. `onPick` lives on the
 * delegate (in scope where the sheet is built), so the context only carries
 * the read-only "which row is current" flag.
 */
const PermissionModeListContext = React.createContext<string | null>(null);

/**
 * Static, single-section data source over [PERMISSION_MODE_MENU]. The mode set
 * never changes during a sheet's lifetime, so `subscribe` is a no-op and
 * `getVersion` is a stable constant.
 */
class PermissionModeDataSource implements TugListViewDataSource {
  private readonly modes: readonly PermissionMode[];

  constructor(modes: readonly PermissionMode[]) {
    this.modes = modes;
  }

  numberOfItems(): number {
    return this.modes.length;
  }

  idForIndex(index: number): string {
    return this.modes[index];
  }

  kindForIndex(): string {
    return "mode";
  }

  /** Cell-renderer accessor — the mode at `index`. */
  modeAt(index: number): PermissionMode {
    return this.modes[index];
  }

  subscribe(): () => void {
    return () => {};
  }

  getVersion(): unknown {
    return 0;
  }
}

/**
 * One behavior-option row. A flush `TugListRow` whose title is the formatted
 * mode label over a brief description; `selectedGlyph="check"` reserves the
 * fixed-width check column on every row — showing the mark when its mode
 * matches the sheet-open-time current mode, empty otherwise so the titles
 * align. Presentational — activation is the enclosing `TugListView` cell
 * wrapper's job (it fires `delegate.onSelect`).
 */
const PermissionModeCell: TugListViewCellRenderer<PermissionModeDataSource> =
  function PermissionModeCell({
    index,
    dataSource,
  }: TugListViewCellProps<PermissionModeDataSource>): React.ReactElement {
    const currentMode = React.useContext(PermissionModeListContext);
    const mode = dataSource.modeAt(index);
    const selected = mode === currentMode;
    return (
      <TugListRow
        title={formatPermissionMode(mode)}
        subtitle={PERMISSION_MODE_SUBTITLES[mode]}
        selected={selected}
        selectedGlyph="check"
        data-mode={mode}
      />
    );
  };

const PERMISSION_MODE_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<PermissionModeDataSource>
> = {
  mode: PermissionModeCell,
};

interface PermissionModeSheetBodyProps {
  /**
   * The live mode marked as selected when the sheet opened (`null` if unknown).
   * Loose `string` — it seeds from claude's reported mode, which the chip
   * displays tolerantly; an unknown value just leaves no row pre-selected.
   */
  currentMode: string | null;
  /** Commit the chosen mode (no-op if unchanged) and dismiss — OK / Enter. */
  onConfirm: (mode: PermissionMode | null) => void;
  /** Dismiss without changing the mode — Cancel / Escape / Cmd-. */
  onCancel: () => void;
}

/**
 * The behavior-options sheet body: a `TugListView` of mode rows above a Done
 * button. The list is `inline` (every row rendered, no windowing) and
 * `flush` so the rows read as one stacked group with the current mode
 * highlighted. Clicking a row fires the delegate's `onSelect`, which picks
 * that mode and closes the sheet.
 *
 * The list view is the keyboard-ready substrate: when component keyboard
 * navigation lands, arrowing + Enter through these rows will choose a mode
 * with no extra wiring here.
 */
function PermissionModeSheetBody({
  currentMode,
  onConfirm,
  onCancel,
}: PermissionModeSheetBodyProps): React.ReactElement {
  // In-sheet selection — clicking a row moves the checkmark; nothing commits
  // until OK (or Enter). Cancel / Escape leave the mode unchanged. Seed from
  // the live mode only when it's a real mode (an unknown live value leaves no
  // pre-selection rather than seeding a non-selectable string).
  const [selected, setSelected] = useState<PermissionMode | null>(
    currentMode !== null && isPermissionMode(currentMode) ? currentMode : null,
  );
  const dataSource = useMemo(
    () => new PermissionModeDataSource(PERMISSION_MODE_MENU),
    [],
  );
  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => setSelected(PERMISSION_MODE_MENU[index]),
    }),
    [],
  );

  // Author the controls into the sheet's trapped focus mode: Tab walks
  // list → Cancel → OK. Single-select picker: the list is seeded as the key
  // view (arrows move + select immediately), and OK keeps its ring the whole
  // time (`persistentDefaultRing`) — Return falls through the list to OK.
  const focusGroup = React.useId();
  const LIST_ORDER = 0;
  const CANCEL_ORDER = 1;
  const OK_ORDER = 2;
  useSeedKeyView(`${focusGroup}:${LIST_ORDER}`);
  // Open the cursor on the active mode so arrows start from the current choice.
  const activeIndex =
    selected === null
      ? -1
      : (PERMISSION_MODE_MENU as readonly PermissionMode[]).indexOf(selected);

  const confirm = (): void => onConfirm(selected);

  return (
    <div className="permission-mode-sheet">
      <PermissionModeListContext.Provider value={selected}>
        <div className="permission-mode-sheet-list">
          <TugListView<PermissionModeDataSource>
            dataSource={dataSource}
            delegate={delegate}
            cellRenderers={PERMISSION_MODE_CELL_RENDERERS}
            rowLayout="flush"
            inline
            className="permission-mode-list"
            focusGroup={focusGroup}
            focusOrder={LIST_ORDER}
            singleSelect
            initialSelectedIndex={activeIndex}
          />
        </div>
      </PermissionModeListContext.Provider>
      <div className="tug-sheet-actions">
        <TugPushButton
          emphasis="outlined"
          role="action"
          onClick={onCancel}
          data-testid="permission-mode-cancel"
          focusGroup={focusGroup}
          focusOrder={CANCEL_ORDER}
        >
          Cancel
        </TugPushButton>
        <TugPushButton
          emphasis="primary"
          onClick={confirm}
          data-testid="permission-mode-ok"
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
