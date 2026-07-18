/**
 * snippets-section.tsx — the Lens **Snippets** section: a keyboard-navigable
 * `TugListView` of reusable prompt fragments backed by the machine-global
 * `snippets.json` (`snippetsStore`).
 *
 * The list is authored into the section's focus group (`host.focusGroup`), so
 * it is one Tab stop in the Lens. The grammar (Spec S01):
 *  - **Arrows** rove the cursor; **Enter** opens the cursor row's editor
 *    (`onActivate` → `beginEdit`), which mounts a `TugTextarea` authored into
 *    the row's descend scope and is focused via `descendIntoRow`. **Escape**
 *    ascends the row scope (engine) and the editor's **blur** commits;
 *    **⌘Return** commits and chains a new snippet. **Space** selects only.
 *  - Section verbs while the list holds the key view: **Delete** removes the
 *    cursor row (read from the projected `data-key-cursor`), **⌘N** creates
 *    below the cursor, **⌘Z / ⇧⌘Z** undo/redo (via a chain responder, active
 *    only in list mode so the editor's native undo wins while typing).
 *  - A row's incipit is draggable into a session prompt (`startSnippetDrag`);
 *    the grip reorders (commit on drop, [Q02]).
 *
 * One cell kind (`"snippet"`) branches display/editor on `editingId` — never
 * two kinds for one row ([L26]). Laws: [L02] store via `useSyncExternalStore`;
 * [L06] cursor/selection appearance is CSS on engine attributes; [L22] the
 * FocusManager owns the cursor and the descend scope.
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
import { Plus, TextQuote } from "lucide-react";

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
import { TugTextarea } from "@/components/tugways/tug-textarea";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { useBlockReorder } from "@/components/lens/block-reorder";
import { useFocusManager } from "@/components/tugways/use-focusable";
import { useResponder } from "@/components/tugways/use-responder";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { registerLensSection } from "../lens-section-registry";
import type { LensSectionHost } from "../lens-section-registry";
import {
  LensSnippetsDataSource,
  useLensSnippetsDataSource,
} from "./snippets-data-source";
import "./snippets-section.css";

const ROW_SELECTOR = ".snippet-row-content[data-snippet-id]";
const ROW_KIND_ATTR = "data-snippet-id";

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

/** Reorder-grip handler, provided by the section body to the module-level cell. */
interface SnippetsCellContextValue {
  onGripPointerDown: (id: string, event: React.PointerEvent) => void;
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

/** The display row — incipit + reorder grip; the incipit drags into a prompt. */
function SnippetDisplayRow({ snippet }: { snippet: Snippet }): React.ReactElement {
  const ctx = React.useContext(SnippetsCellContext);
  const incipit = snippetIncipit(snippet);
  const empty = incipit.length === 0;
  return (
    <div className="snippet-row-content" data-snippet-id={snippet.id}>
      {ctx !== null ? (
        <BlockGrip
          onPointerDown={(e) => ctx.onGripPointerDown(snippet.id, e)}
        />
      ) : null}
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
    </div>
  );
}

/** The in-place editor — a `TugTextarea` authored into the row's descend
 *  scope. Escape ascends (engine) and blur commits; ⌘Return commits + chains. */
function SnippetEditorRow({
  snippet,
  store,
}: {
  snippet: Snippet;
  store: ReturnType<typeof getSnippetsStore>;
}): React.ReactElement {
  const manager = useFocusManager();
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      // ⌘Return commits and chains a new snippet. The engine does not intercept
      // Enter for this behavior-less editor leaf, so it reaches here; the new
      // row's editor opens via the store's `editingId` + the descend effect.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        manager?.ascend();
        store.commitEdit();
        store.createSnippet(snippet.id);
      }
      // Plain Escape is handled by the engine (ascend the non-trapped row
      // scope); the resulting blur commits the edit. Nothing to do here.
    },
    [manager, store, snippet.id],
  );
  const onBlur = useCallback((): void => {
    // Whatever moved focus out of the editor (Escape-ascend, Tab, click-away)
    // commits the open row — the single close path.
    if (store.getSnapshot().editingId === snippet.id) store.commitEdit();
  }, [store, snippet.id]);
  return (
    <div className="snippet-editor" onKeyDown={onKeyDown}>
      <TugTextarea
        rows={3}
        autoResize
        maxRows={14}
        focusGroup="snippet-row-editor"
        focusOrder={0}
        placeholder="Type a snippet — its opening line becomes its handle"
        defaultValue={snippet.text}
        onChange={(e) => store.updateSnippet(snippet.id, e.target.value)}
        onBlur={onBlur}
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

  const listRef = useRef<TugListViewHandle>(null);
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);

  // Descend into a row when it opens for editing ([P06]/[R01]): the editor cell
  // mounts in the same commit that set `editingId`; this parent layout effect
  // runs after the child textarea has registered its focusable, so the descend
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
    () => ({ onGripPointerDown }),
    [onGripPointerDown],
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

  // Section verbs — Delete removes the cursor row, ⌘N creates below it. Bubble
  // phase (the engine leaves Delete / ⌘N as passthrough); only in list mode.
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
      if ((e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        store.createSnippet(cursorSnippetId());
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const id = cursorSnippetId();
        if (id === null) return;
        e.preventDefault();
        store.deleteSnippet(id);
      }
    },
    [editingId, store, cursorSnippetId],
  );

  // ⌘Z / ⇧⌘Z route through the responder chain as UNDO/REDO. Handle them only
  // in list mode: while editing, omit the handlers so the chain walks past to
  // the textarea's native undo ([the KeyZ binding does not preventDefault]).
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
              rowLayout="pill"
              focusGroup={host.focusGroup}
              commitOnEnter="act"
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
