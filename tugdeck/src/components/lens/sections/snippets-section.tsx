/**
 * snippets-section.tsx — the Lens **Snippets** section: a keyboard-navigable
 * `TugListView` of reusable prompt fragments backed by the machine-global
 * `snippets.json` (`snippetsStore`).
 *
 * The list is authored into the section's focus group (`host.focusGroup`), so
 * it is one Tab stop in the Lens. The grammar (Spec S01):
 *  - **Arrows** rove the cursor; **Enter** opens the cursor row's editor
 *    (`onActivate` → `beginEdit`), which mounts a `TugMessageEditor` (the
 *    `TugTextEditor` CM6 substrate, markdown-styled) inside a focusable
 *    wrapper authored into the row's descend scope; the row claims the CM6
 *    caret itself (the engine's ladder yields keys to a focused editor).
 *    **Escape** ascends the row scope (the wrapper's handler — the surface
 *    owns its Escape) and the resulting **blur** commits; **⌘Return**
 *    commits and chains a new snippet. **Space** selects only.
 *  - Section verbs while the list holds the key view: **Delete** removes the
 *    cursor row (read from the projected `data-key-cursor`) and lands the
 *    cursor on the surviving neighbor, **⌘N** creates below the cursor,
 *    **⌘Z / ⇧⌘Z** undo/redo (via a chain responder, active only in list mode
 *    so the editor's CM6 undo wins while typing). Each display row also
 *    carries a hover-reveal delete button for the pointer.
 *  - A row's incipit is draggable into a session prompt (`startSnippetDrag`);
 *    the grip reorders (commit on drop, [Q02]).
 *
 * One cell kind (`"snippet"`) branches display/editor on `editingId` — never
 * two kinds for one row ([L26]). Laws: [L02] store via `useSyncExternalStore`;
 * [L06] cursor/selection appearance is CSS on engine attributes; [L22] the
 * FocusManager owns the cursor and the descend scope; [L11] the editor's
 * CUT/COPY/PASTE/SELECT_ALL/UNDO/REDO responders ride the composed substrate.
 *
 * @module components/lens/sections/snippets-section
 */

import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { Plus, TextQuote, X } from "lucide-react";

import { getSnippetsStore } from "@/lib/snippets-store";
import { snippetIncipit, type Snippet } from "@/lib/snippets-doc";
import { startSnippetDrag } from "@/lib/snippet-drag";
import { cardServicesStore } from "@/lib/card-services-store";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDelegate,
  TugListViewHandle,
} from "@/components/tugways/tug-list-view";
import {
  TugMessageEditor,
  type TugMessageEditorHandle,
} from "@/components/tugways/tug-message-editor";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { useBlockReorder } from "@/components/lens/block-reorder";
import {
  useFocusable,
  useFocusManager,
} from "@/components/tugways/use-focusable";
import { useResponder } from "@/components/tugways/use-responder";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { setSectionHasContent } from "@/components/lens/lens-section-content";
import { registerLensSection } from "../lens-section-registry";
import type { LensSectionHost } from "../lens-section-registry";
import {
  LensSnippetsDataSource,
  useLensSnippetsDataSource,
} from "./snippets-data-source";
import "./snippets-section.css";

const ROW_SELECTOR = ".snippet-row-content[data-snippet-id]";
const ROW_KIND_ATTR = "data-snippet-id";

// Space is reserved so the section's keydown can create a new snippet below the
// cursor (Things-style) rather than the engine's default item-container select.
const SNIPPETS_CAPTURE_KEYS: readonly string[] = [" "];

// The section's remembered selection — the last-touched snippet id, mapped to
// a cursor seed on the next Cmd-L / Tab into the section ([P10]). Module-level
// so it outlives the section body's unmount across a collapse toggle; valid
// while the Lens is a singleton card.
let lastSelectedSnippetId: string | null = null;

/** Route a snippet drop to the card that owns the drop target's prompt entry. */
function insertIntoCard(
  text: string,
  at: { x: number; y: number },
  cardId: string | null,
): void {
  if (cardId === null) return;
  cardServicesStore.getServices(cardId)?.codeSessionStore.insertSnippet(text, at);
}

/** Row verbs provided by the section body to the module-level cell. */
interface SnippetsCellContextValue {
  onGripPointerDown: (id: string, event: React.PointerEvent) => void;
  onDeleteRow: (id: string) => void;
}
const SnippetsCellContext =
  React.createContext<SnippetsCellContextValue | null>(null);

function useSnippets() {
  const store = getSnippetsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, snapshot };
}

/** Live one-line summary: the snippet count. */
function SnippetsCollapsedSummary(): React.ReactElement {
  const { snapshot } = useSnippets();
  const n = snapshot.doc.snippets.length;
  return <>{n === 0 ? "No snippets" : `${n} snippet${n === 1 ? "" : "s"}`}</>;
}

/** The header `+`: create a snippet and open it (the store sets `editingId`,
 *  the body's descend effect focuses it). */
function SnippetsHeaderActions(): React.ReactElement {
  const store = getSnippetsStore();
  return (
    <button
      type="button"
      className="snippets-add-button"
      title="New snippet"
      aria-label="New snippet"
      onClick={() => store.createSnippet(null)}
    >
      <Plus size={14} />
    </button>
  );
}

/** The display row on the shared `TugListRow` chrome: the reorder grip leads,
 *  the draggable incipit is the content column, and a hover-reveal delete is
 *  the trailing accessory. Row padding / hover / divider / caret come from the
 *  row + the enclosing flush `TugListView`. */
function SnippetDisplayRow({ snippet }: { snippet: Snippet }): React.ReactElement {
  const ctx = React.useContext(SnippetsCellContext);
  const incipit = snippetIncipit(snippet);
  const empty = incipit.length === 0;
  return (
    <TugListRow
      className="snippet-row-content"
      data-snippet-id={snippet.id}
      leading={
        ctx !== null ? (
          <BlockGrip
            onPointerDown={(e) => ctx.onGripPointerDown(snippet.id, e)}
          />
        ) : undefined
      }
      trailing={
        ctx !== null ? (
          <button
            type="button"
            className="snippet-row-delete"
            title="Delete snippet"
            aria-label="Delete snippet"
            onClick={(e) => {
              // Never let the delete read as a row activation on the cell
              // wrapper above.
              e.stopPropagation();
              ctx.onDeleteRow(snippet.id);
            }}
          >
            <X size={12} />
          </button>
        ) : undefined
      }
      trailingReveal="engaged"
    >
      <span
        className={
          empty ? "snippet-row-label snippet-row-label-empty" : "snippet-row-label"
        }
        onPointerDown={(e) =>
          startSnippetDrag(e, {
            text: snippet.text,
            label: empty ? "Snippet" : incipit,
            onDrop: insertIntoCard,
          })
        }
      >
        {empty ? "New snippet" : incipit}
      </span>
    </TugListRow>
  );
}

/**
 * The in-place editor — a `TugMessageEditor` (CM6 substrate, markdown-styled)
 * inside a wrapper registered as the row's descend-scope focusable. The engine
 * lands DOM focus on the wrapper (`tabIndex={-1}`); the wrapper forwards it
 * into the CM6 caret. Escape ascends (engine) and the resulting blur commits;
 * ⌘Return (the substrate's `onSubmit`) commits + chains a new snippet.
 */
function SnippetEditorRow({
  snippet,
  store,
}: {
  snippet: Snippet;
  store: ReturnType<typeof getSnippetsStore>;
}): React.ReactElement {
  const manager = useFocusManager();
  const editorRef = useRef<TugMessageEditorHandle | null>(null);
  const focusableId = useId();
  // Registers into the cell's per-row FocusModeContext, so `descendIntoRow`
  // finds this wrapper as the row's inner focusable. No key-view behavior:
  // a behavior-less leaf keeps Enter as a newline in the editor and leaves
  // Escape to the engine's ascend.
  const { focusableRef } = useFocusable({
    id: focusableId,
    group: "snippet-row-editor",
    order: 0,
  });

  // Claim the CM6 caret on open. The editor row only ever mounts from an
  // explicit open gesture (Enter / + / ⌘N via `editingId`), so taking focus
  // here is always the user's intent. The engine's `focusKeyView` cannot
  // land it: its generic DOM walk refuses a `tabIndex={-1}` wrapper and
  // cannot focus a contenteditable caret, and the substrate's responder
  // focus contract is keyed to the editor's responder id, not this wrapper's
  // focusable id. The delegate's `focus()` routes through `focusResponder`,
  // so first-responder state tracks the caret ([L11]).
  //
  // Deferred to a microtask deliberately: this child layout effect runs
  // BEFORE the section body's descend effect, and the focus claim must run
  // AFTER it — the descend's `pushFocusMode` captures the current key view
  // as the scope's Escape-restore target, and claiming first would make the
  // chain reflection coarsen the key view onto the editor's responder, so
  // Escape would "restore" focus straight back into the caret it should be
  // leaving. The microtask runs after the whole commit's effects, before
  // paint; the CM6 view exists by then.
  useLayoutEffect(() => {
    queueMicrotask(() => editorRef.current?.focus());
  }, []);

  const onFocus = useCallback((e: React.FocusEvent<HTMLDivElement>): void => {
    // A later engine focus lands on the wrapper itself; forward into the CM6
    // caret. Focus arriving already inside the editor passes through.
    if (e.target === e.currentTarget) editorRef.current?.focus();
  }, []);

  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>): void => {
      // Commit when focus leaves the row entirely (Escape-ascend, Tab,
      // click-away) — the single close path. Focus moves within the row
      // (wrapper → CM6) are not an exit.
      if (
        e.relatedTarget instanceof Node &&
        e.currentTarget.contains(e.relatedTarget)
      ) {
        return;
      }
      if (store.getSnapshot().editingId === snippet.id) store.commitEdit();
    },
    [store, snippet.id],
  );

  // ⌘Return commits and chains a new snippet; the new row's editor opens via
  // the store's `editingId` + the descend effect.
  const onSubmit = useCallback((): void => {
    manager?.ascend();
    store.commitEdit();
    store.createSnippet(snippet.id);
  }, [manager, store, snippet.id]);

  // Escape closes the editor. The engine's Escape ladder yields to a focused
  // CM6 editor (`data-tug-tab-consume` marks it as owning its keys), so the
  // ascend is this surface's to perform: CM6's completion keymap consumes
  // Escape first when a popup is open (arriving here `defaultPrevented`);
  // a bare Escape ascends the row scope, and the resulting blur commits.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      manager?.ascend();
    },
    [manager],
  );

  return (
    <div
      className="snippet-editor"
      ref={(el) => focusableRef(el)}
      tabIndex={-1}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <TugMessageEditor
        ref={editorRef}
        value={snippet.text}
        placeholder="Type a snippet — its opening line becomes its handle"
        markdownTextStyling
        lineWrap
        maxRows={14}
        onChange={(text) => store.updateSnippet(snippet.id, text)}
        onSubmit={onSubmit}
        aria-label="Snippet text"
        data-testid="snippet-editor-field"
      />
    </div>
  );
}

/** The `"snippet"` cell — one kind, branching display/editor on `editingId`. */
const SnippetCell: TugListViewCellRenderer<LensSnippetsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<LensSnippetsDataSource>) => {
  const snippet = dataSource.rowAt(index);
  const store = getSnippetsStore();
  const editingId = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().editingId,
  );
  return editingId === snippet.id ? (
    <SnippetEditorRow snippet={snippet} store={store} />
  ) : (
    <SnippetDisplayRow snippet={snippet} />
  );
};

const SNIPPETS_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<LensSnippetsDataSource>
> = { snippet: SnippetCell };

function SnippetsBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const { store, snapshot } = useSnippets();
  const snippets = snapshot.doc.snippets;
  const editingId = snapshot.editingId;
  const dataSource = useLensSnippetsDataSource(snippets);
  const hasContent = snippets.length > 0;

  // Publish content so the Lens skips this band for the Cmd-L seed / Tab walk
  // when it is empty (an empty list is not a focus stop).
  useLayoutEffect(() => {
    setSectionHasContent(host.focusGroup, hasContent);
    return () => setSectionHasContent(host.focusGroup, false);
  }, [host.focusGroup, hasContent]);

  const listRef = useRef<TugListViewHandle>(null);
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);

  // Descend into a row when it opens for editing ([P06]/[R01]): the editor cell
  // mounts in the same commit that set `editingId`; this parent layout effect
  // runs after the child editor has registered its focusable, so the descend
  // finds it. Guarded so it fires once per open (not on every keystroke).
  const prevEditingRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (editingId !== null && editingId !== prevEditingRef.current) {
      const index = dataSource.indexForId(editingId);
      if (index >= 0) listRef.current?.descendIntoRow(index);
    }
    prevEditingRef.current = editingId;
  }, [editingId, dataSource]);

  const initialSelectedIndex = useMemo(() => {
    if (lastSelectedSnippetId === null) return undefined;
    const i = dataSource.indexForId(lastSelectedSnippetId);
    return i >= 0 ? i : undefined;
    // Recompute when membership changes (the version bump re-runs on length).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, snippets.length]);

  // Space/click select only; Enter opens the editor ([P11] — snippets differ
  // from the monitor lists). Both remember the touched snippet ([P10]).
  const delegate = useMemo<TugListViewDelegate>(() => {
    return {
      onSelect: (index: number): void => {
        const row = dataSource.rowAt(index);
        if (row !== undefined) lastSelectedSnippetId = row.id;
      },
      onActivate: (index: number): void => {
        const row = dataSource.rowAt(index);
        if (row === undefined) return;
        lastSelectedSnippetId = row.id;
        store.beginEdit(row.id);
      },
    };
  }, [dataSource, store]);

  // Delete `id` and land the cursor on the surviving neighbor (same index,
  // clamped) so the keyboard position never vanishes with the row. Shared by
  // the keyboard Delete verb and the row's pointer delete button.
  const deleteSnippetKeepingCursor = useCallback(
    (id: string): void => {
      const index = dataSource.indexForId(id);
      if (index < 0) return;
      const survivorCount = dataSource.numberOfItems() - 1;
      store.deleteSnippet(id);
      if (survivorCount <= 0) return;
      const landing = Math.min(index, survivorCount - 1);
      const survivor = store.getSnapshot().doc.snippets[landing];
      if (survivor !== undefined) lastSelectedSnippetId = survivor.id;
      listRef.current?.moveCursorTo(landing);
    },
    [dataSource, store],
  );

  // Reorder by grip: commit on drop ([Q02]). Rows are matched by their stable
  // `data-snippet-id`; the FLIP animates the row content, the store commit
  // reorders the document.
  const { onGripPointerDown } = useBlockReorder({
    containerRef: listWrapRef,
    caretRef,
    getVisibleOrder: () => snapshot.doc.snippets.map((s) => s.id),
    commit: (order) => store.setOrder([...order]),
    selector: ROW_SELECTOR,
    kindAttr: ROW_KIND_ATTR,
  });
  const cellContext = useMemo<SnippetsCellContextValue>(
    () => ({ onGripPointerDown, onDeleteRow: deleteSnippetKeepingCursor }),
    [onGripPointerDown, deleteSnippetKeepingCursor],
  );

  // Read the cursor row id from the engine's projected `data-key-cursor` —
  // appearance-zone DOM, no new list-view API ([L06]).
  const cursorSnippetId = useCallback((): string | null => {
    const cell = listWrapRef.current?.querySelector("[data-key-cursor]");
    const idxAttr = cell?.getAttribute("data-tug-list-cell-index");
    if (idxAttr === null || idxAttr === undefined) return null;
    const idx = Number.parseInt(idxAttr, 10);
    return snapshot.doc.snippets[idx]?.id ?? null;
  }, [snapshot.doc.snippets]);

  // Section verbs — Space / ⌘N create a new snippet below the cursor (the
  // Things-style gesture), Delete removes the cursor row. Bubble phase: the
  // engine leaves Delete / ⌘N as passthrough, and yields Space because the list
  // reserves it via `captureKeys` (otherwise Space would resolve to the
  // item-container select). Only in list mode; the editor owns keys while open.
  const onSectionKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (editingId !== null) return; // the editor owns keys while open
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const createBelowCursor = (): void => {
        e.preventDefault();
        // `createSnippet(afterId)` inserts after `afterId` and opens the new
        // row for editing (its descend effect focuses the caret). A null cursor
        // (empty list / no landing) appends at the end.
        store.createSnippet(cursorSnippetId());
      };
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
        createBelowCursor();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N")) {
        createBelowCursor();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const id = cursorSnippetId();
        if (id === null) return;
        e.preventDefault();
        deleteSnippetKeepingCursor(id);
      }
    },
    [editingId, store, cursorSnippetId, deleteSnippetKeepingCursor],
  );

  // ⌘Z / ⇧⌘Z route through the responder chain as UNDO/REDO. Handle them only
  // in list mode: while editing, omit the handlers so the chain walks past to
  // the editor's own undo responder ([the KeyZ binding does not preventDefault]).
  const responderId = useId();
  const responderActions = useMemo(
    () =>
      editingId === null
        ? {
            [TUG_ACTIONS.UNDO]: () => store.undo(),
            [TUG_ACTIONS.REDO]: () => store.redo(),
          }
        : undefined,
    [editingId, store],
  );
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: responderActions,
  });

  return (
    <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        className="snippets-section"
        onKeyDown={onSectionKeyDown}
      >
        {snapshot.error !== null ? (
          <div className="snippets-error" role="status">
            Snippets are read-only: {snapshot.error}
          </div>
        ) : null}
        <div className="snippets-list-wrap" ref={listWrapRef}>
          <BlockDropCaret ref={caretRef} />
          <SnippetsCellContext value={cellContext}>
            <TugListView<LensSnippetsDataSource>
              ref={listRef}
              dataSource={dataSource}
              delegate={delegate}
              cellRenderers={SNIPPETS_CELL_RENDERERS}
              scrollKey="lens-snippets"
              inline
              rowLayout="flush"
              focusGroup={hasContent ? host.focusGroup : undefined}
              commitOnEnter="act"
              captureKeys={SNIPPETS_CAPTURE_KEYS}
              initialSelectedIndex={initialSelectedIndex}
              className="lens-snippets-list"
            />
          </SnippetsCellContext>
        </div>
        {snippets.length === 0 ? (
          <div className="snippets-empty">
            No snippets yet. Press + to add one.
          </div>
        ) : null}
      </div>
    </ResponderScope>
  );
}

/** Register the Snippets section. Called once at boot from `main.tsx`. */
export function registerSnippetsSection(): void {
  registerLensSection({
    kind: "snippets",
    title: "Snippets",
    glyph: <TextQuote size={14} />,
    collapsedSummary: () => <SnippetsCollapsedSummary />,
    headerActions: () => <SnippetsHeaderActions />,
    body: (host) => <SnippetsBody host={host} />,
  });
}
