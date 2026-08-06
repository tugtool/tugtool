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
 * What a row does NOT report is whether the command could run at this
 * instant. Menu items validate: Cycle Stack is disabled with one card in the
 * pane, Save As with nothing open. That is a fact about the app right now,
 * not about the keymap, and a configurator that mixed the two would have the
 * same chord reading differently depending on what the user happened to have
 * open behind it. Shadowing survives because a rebind changes it; validation
 * does not, so the pane is silent about it ([P11] is about the mapping being
 * believable, not about the moment).
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
import { Keyboard, Lock, Menu, RotateCcw, X } from "lucide-react";

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
import { TugBadge } from "../tug-badge";
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
 * Something the user should read before committing the chord they just
 * pressed — rendered, and in plain text for the tooltip.
 *
 * The two forms are the same sentence: the rendered one sets the colliding
 * command's name in bold, because the name is the whole answer to "why not"
 * and a sentence that buries it reads as boilerplate.
 */
interface CaptureNote {
  readonly node: React.ReactNode;
  readonly text: string;
}

/** A note that is only prose — no command to name, nothing to emphasize. */
function plainNote(text: string): CaptureNote {
  return { node: text, text };
}

/**
 * A chord is taken, and by whom — the two facts, and nothing else.
 *
 * The long form explained the resolution order in a sentence, which is the
 * right explanation in the wrong place: the note sits beside a capture strip
 * in one row of a long list, and by the time it has been read the user has
 * already decided. The name and the chord are what they are deciding with.
 */
function conflictNote(title: string, chord: Chord): CaptureNote {
  const label = formatChord(chord);
  return {
    node: (
      <>
        <strong>{title}</strong>
        {" uses "}
        <span className="settings-keymap-capture-note-chord">{label}</span>
      </>
    ),
    text: `${title} uses ${label}`,
  };
}

/**
 * What a pending chord would displace.
 *
 * `resolveChord` is asked *before* the binding is committed, which is the
 * whole point: a collision the user reads is a decision, and a collision they
 * discover by pressing the keys is a bug report.
 */
function conflictNoteFor(chord: Chord, commandId: string): CaptureNote | null {
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
    // Its item validates disabled at this instant, which is not the point:
    // the command owns the chord on a menu item either way, and the menu bar
    // takes it before the web view is asked. That ownership is what the user
    // is about to collide with.
    const title = COMMANDS_BY_ID.get(eaten.commandId)?.title ?? eaten.commandId;
    return conflictNote(title, chord);
  }
  const title = COMMANDS_BY_ID.get(winner.commandId)?.title ?? winner.commandId;
  return conflictNote(title, chord);
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
        ? plainNote("Needs ⌘, ⌃, or ⌥")
        : (conflictNoteFor(pending, commandId) ??
          (!chordHasKeyEquivalent(pending) ? plainNote("No menu-bar form") : null));

  // One line: the strip holding the chord and the two ways out, and beside it
  // — not under it — whatever there is to say about what was pressed. The
  // strip's width is fixed, so a note arriving does not narrow it, and the
  // row's height never changes while the capture is open. Growing downward to
  // speak would move the buttons out from under the pointer at the exact
  // moment the user is deciding whether to press one.
  return (
    <div className="settings-keymap-capture-block" ref={hostRef} data-testid="keymap-capture">
      <div className="settings-keymap-capture">
        <div className="settings-keymap-capture-chord" data-pending={pending !== null}>
          {pending === null ? "Press a chord…" : formatChord(pending)}
        </div>
        <div className="settings-keymap-capture-actions">
          {/* Cancel first: it is the one that always applies, and the chord
              may not yet be usable. */}
          <TugPushButton size="xs" data-testid="keymap-capture-cancel" onClick={onCancel}>
            Cancel
          </TugPushButton>
          <TugPushButton
            size="xs"
            role="accent"
            emphasis="filled"
            data-testid="keymap-capture-use"
            disabled={!recordable}
            onClick={() => {
              if (recordable) onCommit(pending);
            }}
          >
            Set
          </TugPushButton>
        </div>
      </div>
      <div
        className="settings-keymap-capture-note"
        data-testid="keymap-capture-note"
        title={note?.text}
      >
        {note !== null ? (
          <TugLabel size="sm" role="caution">
            {note.node}
          </TugLabel>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Rows
 * ------------------------------------------------------------------------- */

/**
 * The standing of one binding, said plainly — and only the standing that is
 * a property of the KEYMAP.
 *
 * A command's menu item validates enabled or disabled from moment to moment:
 * Cycle Stack is dead with one card in the pane and alive with two, and Save
 * As is dead with nothing open. That makes a binding momentarily unreachable
 * without making the mapping wrong, and this pane configures the mapping. A
 * row that answered "not reachable right now" would be reporting the state of
 * the app at the instant the list happened to render — a fact about somewhere
 * else, in the surface whose subject is which chord means which command, and
 * one the user cannot act on from here.
 *
 * What survives is what a rebind would actually change: another command
 * holding the chord, and a binding that lives only inside a scope.
 */
function bindingNote(binding: KeymapRowBinding): string | null {
  if (binding.scoped) {
    const scope = binding.binding.scope;
    const where = scope.kind === "mode" ? scope.modeId : scope.kind === "responder" ? scope.responderId : "";
    return `only in ${where}`;
  }
  const shadower = binding.shadowedBy;
  if (shadower === undefined) return null;
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
    <div
      className="settings-keymap-group"
      data-testid="keymap-group"
      data-first={item.first ? "" : undefined}
    >
      {/* Every section is one menu, so every section carries the same menu
          glyph — the icon is saying what KIND of thing the heading names, and
          a different glyph per menu would be inventing a taxonomy the menu
          bar does not have. */}
      <Menu size={14} aria-hidden="true" />
      {/* The heading's weight, case, tracking, and color are the container's
          ([L06]) — the same declarations a Settings legend carries, so the
          two configurators' sections are set identically. `normal` emphasis
          inherits all four. */}
      <TugLabel size="sm">{item.title}</TugLabel>
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
      // The capture surface grows the row downward. Top-aligning while it is
      // open keeps the title and the accessories exactly where the click left
      // them — a row that re-centred its own contents would move the button
      // the user just pressed.
      data-armed={armed ? "" : undefined}
      trailing={
        <div className="settings-keymap-trailing">
          <div className="settings-keymap-chords">
            {row.bindings.length === 0 ? (
              // A chip where a chord chip would be. The empty state is one of
              // the row's real answers, not the absence of one, and set as
              // loose text beside its neighbours' boxes it read as a caption
              // about the row rather than as its contents.
              <TugBadge
                size="md"
                emphasis="outlined"
                role="inherit"
                className="settings-keymap-unbound"
              >
                Not bound
              </TugBadge>
            ) : (
              row.bindings.map((binding, i) => {
                const note = bindingNote(binding);
                return (
                  <span
                    key={`${binding.label}:${i}`}
                    className="settings-keymap-chord"
                    // Struck for a chord another command takes, never for one
                    // whose own menu item happens to validate disabled — the
                    // strike says "this mapping does not hold", and a
                    // momentarily inapplicable command still owns its chord.
                    data-active={binding.shadowedBy === undefined ? "" : undefined}
                    data-shadowed={binding.shadowedBy !== undefined ? "" : undefined}
                    title={note ?? undefined}
                  >
                    <span className="settings-keymap-chord-label">{binding.label}</span>
                    {note !== null ? (
                      <span className="settings-keymap-chord-note">{note}</span>
                    ) : null}
                    {rebindable && !binding.scoped ? (
                      <TugIconButton
                        size="2xs"
                        aria-label={`Remove ${binding.label} from ${row.title}`}
                        icon={<X aria-hidden="true" />}
                        onClick={() => ctx.removeBinding(row.commandId, i)}
                      />
                    ) : null}
                  </span>
                );
              })
            )}
          </div>
          {/* One slot, one width, every row: the Change button and the
              Reserved badge occupy the same column, so the eye runs down a
              single edge instead of one that moves with each row's standing.
              A row that offers neither still reserves the slot — otherwise
              its chords would slide right into the gap. */}
          <div className="settings-keymap-action">
            {row.locked ? (
              <TugBadge
                size="md"
                emphasis="outlined"
                role="inherit"
                icon={<Lock aria-hidden="true" />}
                className="settings-keymap-reserved"
                title="Reserved by macOS convention"
              >
                Reserved
              </TugBadge>
            ) : rebindable ? (
              <TugPushButton
                size="xs"
                emphasis={armed ? "filled" : "outlined"}
                role="accent"
                aria-pressed={armed || undefined}
                data-testid={`keymap-arm-${row.commandId}`}
                onClick={() => (armed ? ctx.cancel() : ctx.arm(row.commandId))}
              >
                Change
              </TugPushButton>
            ) : null}
          </div>
          <div className="settings-keymap-reset">
            {row.overridden ? (
              <TugIconButton
                size="2xs"
                aria-label={`Reset ${row.title} to its default chord`}
                icon={<RotateCcw aria-hidden="true" />}
                onClick={() => ctx.reset(row.commandId)}
              />
            ) : null}
          </div>
        </div>
      }
    >
      <div className="settings-keymap-row-body">
        {/* The title stands in a band as tall as the accessories opposite it,
            so it sits on their centre line whether the row is one line or
            three. */}
        <div className="settings-keymap-row-title">
          <TugLabel size="md">{row.title}</TugLabel>
        </div>
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
    () => ({
      estimatedHeightForKind: (kind) => (kind === "group" ? 44 : 40),
      // Each menu bands from its own first command, and the heading between
      // two menus takes no band at all.
      stripeParityForIndex: (index) => {
        const item = items[index];
        if (item === undefined || item.kind !== "command") return "none";
        return item.parity;
      },
    }),
    [items],
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
            // Bands, not rules. A hairline under every one of two hundred
            // rows is a fence per row; an alternating wash lets the eye run
            // a row's title out to its chord without counting lines.
            rowSeparator="none"
            rowStriping="subtle"
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
