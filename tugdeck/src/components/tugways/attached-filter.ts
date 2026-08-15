/**
 * The attached-filter binding — the pairing of a `TugFilterField` with the
 * `TugListView` it trims, authored once and read from both ends.
 *
 * ## Why a binding rather than two wires
 *
 * The attached-list contract ([P08], `tuglaws/focus-language.md`) is
 * bidirectional, and each direction needs the other participant:
 *
 *  - **field → list.** The caret is in the field; ↑/↓ drive the list's cursor
 *    and never leave the field. The field needs the list's handle.
 *  - **list → field.** The ring is on the list; a printable character is a
 *    request to filter, so it lands in the field. The list needs the field's
 *    focus stop.
 *
 * Authored as two independent props those halves can drift: a site that wires
 * one and forgets the other is a surface where the pair behaves like a compound
 * control going down and like two strangers going up, and nothing fails loudly.
 * So the relationship is ONE object, created by {@link useAttachedFilter} and
 * handed to both participants. Each end publishes itself into it on mount and
 * reads the other end at keystroke time — never at render time, because either
 * may mount after the other (a list behind a loading state, a collapsed Lens
 * section whose body is not in the tree yet).
 *
 * ## What each end publishes
 *
 * The field publishes an {@link AttachedFilterField}: where its focus stop is,
 * whether it currently holds a query, and a one-shot note that the next focus
 * arrival is a forwarded keystroke rather than a Tab. That last one exists
 * because the field selects-all on focus (a Tab into a filter means "replace
 * what is there"), which would make a forwarded character *overwrite* a query
 * the user is trying to extend. A forwarded arrival puts the caret at the end
 * instead, so typing at the list continues the query it can see.
 *
 * The list publishes an {@link AttachedFilterList} — the cursor half the field
 * already drove before this module existed.
 *
 * @module components/tugways/attached-filter
 */

import React from "react";

/**
 * The list half of the binding. `TugListViewHandle` satisfies it structurally,
 * so this module needs no import from the list (and the two files stay free of
 * a cycle).
 */
export interface AttachedFilterList {
  /** Move the row cursor; `false` when there was nowhere to go. */
  attachedCursorMove(direction: "up" | "down"): boolean;
  /** Drop the attached highlight — the caret that owned it has left. */
  attachedCursorRelease(): void;
}

/** The field half of the binding, published by `TugFilterField` on mount. */
export interface AttachedFilterField {
  /**
   * The field's registered focus stop as a `group:order` focus key, or `null`
   * when the field is authored into no focus group (nothing to forward to).
   */
  focusKey(): string | null;
  /** Whether the field currently holds a query — gates the Backspace forward. */
  hasQuery(): boolean;
  /**
   * One-shot: the focus arrival about to happen is a forwarded keystroke, so
   * place the caret at the end rather than selecting the existing query.
   */
  noteForwardArrival(): void;
}

/**
 * The downward half of the contract, ready to spread into the field's delegate
 * — structurally the two attached-list members of `TugFilterFieldDelegate`.
 */
export interface AttachedFilterDelegate {
  attachedListMoveCursor(direction: "up" | "down"): boolean;
  attachedListDidRelease(): void;
}

/** The pairing itself. Both ends are late-bound; read, never captured. */
export interface AttachedFilterBinding {
  /** The list, once mounted. */
  list(): AttachedFilterList | null;
  /** The field, once mounted. */
  field(): AttachedFilterField | null;
  /** Publish the field half. Returns the unpublish for the effect's cleanup. */
  publishField(field: AttachedFilterField): () => void;
  /**
   * Spread into the field's delegate for the downward half. Supersedes a
   * hand-built `attachedListDelegate(…)`: taking both halves off one object is
   * what makes a half-wired pair unrepresentable.
   */
  delegate: AttachedFilterDelegate;
}

/**
 * Create a binding outside React — for a pair the component tree cannot hold in
 * one place. The Lens sections are the case: a section's field lives in its
 * band and its list in its body, siblings that can only meet through a
 * module store, so their binding is group-keyed there rather than per-render
 * here. Inside one component, use {@link useAttachedFilter}.
 *
 * `resolveList` is a function rather than the handle itself because the list
 * may mount after the field: it is read at keystroke time, never captured.
 */
export function createAttachedFilterBinding(
  resolveList: () => AttachedFilterList | null,
): AttachedFilterBinding {
  let field: AttachedFilterField | null = null;
  return {
    list: () => resolveList(),
    field: () => field,
    publishField: (published) => {
      field = published;
      return () => {
        if (field === published) field = null;
      };
    },
    delegate: {
      attachedListMoveCursor: (direction) =>
        resolveList()?.attachedCursorMove(direction) ?? false,
      attachedListDidRelease: () => {
        resolveList()?.attachedCursorRelease();
      },
    },
  };
}

/**
 * The binding for one field/list pair, stable across renders. Both participants
 * take it; neither is authored twice.
 *
 * ```tsx
 * const filter = useAttachedFilter(() => listRef.current);
 * <TugFilterField
 *   attachment={filter}
 *   delegate={{ filterFieldDidChangeQuery: setQuery, ...filter.delegate }}
 *   focusGroup={GROUP} focusOrder={1} … />
 * <TugListView ref={listRef} attachedFilter={filter} … />
 * ```
 */
export function useAttachedFilter(
  resolveList: () => AttachedFilterList | null,
): AttachedFilterBinding {
  // The resolver is read live ([L07]): a host may pass a fresh arrow each
  // render, and capturing the first one would pin a stale closure.
  const resolveRef = React.useRef(resolveList);
  resolveRef.current = resolveList;
  return React.useMemo(
    () => createAttachedFilterBinding(() => resolveRef.current()),
    [],
  );
}
