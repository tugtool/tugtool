/**
 * settings-keymap-body.tsx — the Keyboard settings panel.
 *
 * Every command Tug can perform, what it is bound to, and — for the ones that
 * are the user's to change — a way to change it. The pane exists because the
 * keymap finally is data: one table states every command's chord, both the
 * web layer and the menu bar are derived from it, and a rebind is a write
 * that both sides read.
 *
 * ## Why a row says more than its chord
 *
 * A chord can be bound and still never fire. AppKit resolves a menu item's
 * key equivalent before the web view sees a keydown, so a menu-eligible chord
 * preempts every scoped binding regardless of focus ([P15]); below that, a
 * focus mode beats a responder beats the global layer ([P08]). A row that
 * printed "⌘1" without saying "the Window menu takes this first" would be
 * confidently wrong in the one surface whose entire job is to be believed.
 * So each binding renders its own standing — live, or shadowed and by what —
 * from `resolveChord`, and the pending chord is resolved *before* it is
 * committed, so a collision is something the user reads rather than
 * discovers.
 *
 * ## What the pane will not let you do
 *
 * Locked rows ([P12]) render without a capture affordance: the mechanism
 * could rebind ⌘Q, the policy says no, and a row that offered the gesture and
 * then refused it would be worse than one that never offered. Scoped rows are
 * shown with their scope named and read-only ([Q03]) — a scoped default lives
 * in a component's render, so an override has to be reconciled at
 * registration time and that machinery waits until it is wanted.
 *
 * Laws: [L02] the override store and the keymap registry enter React through
 * `useSyncExternalStore`; [L03] the capture surface's focus trap is pushed in
 * a layout effect (via `useFocusTrap`); [L06] the armed affordance is CSS on a
 * data attribute, never a second render path; [L19]/[L20] every row composes
 * real Tug primitives — `TugListView`, `TugListRow`, `TugIconButton`,
 * `TugAlert` — and hand-rolls no list, no focus, and no dialog.
 *
 * @module components/tugways/cards/settings-keymap-body
 */

import "./settings-keymap-body.css";

import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Keyboard, Lock, RotateCcw, X } from "lucide-react";

import { chordFromEvent, chordHasKeyEquivalent, formatChord } from "../chord-format";
import { chordCaptureState } from "../chord-capture-state";
import type { Chord } from "../command-registry";
import { COMMANDS_BY_ID } from "../command-registry";
import { keymapRegistry } from "../keymap-registry";
import { keymapOverrideStore } from "@/keymap-override-store";
import { TugFilterField, type TugFilterFieldDelegate } from "../tug-filter-field";
import { TugIconButton } from "../tug-icon-button";
import { TugLabel } from "../tug-label";
import { TugListRow } from "../tug-list-row";
import { TugListView } from "../tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDataSource,
  TugListViewDelegate,
} from "../tug-list-view";
import { TugAlert, type TugAlertHandle } from "../tug-alert";
import { TugPushButton } from "../tug-push-button";
import { useFocusTrap } from "../use-focus-trap";
import {
  buildKeymapListItems,
  buildKeymapRows,
  type KeymapListItem,
  type KeymapRow,
  type KeymapRowBinding,
} from "./settings-keymap-rows";

/* ---------------------------------------------------------------------------
 * Data source
 * ------------------------------------------------------------------------- */

/**
 * The pane's `TugListView` data source. Rows are rebuilt whenever the keymap
 * or the filter changes; the source is one stable instance that swaps its
 * projection, so the list reconciles rather than remounting ([L26]).
 */
class KeymapDataSource implements TugListViewDataSource {
  private items: readonly KeymapListItem[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  numberOfItems(): number {
    return this.items.length;
  }

  idForIndex(index: number): string {
    return this.items[index].id;
  }

  kindForIndex(index: number): string {
    return this.items[index].kind;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): unknown {
    return this.version;
  }

  itemAt(index: number): KeymapListItem {
    return this.items[index];
  }

  setItemsWithoutNotify(next: readonly KeymapListItem[]): boolean {
    if (this.items === next) return false;
    this.items = next;
    this.version += 1;
    return true;
  }

  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }
}

/* ---------------------------------------------------------------------------
 * Chord capture
 * ------------------------------------------------------------------------- */

/** Modifier keys pressed alone, which are a chord in progress, not a chord. */
const MODIFIER_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "CapsLock",
]);

/**
 * What a pending chord would displace, in one sentence.
 *
 * `resolveChord` is asked *before* the binding is committed, which is the
 * whole point: a collision the user reads is a decision, and a collision they
 * discover by pressing the keys is a bug report.
 */
function conflictNoteFor(chord: Chord, commandId: string): string | null {
  const stack = keymapRegistry.resolveChord(chord);
  const winner = stack.find((r) => r.active && r.commandId !== commandId);
  if (winner === undefined) {
    const eaten = stack.find(
      (r) =>
        r.layer.kind === "native" &&
        r.layer.claims &&
        !r.layer.enabled &&
        r.commandId !== commandId,
    );
    if (eaten === undefined) return null;
    const title = COMMANDS_BY_ID.get(eaten.commandId)?.title ?? eaten.commandId;
    return `${title} holds this chord on a menu item; while that item is disabled the chord reaches nothing at all.`;
  }
  const title = COMMANDS_BY_ID.get(winner.commandId)?.title ?? winner.commandId;
  return winner.layer.kind === "native"
    ? `${title} has this chord on a menu item, which takes it before the web view sees it.`
    : `${title} already has this chord and would take it first.`;
}

/**
 * A recordable chord carries a real modifier or is a function key. Bare `K`
 * would fire on every keystroke everywhere; shift alone is a capital letter.
 */
function isRecordableChord(chord: Chord): boolean {
  if (chord.meta === true || chord.ctrl === true || chord.alt === true) return true;
  return /^F\d{1,2}$/.test(chord.key);
}

/**
 * The armed capture surface: it owns every chord while it is up.
 *
 * Three layers have to yield for that to be true rather than aspirational,
 * and arming (`chordCaptureState`) is what makes them. The key pipeline's
 * stage-1 listener stands down, so a chord that currently means something is
 * read instead of dispatched. The host parks every menu key equivalent for
 * the span (the `captureArmed` push field), so AppKit's key-equivalent scan
 * — which runs before the web view sees a keydown — lets ⌘W through to be
 * recorded instead of closing the card. And the focus trap holds the
 * keyboard focus story, with Escape as the cancel.
 */
function ChordCapture({
  commandId,
  onCommit,
  onCancel,
}: {
  commandId: string;
  onCommit: (chord: Chord) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [pending, setPending] = useState<Chord | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useFocusTrap({
    active: true,
    onEscapeDismiss: () => onCancelRef.current(),
  });

  useLayoutEffect(() => {
    const release = chordCaptureState.arm();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (MODIFIER_CODES.has(event.code)) return;
      // Nothing else may act on this key: the surface is here to read the
      // chord, and a chord that fires its old command on the way to being
      // recorded is the failure this whole capture exists to avoid.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        onCancelRef.current();
        return;
      }
      setPending(chordFromEvent(event));
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      release();
    };
  }, []);

  const recordable = pending !== null && isRecordableChord(pending);
  const note =
    pending === null
      ? null
      : !recordable
        ? "Add ⌘, ⌃, or ⌥ — a bare key would fire while typing."
        : (conflictNoteFor(pending, commandId) ??
          (!chordHasKeyEquivalent(pending)
            ? "This key has no menu-bar form; the chord works in Tug but no menu item will show it."
            : null));

  return (
    <div className="settings-keymap-capture" ref={hostRef} data-testid="keymap-capture">
      <div className="settings-keymap-capture-chord" data-pending={pending !== null}>
        {pending === null ? "Press a chord…" : formatChord(pending)}
      </div>
      {note !== null ? (
        <TugLabel size="sm" emphasis="calm" className="settings-keymap-capture-note">
          {note}
        </TugLabel>
      ) : null}
      <div className="settings-keymap-capture-actions">
        <TugPushButton
          size="sm"
          role="accent"
          emphasis="filled"
          disabled={!recordable}
          onClick={() => {
            if (recordable) onCommit(pending);
          }}
        >
          Use this chord
        </TugPushButton>
        <TugPushButton size="sm" onClick={onCancel}>
          Cancel
        </TugPushButton>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Rows
 * ------------------------------------------------------------------------- */

/** The standing of one binding, said plainly. */
function bindingNote(binding: KeymapRowBinding): string | null {
  if (binding.scoped) {
    const scope = binding.binding.scope;
    const where = scope.kind === "mode" ? scope.modeId : scope.kind === "responder" ? scope.responderId : "";
    return `only in ${where}`;
  }
  if (binding.active) return null;
  const shadower = binding.shadowedBy;
  if (shadower === undefined) return "not reachable right now";
  const title = COMMANDS_BY_ID.get(shadower.commandId)?.title ?? shadower.commandId;
  return `shadowed by ${title}`;
}

/** Everything a cell needs that is not the index — the pane's own handlers. */
interface KeymapCellContext {
  armed: string | null;
  arm(commandId: string): void;
  cancel(): void;
  commit(commandId: string, chord: Chord): void;
  reset(commandId: string): void;
  removeBinding(commandId: string, index: number): void;
}

const KeymapCellContextValue = React.createContext<KeymapCellContext | null>(null);

function GroupCell({ index, dataSource }: TugListViewCellProps<KeymapDataSource>) {
  const item = dataSource.itemAt(index);
  if (item.kind !== "group") return null;
  return (
    <div className="settings-keymap-group" data-testid="keymap-group">
      <TugLabel size="sm" emphasis="calm">
        {item.title}
      </TugLabel>
    </div>
  );
}

function CommandCell({ index, dataSource, selected }: TugListViewCellProps<KeymapDataSource>) {
  const item = dataSource.itemAt(index);
  const ctx = React.useContext(KeymapCellContextValue);
  if (item.kind !== "command" || ctx === null) return null;
  const row: KeymapRow = item.row;
  const armed = ctx.armed === row.commandId;
  // A locked row shows why rather than merely lacking a button: "you cannot
  // change this" is information, and an affordance that silently is not there
  // reads as a bug. An *empty* row is rebindable — giving an unbound command
  // a chord is one of the pane's jobs, and it is also the way back after
  // removing a command's only binding.
  const rebindable =
    !row.locked && (row.bindings.length === 0 || !row.bindings.every((b) => b.scoped));

  return (
    <TugListRow
      selected={selected}
      title={row.title}
      data-testid={`keymap-row-${row.commandId}`}
      data-overridden={row.overridden ? "" : undefined}
      trailing={
        <div className="settings-keymap-trailing">
          {row.bindings.length === 0 ? (
            <TugLabel size="sm" emphasis="calm" className="settings-keymap-unbound">
              Not bound
            </TugLabel>
          ) : (
            row.bindings.map((binding, i) => {
              const note = bindingNote(binding);
              return (
                <span
                  key={`${binding.label}:${i}`}
                  className="settings-keymap-chord"
                  data-active={binding.active ? "" : undefined}
                  data-shadowed={binding.active ? undefined : ""}
                  title={note ?? undefined}
                >
                  <span className="settings-keymap-chord-label">{binding.label}</span>
                  {note !== null ? (
                    <span className="settings-keymap-chord-note">{note}</span>
                  ) : null}
                  {rebindable && !binding.scoped ? (
                    <TugIconButton
                      size="xs"
                      aria-label={`Remove ${binding.label} from ${row.title}`}
                      icon={<X aria-hidden="true" />}
                      onClick={() => ctx.removeBinding(row.commandId, i)}
                    />
                  ) : null}
                </span>
              );
            })
          )}
          {row.locked ? (
            <span className="settings-keymap-locked" title="Reserved by macOS convention">
              <Lock size={12} aria-hidden="true" />
            </span>
          ) : null}
          {rebindable ? (
            <TugPushButton
              size="sm"
              emphasis={armed ? "filled" : "outlined"}
              role="accent"
              aria-pressed={armed || undefined}
              data-testid={`keymap-arm-${row.commandId}`}
              widthStabilize={{ alternateLabel: armed ? "Change" : "Recording…" }}
              onClick={() => (armed ? ctx.cancel() : ctx.arm(row.commandId))}
            >
              {armed ? "Recording…" : "Change"}
            </TugPushButton>
          ) : null}
          {row.overridden ? (
            <TugIconButton
              size="xs"
              aria-label={`Reset ${row.title} to its default chord`}
              icon={<RotateCcw aria-hidden="true" />}
              onClick={() => ctx.reset(row.commandId)}
            />
          ) : null}
        </div>
      }
    >
      <div className="settings-keymap-row-body">
        <TugLabel size="md">{row.title}</TugLabel>
        {armed ? (
          <ChordCapture
            commandId={row.commandId}
            onCommit={(chord) => ctx.commit(row.commandId, chord)}
            onCancel={ctx.cancel}
          />
        ) : null}
      </div>
    </TugListRow>
  );
}

const CELL_RENDERERS: Record<string, TugListViewCellRenderer<KeymapDataSource>> = {
  group: GroupCell,
  command: CommandCell,
};

/* ---------------------------------------------------------------------------
 * The pane
 * ------------------------------------------------------------------------- */

export function SettingsKeymapBody(): React.ReactElement {
  // The two stores whose changes have to repaint a row: the keymap registry
  // (a binding moved) and the override store (a command gained or lost one).
  useSyncExternalStore(keymapRegistry.subscribe, keymapRegistry.getSnapshot, () => 0);
  useSyncExternalStore(
    keymapOverrideStore.subscribe,
    keymapOverrideStore.getSnapshot,
    () => 0,
  );

  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const alertRef = useRef<TugAlertHandle>(null);
  const focusGroup = useId();

  const overridden = useMemo(
    () => new Set(keymapOverrideStore.overriddenCommands()),
    // Recomputed on every render: the store's version is already a
    // subscription above, and the set is thirty strings at the outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keymapOverrideStore.getSnapshot()],
  );
  const rows = useMemo(
    () => buildKeymapRows(overridden),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overridden, keymapRegistry.getSnapshot()],
  );
  const items = useMemo(() => buildKeymapListItems(rows, query), [rows, query]);

  const dataSource = useRef<KeymapDataSource>(null as unknown as KeymapDataSource);
  if (dataSource.current === null) dataSource.current = new KeymapDataSource();
  const changed = dataSource.current.setItemsWithoutNotify(items);
  useLayoutEffect(() => {
    if (changed) dataSource.current.notifyAll();
  });

  const ctx = useMemo<KeymapCellContext>(
    () => ({
      armed,
      arm: (commandId) => setArmed(commandId),
      cancel: () => setArmed(null),
      commit: (commandId, chord) => {
        // Replace rather than append: a rebind is "this is the chord", and a
        // pane that quietly accumulated bindings would leave the user with a
        // keymap they never asked for and no obvious way back.
        keymapOverrideStore.set(commandId, [
          { chord, scope: { kind: "global" }, source: "user", preventDefault: true },
        ]);
        setArmed(null);
      },
      reset: (commandId) => keymapOverrideStore.reset(commandId),
      removeBinding: (commandId, index) => {
        const next = keymapRegistry
          .bindingsOf(commandId)
          .filter((_binding, i) => i !== index)
          .map((b) => ({ ...b, source: "user" as const }));
        keymapOverrideStore.set(commandId, next);
      },
    }),
    [armed],
  );

  const filterDelegate = useMemo<TugFilterFieldDelegate>(
    () => ({ filterFieldDidChangeQuery: setQuery }),
    [],
  );

  const delegate = useMemo<TugListViewDelegate>(
    () => ({ estimatedHeightForKind: (kind) => (kind === "group" ? 28 : 44) }),
    [],
  );

  const resetAll = useCallback(() => {
    void alertRef.current
      ?.alert({
        title: "Reset every keyboard shortcut?",
        message:
          "Every command goes back to the chord it ships with. Shortcuts you have not changed are unaffected.",
        confirmLabel: "Reset All",
        confirmRole: "danger",
        cancelLabel: "Cancel",
      })
      .then((confirmed) => {
        if (confirmed) keymapOverrideStore.resetAll();
      });
  }, []);

  return (
    <div className="settings-keymap" data-testid="settings-keymap">
      <div className="settings-keymap-toolbar">
        <TugFilterField
          delegate={filterDelegate}
          placeholder="Filter commands"
          fill
          focusGroup={focusGroup}
          focusOrder={0}
          data-testid="settings-keymap-filter"
        />
        <TugPushButton
          size="sm"
          role="danger"
          disabled={overridden.size === 0}
          data-testid="settings-keymap-reset-all"
          onClick={resetAll}
        >
          Reset All
        </TugPushButton>
      </div>
      <div className="settings-keymap-list">
        <KeymapCellContextValue.Provider value={ctx}>
          <TugListView<KeymapDataSource>
            dataSource={dataSource.current}
            delegate={delegate}
            cellRenderers={CELL_RENDERERS}
            scrollKey="settings-keymap"
            rowLayout="flush"
            rowDensity="compact"
            singleSelect
            focusGroup={focusGroup}
            focusOrder={1}
            listRole="list"
            itemRole="listitem"
            inline
          />
        </KeymapCellContextValue.Provider>
      </div>
      {items.length === 0 ? (
        <div className="settings-keymap-empty">
          <Keyboard size={20} aria-hidden="true" />
          <TugLabel size="sm" emphasis="calm">
            No command matches that.
          </TugLabel>
        </div>
      ) : null}
      <TugAlert ref={alertRef} title="Reset every keyboard shortcut?" />
    </div>
  );
}
