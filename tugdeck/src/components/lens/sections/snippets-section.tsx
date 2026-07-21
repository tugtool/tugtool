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
 *  - Section verbs while the list holds the key view (delivered via the
 *    list's `onKeyViewKey` delegate — the [P05] channel): **Space** creates
 *    below the cursor, **Delete** removes the cursor row (read from the
 *    projected `data-key-cursor`) and lands the cursor on the surviving
 *    neighbor, **⌘Z / ⇧⌘Z** undo/redo (via a chain responder, active only
 *    in list mode so the editor's CM6 undo wins while typing). Each display
 *    row also carries a hover-reveal delete button for the pointer.
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
  useState,
  useSyncExternalStore,
} from "react";
import { Copy, Plus, TextQuote, X } from "lucide-react";

import { getSnippetsStore } from "@/lib/snippets-store";
import { snippetIncipit, type Snippet } from "@/lib/snippets-doc";
import { startSnippetDrag } from "@/lib/snippet-drag";
import { cardServicesStore } from "@/lib/card-services-store";
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import {
  hasNativeClipboardBridge,
  writeClipboardViaNative,
} from "@/lib/tug-native-clipboard";
import { animate } from "@/components/tugways/tug-animator";
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
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
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

// Space is reserved so the section's key-view delegate can create a new
// snippet below the cursor (Things-style) rather than the engine's default
// item-container select.
const SNIPPETS_CAPTURE_KEYS: readonly string[] = [" "];

// The section's remembered selection — the last-touched snippet id, mapped to
// a cursor seed on the next Cmd-L / Tab into the section ([P10]). Module-level
// so it outlives the section body's unmount across a collapse toggle; valid
// while the Lens is a singleton card.
let lastSelectedSnippetId: string | null = null;

/** Unwrap the single enclosing `<p>…</p>` the block markdown renderer wraps a
 *  one-line string in, so a snippet incipit renders as INLINE markdown (its text
 *  reads on the row's baseline, not as a block paragraph). A multi-block or
 *  non-paragraph render is left as-is. */
function inlineMarkdownHtml(html: string): string {
  const match = /^<p>([\s\S]*)<\/p>$/.exec(html.trim());
  return match !== null ? match[1] : html;
}

/** Copy a snippet's raw text to the clipboard — native bridge in Tug.app (no
 *  permission popup), the async Clipboard API in browser-dev. */
function copySnippetText(text: string): void {
  if (text === "") return;
  if (hasNativeClipboardBridge()) {
    writeClipboardViaNative(text, "");
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {});
  }
}

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
  /** Open the destructive-delete confirm popover anchored to the row's ✕. */
  onRequestDelete: (id: string, anchorEl: HTMLElement) => void;
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
 *  the body's descend effect focuses it). `TugIconButton` carries the standard
 *  ghost hover / focus / active treatment the fold chevron wears. */
function SnippetsHeaderActions(): React.ReactElement {
  const store = getSnippetsStore();
  return (
    <TugIconButton
      icon={<Plus size={14} />}
      size="xs"
      aria-label="New snippet"
      title="New snippet"
      onClick={() => store.createSnippet(null)}
    />
  );
}

/** The display row on the shared `TugListRow` chrome: the reorder grip leads,
 *  the draggable incipit is the content column, and a hover-reveal delete is
 *  the trailing accessory. Row padding / hover / divider / caret come from the
 *  row + the enclosing flush `TugListView`. */
function SnippetDisplayRow({
  snippet,
  selected,
}: {
  snippet: Snippet;
  selected: boolean;
}): React.ReactElement {
  const ctx = React.useContext(SnippetsCellContext);
  const incipit = snippetIncipit(snippet);
  const empty = incipit.length === 0;
  // The incipit renders INLINE markdown (`*hello*` → italic) via the same
  // sanitized one-line renderer the pulse strip uses, unwrapped to inline. An
  // empty `html` is its plain-text signal (no markup, or a parse fallback).
  const rendered = empty ? null : renderPulseLine(incipit);
  const incipitHtml =
    rendered !== null && rendered.html.length > 0
      ? inlineMarkdownHtml(rendered.html)
      : null;
  return (
    <TugListRow
      className="snippet-row-content"
      data-snippet-id={snippet.id}
      selected={selected}
      leading={
        ctx !== null ? (
          <BlockGrip
            onPointerDown={(e) => ctx.onGripPointerDown(snippet.id, e)}
          />
        ) : undefined
      }
      trailing={
        ctx !== null ? (
          <>
            <TugIconButton
              icon={<Copy size={12} />}
              size="xs"
              aria-label="Copy snippet"
              title="Copy snippet"
              onClick={(e) => {
                // A copy is not a row activation — stop it reaching the cell.
                e?.stopPropagation();
                copySnippetText(snippet.text);
              }}
            />
            <TugIconButton
              className="snippet-row-delete"
              icon={<X size={12} />}
              size="xs"
              tone="danger"
              aria-label="Delete snippet"
              title="Delete snippet"
              onClick={(e) => {
                // Never let the delete read as a row activation (open) on the
                // cell wrapper above; open the confirm popover anchored to ✕.
                e?.stopPropagation();
                const anchor = e?.currentTarget;
                if (anchor instanceof HTMLElement) {
                  ctx.onRequestDelete(snippet.id, anchor);
                }
              }}
            />
          </>
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
        {empty ? (
          "New snippet"
        ) : incipitHtml !== null ? (
          <span
            className="snippet-row-incipit"
            dangerouslySetInnerHTML={{ __html: incipitHtml }}
          />
        ) : (
          incipit
        )}
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const focusableId = useId();

  // Slide the editor OPEN — grow from zero height to its natural height so the
  // row visibly opens rather than snapping ([L06] via WAAPI, not React state;
  // reduced-motion honored by the animator). `overflow: hidden` clips the field
  // during the grow; restored when the animation settles.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const target = el.getBoundingClientRect().height;
    if (target <= 0) return;
    const prevOverflow = el.style.overflow;
    el.style.overflow = "hidden";
    const restore = (): void => {
      el.style.overflow = prevOverflow;
    };
    animate(
      el,
      [
        { height: "0px", opacity: 0 },
        { height: `${target}px`, opacity: 1 },
      ],
      {
        duration: "--tug-motion-duration-moderate",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
        key: "snippet-editor-open",
      },
    ).finished.then(restore, restore);
  }, []);
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

  // Keep the caret in view as the snippet is edited. The editor grows uncapped
  // and the Lens list is the single scroller (see `snippets-section.css`), so a
  // snippet taller than the Lens makes the LIST scroll — nothing auto-follows
  // the caret there. On each user edit, reveal the caret element into the list
  // (`scrollIntoView` walks up to the list scroller); deferred a frame so CM6
  // has laid the caret at its new position first. This is why the edit can never
  // scroll off, even when the content dwarfs the Lens.
  const onChange = useCallback(
    (text: string): void => {
      store.updateSnippet(snippet.id, text);
      requestAnimationFrame(() => {
        wrapRef.current
          ?.querySelector<HTMLElement>(".tug-text-editor-caret")
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [store, snippet.id],
  );

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
      ref={(el) => {
        wrapRef.current = el;
        focusableRef(el);
      }}
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
        fontSize="var(--tugx-snippet-editor-font-size)"
        maxRows={120}
        onChange={onChange}
        onSubmit={onSubmit}
        aria-label="Snippet text"
        data-testid="snippet-editor-field"
      />
    </div>
  );
}

/** The `"snippet"` cell — one kind, branching display/editor on `editingId`.
 *  `selected` is the list-view-owned selection state; thread it to the display
 *  row so `TugListRow` paints its real selection fill (the picker look). */
const SnippetCell: TugListViewCellRenderer<LensSnippetsDataSource> = ({
  index,
  dataSource,
  selected,
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
    <SnippetDisplayRow snippet={snippet} selected={selected} />
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

  // The Things model on the list view's own `selectionRequired` shape: the list
  // owns a never-null selected row and stamps `data-selected`, so the REAL
  // `TugListRow` selection fill paints (the session-picker look — no hand-rolled
  // styling). A single click (`onSelect`) SELECTS + focuses the row but NEVER
  // opens it; the row OPENS only on Enter (`onActivate`, via `commitOnEnter`) or
  // a double-click (`onActivate`, via `activateOnDoubleClick`) — the first click
  // of the pair selects, the second opens. Both remember the snippet for the
  // next Cmd-L / Tab seed ([P10]).
  const delegate = useMemo<TugListViewDelegate>(() => {
    const remember = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row !== undefined) lastSelectedSnippetId = row.id;
    };
    const open = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row === undefined) return;
      lastSelectedSnippetId = row.id;
      store.beginEdit(row.id);
    };
    return { onSelect: remember, onActivate: open };
  }, [dataSource, store]);

  // State-mirror for the list-view-owned selection ([L24]) — keep the remembered
  // snippet id in step with the selection as it moves (seed, click).
  const onSelectionChange = useCallback(
    (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row !== undefined) lastSelectedSnippetId = row.id;
    },
    [dataSource],
  );

  // Destructive-delete confirmation ([D15] controlled `TugConfirmPopover`): the
  // row ✕ opens the popover anchored to itself instead of deleting immediately.
  // Local UI state ([L24]) — the pending row id + its anchor element.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    anchorEl: HTMLElement;
  } | null>(null);

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
    () => ({
      onGripPointerDown,
      onRequestDelete: (id, anchorEl) => setPendingDelete({ id, anchorEl }),
    }),
    [onGripPointerDown],
  );

  // The keyboard's current row — the movement cursor's cell (`data-key-cursor`),
  // projected by the engine ([L06]). In `selectionRequired` mode a click also
  // commits selection here, so the cursor row and the selected (`data-selected`)
  // fill coincide under the pointer; the section verbs (create-below / delete)
  // act on the cursor row.
  const cursorCell = useCallback(
    (): HTMLElement | null =>
      listWrapRef.current?.querySelector<HTMLElement>("[data-key-cursor]") ?? null,
    [],
  );
  // The cursor row's delete ✕ — the anchor the KEYBOARD delete confirm popover
  // points at, so it opens beside the row's ✕ exactly like a mouse click does
  // (anchoring to the full-width cell threw the popover to the far left).
  const cursorDeleteButton = useCallback(
    (): HTMLElement | null =>
      cursorCell()?.querySelector<HTMLElement>(".snippet-row-delete") ?? null,
    [cursorCell],
  );
  const cursorSnippetId = useCallback((): string | null => {
    const idxAttr = cursorCell()?.getAttribute("data-tug-list-cell-index");
    if (idxAttr === null || idxAttr === undefined) return null;
    const idx = Number.parseInt(idxAttr, 10);
    return snapshot.doc.snippets[idx]?.id ?? null;
  }, [cursorCell, snapshot.doc.snippets]);

  // Section verbs — Space / ⌘N create a new snippet below the cursor (the
  // Things-style gesture), Delete removes the cursor row. Delivered through
  // the list's key-view delegate (`onKeyViewKey` — the [P05] channel): in
  // engine-routed mode keydown lands on the key sink, never in this
  // subtree, so a bubble-phase container `onKeyDown` is structurally dead.
  // The list reserves Space via `captureKeys` (otherwise it would resolve
  // to the item-container select before reaching this delegate). Only in
  // list mode; the editor owns keys while open (dom-granted — the delegate
  // never fires — plus the `editingId` guard for the descended-scope
  // fallback delivery).
  const onSectionKeyViewKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (editingId !== null) return false; // the editor owns keys while open
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // `createSnippet(afterId)` inserts after `afterId` and opens the new
        // row for editing (its descend effect focuses the caret). A null
        // cursor (empty list / no landing) appends at the end.
        store.createSnippet(cursorSnippetId());
        return true;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const id = cursorSnippetId();
        // Anchor to the row's ✕ (revealed on the cursor row) so the popover opens
        // beside it, exactly as the mouse path does; fall back to the cell.
        const anchor = cursorDeleteButton() ?? cursorCell();
        if (id === null || anchor === null) return false;
        // Destructive — raise the SAME confirm popover the mouse ✕ does, anchored
        // to the cursor row. Confirm deletes (keeping the cursor on a neighbor).
        setPendingDelete({ id, anchorEl: anchor });
        return true;
      }
      return false;
    },
    [editingId, store, cursorSnippetId, cursorCell, cursorDeleteButton],
  );
  // ⌘/⌃ chords never reach the key-view delegate (they belong to the
  // bindings tier), so the old ⌘N-in-list-mode alias does not ride it;
  // Space and the band's + button are the create gestures.

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
      >
        {snapshot.error !== null ? (
          <div className="snippets-error" role="status">
            Snippets are read-only: {snapshot.error}
          </div>
        ) : null}
        {snippets.length === 0 ? (
          // Empty label instead of the list — an empty `flex: 1` list would grow
          // and open a gap under the band (see the Sessions section).
          <div className="snippets-empty">
            No snippets yet. Press + to add one.
          </div>
        ) : (
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
                activateOnDoubleClick
                selectionRequired
                captureKeys={SNIPPETS_CAPTURE_KEYS}
                onKeyViewKey={onSectionKeyViewKey}
                onSelectionChange={onSelectionChange}
                initialSelectedIndex={initialSelectedIndex}
                className="lens-snippets-list"
              />
            </SnippetsCellContext>
          </div>
        )}
        {/* One controlled confirm popover serves every row's ✕ — it anchors to
            whichever button opened it. Confirm deletes (keeping the cursor on a
            surviving neighbor); cancel / outside-click / Escape dismisses. */}
        <TugConfirmPopover
          open={pendingDelete !== null}
          anchorEl={pendingDelete?.anchorEl ?? null}
          message="Delete this snippet?"
          confirmLabel="Delete"
          confirmRole="danger"
          side="left"
          align="center"
          arrow
          onConfirm={() => {
            if (pendingDelete !== null) deleteSnippetKeepingCursor(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
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
