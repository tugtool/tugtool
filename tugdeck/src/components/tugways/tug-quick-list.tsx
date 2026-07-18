/**
 * `TugQuickList` — a lightweight editable list with the real Things-3 keyboard
 * grammar. Snippets is its first client ([P08]).
 *
 * The high-level model is Things': you get *into* an item and *out* of it, and
 * you rattle off a list without touching the mouse or thinking about modes.
 *
 * - **List mode** (no row open): ↑/↓ move selection; **Space** creates a new
 *   item below the selection and opens it (Things' rapid-entry key); **Return**
 *   opens the selected item (or creates when nothing is selected); ⌘N creates;
 *   **Delete** removes the selected item (no confirmation — undo is the safety
 *   net, [P06]); ⌘Z/⇧⌘Z route to the host's undo/redo; **Escape** clears the
 *   selection, and a second Escape (nothing selected) is left **unconsumed** so
 *   a surrounding surface (e.g. the Lens Escape-out) still sees it.
 * - **Edit mode** (one item open, expanded in place): the row renders
 *   `renderEditor` — a single multi-line body. **Return** inserts a newline;
 *   **Escape** commits and returns to the list; **⌘Return** commits and spawns
 *   the next item (rapid chain); clicking another row commits and selects it.
 *
 * The editor field is expected to be a responder-wired Tug component
 * (`TugTextarea`), so CUT/COPY/PASTE/SELECT_ALL/UNDO/REDO work inside it
 * without any wiring here.
 *
 * `selectedId` / `editingId` are component state: `editingId` gates which row
 * mounts its editor (structure), and the selection *highlight* is CSS keyed on
 * the JSX `data-selected` attribute (appearance stays in CSS/DOM per [L06]).
 * Read-only rows carry no tabindex — the container is the single focus stop.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlockReorder } from "@/components/lens/block-reorder";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import "./tug-quick-list.css";

const ROW_SELECTOR = ".tug-quick-list-row[data-quicklist-row]";
const ROW_KIND_ATTR = "data-quicklist-row";

export interface QuickListItem {
  id: string;
}

export interface TugQuickListProps<T extends QuickListItem> {
  items: readonly T[];
  /** Render a display row (list mode). */
  renderRow: (item: T) => React.ReactNode;
  /** Render the in-place editor (edit mode). Should mount responder-wired fields. */
  renderEditor: (item: T) => React.ReactNode;
  /** Create a snippet after `afterId` (null = at end); return the new id to open. */
  onCreate: (afterId: string | null) => string;
  /** Delete `id`; return the id that should take selection next (or null). */
  onDelete: (id: string) => string | null;
  /** Bracket start — opening a row for editing (host uses this for undo coalescing). */
  onOpen?: (id: string) => void;
  /** Bracket end — committing an open row. */
  onClose?: (id: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** When set, rows gain a drag grip that reorders and commits `ids` on drop. */
  onReorder?: (ids: string[]) => void;
  /**
   * When this id changes to a new value, the list opens that row for editing.
   * Lets a control outside the list (e.g. a section header `+`) create-and-open.
   */
  openSignal?: string | null;
  /** Shown when `items` is empty. */
  emptyHint?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

interface QuickListController {
  selectedId: string | null;
  editingId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the mounted editor row so open-focus and Return-to-textarea work. */
  editingRef: React.RefObject<HTMLDivElement | null>;
  onContainerKeyDown: (e: React.KeyboardEvent) => void;
  onEditorKeyDown: (e: React.KeyboardEvent) => void;
  selectRow: (id: string) => void;
  openRow: (id: string) => void;
  createAndOpen: (afterId: string | null) => void;
  closeRow: () => void;
}

/**
 * The Things-3 grammar as a reusable controller. Owns selection + open-row
 * state and the two keydown handlers; the rendering is left to the caller.
 */
export function useQuickList<T extends QuickListItem>(props: {
  items: readonly T[];
  onCreate: (afterId: string | null) => string;
  onDelete: (id: string) => string | null;
  onOpen?: (id: string) => void;
  onClose?: (id: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  openSignal?: string | null;
}): QuickListController {
  const { items, onCreate, onDelete, onOpen, onClose, onUndo, onRedo, openSignal } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editingRef = useRef<HTMLDivElement | null>(null);

  const indexOf = useCallback(
    (id: string | null): number => (id === null ? -1 : items.findIndex((it) => it.id === id)),
    [items],
  );

  const selectRow = useCallback((id: string) => setSelectedId(id), []);

  const openRow = useCallback(
    (id: string) => {
      setSelectedId(id);
      setEditingId(id);
      onOpen?.(id);
    },
    [onOpen],
  );

  const closeRow = useCallback(() => {
    setEditingId((open) => {
      if (open !== null) onClose?.(open);
      return null;
    });
    // Return focus to the container so list-mode keys work again.
    queueMicrotask(() => containerRef.current?.focus());
  }, [onClose]);

  const createAndOpen = useCallback(
    (afterId: string | null) => {
      const id = onCreate(afterId);
      openRow(id);
    },
    [onCreate, openRow],
  );

  // Commit the open item and immediately spawn the next below it (⌘Return) —
  // the rapid-entry accelerator for a body-led list where plain Return is a
  // newline. `onClose` brackets the commit; the new item opens focused.
  const commitAndCreateNext = useCallback(() => {
    const open = editingId;
    if (open !== null) onClose?.(open);
    setEditingId(null);
    createAndOpen(open);
  }, [editingId, onClose, createAndOpen]);

  const onContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingId !== null) return; // the editor owns its keys
      const idx = indexOf(selectedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        const next = idx < 0 ? 0 : Math.min(idx + 1, items.length - 1);
        setSelectedId(items[next].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        const prev = idx < 0 ? 0 : Math.max(idx - 1, 0);
        setSelectedId(items[prev].id);
      } else if (e.key === " ") {
        // Space = new item below the selection (Things' rapid-entry key).
        e.preventDefault();
        createAndOpen(selectedId);
      } else if (e.key === "Enter") {
        // Return opens the selected item; with nothing selected, it creates.
        e.preventDefault();
        if (selectedId === null) createAndOpen(null);
        else openRow(selectedId);
      } else if ((e.key === "n" || e.key === "N") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        createAndOpen(selectedId);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (selectedId === null) return;
        e.preventDefault();
        setSelectedId(onDelete(selectedId));
      } else if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
      } else if (e.key === "Escape") {
        // First Escape clears selection; a second (nothing selected) is left
        // unconsumed so the surrounding surface's Escape-out still fires.
        if (selectedId !== null) {
          e.preventDefault();
          setSelectedId(null);
        }
      }
    },
    [editingId, indexOf, selectedId, items, createAndOpen, openRow, onDelete, onUndo, onRedo],
  );

  const onEditorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // ⌘Return commits and spawns the next item (rapid chain); Escape commits
      // and returns to the list. Plain Return falls through to the field as a
      // newline — the body is multi-line.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commitAndCreateNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeRow();
      }
    },
    [closeRow, commitAndCreateNext],
  );

  // An external control (e.g. a header `+`) created a row: open it. Guarded so
  // an internally-created row (already open) doesn't re-trigger.
  const prevSignalRef = useRef<string | null | undefined>(openSignal);
  useEffect(() => {
    const signal = openSignal ?? null;
    if (signal !== null && signal !== prevSignalRef.current && signal !== editingId) {
      openRow(signal);
    }
    prevSignalRef.current = signal;
  }, [openSignal, editingId, openRow]);

  // On open, focus the first field in the editor. Programmatic focus lands the
  // caret at the field's end in WebKit, which is what we want; explicit
  // selection-range placement is deliberately avoided (it belongs only to the
  // sanctioned selection adapters).
  useLayoutEffect(() => {
    if (editingId === null) return;
    const first = editingRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    first?.focus();
  }, [editingId]);

  return {
    selectedId,
    editingId,
    containerRef,
    editingRef,
    onContainerKeyDown,
    onEditorKeyDown,
    selectRow,
    openRow,
    createAndOpen,
    closeRow,
  };
}

export function TugQuickList<T extends QuickListItem>(props: TugQuickListProps<T>): React.ReactElement {
  const { items, renderRow, renderEditor, emptyHint, className, onCreate, onDelete, onOpen, onClose, onUndo, onRedo, onReorder, openSignal } =
    props;
  const controller = useQuickList<T>({ items, onCreate, onDelete, onOpen, onClose, onUndo, onRedo, openSignal });
  const editingRef = controller.editingRef;
  const caretRef = useRef<HTMLDivElement | null>(null);

  const reorder = useBlockReorder({
    containerRef: controller.containerRef,
    caretRef,
    getVisibleOrder: () => items.map((it) => it.id),
    commit: (order) => onReorder?.([...order]),
    selector: ROW_SELECTOR,
    kindAttr: ROW_KIND_ATTR,
  });
  const reorderable = onReorder !== undefined;

  return (
    <div
      ref={controller.containerRef}
      className={className === undefined ? "tug-quick-list" : `tug-quick-list ${className}`}
      tabIndex={0}
      role="listbox"
      aria-orientation="vertical"
      onKeyDown={controller.onContainerKeyDown}
      data-testid={props["data-testid"]}
    >
      {items.length === 0 && emptyHint !== undefined ? (
        <div className="tug-quick-list-empty">{emptyHint}</div>
      ) : null}
      {items.map((item) => {
        const isEditing = controller.editingId === item.id;
        const isSelected = controller.selectedId === item.id;
        if (isEditing) {
          return (
            <div
              key={item.id}
              ref={editingRef}
              className="tug-quick-list-editor"
              data-editing="true"
              data-quicklist-row={item.id}
              onKeyDown={controller.onEditorKeyDown}
            >
              {renderEditor(item)}
            </div>
          );
        }
        return (
          <div
            key={item.id}
            className="tug-quick-list-row"
            role="option"
            aria-selected={isSelected}
            data-selected={isSelected ? "true" : undefined}
            data-quicklist-row={item.id}
            onMouseDown={() => {
              if (controller.editingId !== null && controller.editingId !== item.id) {
                controller.closeRow();
              }
              controller.selectRow(item.id);
              controller.containerRef.current?.focus();
            }}
            onDoubleClick={() => controller.openRow(item.id)}
          >
            {reorderable ? (
              <BlockGrip onPointerDown={(e) => reorder.onGripPointerDown(item.id, e)} />
            ) : null}
            <div className="tug-quick-list-row-content">{renderRow(item)}</div>
          </div>
        );
      })}
      {reorderable ? <BlockDropCaret ref={caretRef} /> : null}
    </div>
  );
}
