/**
 * TugFilterField — the filter affordance for a long list.
 *
 * A small text field that trims the list beside it: every keystroke narrows,
 * the ✕ (or Escape) restores. It is a *trimming* control, not a search box —
 * it never jumps to a result, it only removes what the user is plainly not
 * looking for. Pair it with a list whose data source applies
 * `filterQueryMatch` to the query it reports.
 *
 * ## The delegate
 *
 * Behavior flows through a {@link TugFilterFieldDelegate}, the house delegate
 * shape (`tuglaws/lifecycle-delegates.md`): one object, optional methods are
 * no-ops, the field fires each moment unconditionally.
 * `filterFieldDidChangeQuery` is REQUIRED — a filter field with no change
 * consumer means nothing. Calls are synchronous; a keystroke filter has none
 * of the timing hazards the card-lifecycle drain queue exists to solve.
 *
 * Two sanctioned wirings, both in the tree today:
 *  - **React-state adapter** — the host holds the query in `useState` and its
 *    delegate's `filterFieldDidChangeQuery` calls the setter, which flows back
 *    into the list's data source as an input (the session picker, `/resume`).
 *  - **Module-store adapter** — the field and the list are siblings that
 *    cannot see each other, so the delegate writes a module store the list
 *    body reads through `useSyncExternalStore` (the Lens sections, via
 *    `lens-filter-store.ts`).
 *
 * ## Value authority and resets
 *
 * The `<input>` is uncontrolled: the DOM owns the text, `defaultValue` seeds
 * it, and the ✕'s visibility is a `data-empty` attribute flipped in the input
 * handler — no React state, no re-render per keystroke ([L06]). Reset the
 * field from outside by remounting it with a React `key` (the picker keys its
 * field on the project path).
 *
 * ## Escape, and why it is not a `stopPropagation`
 *
 * Escape must clear a non-empty filter *without* dismissing the sheet or
 * section around it, and must fall through to that surface's own ladder when
 * the field is already empty. Two arbiters decide Escape before a React
 * handler ever runs, so the field declines/claims at both:
 *
 *  - In a **focus mode** (a sheet, a trapped surface) the engine's Escape
 *    ladder runs first. Its first rung is the key view's `captures`
 *    predicate — so the field declares, live, that it captures `Escape` while
 *    its query is non-empty. The ladder yields and the field's own keydown
 *    clears it.
 *  - In the **base focus mode** (the Lens) a bare Escape resolves through the
 *    static keybinding map to `CANCEL_DIALOG` and dispatches into the
 *    responder chain. The field registers a `CANCEL_DIALOG` handler that
 *    exists *only while the query is non-empty* (an accessor on the actions
 *    map, which the chain reads live per dispatch) — so an empty field is not
 *    a handler at all and the walk continues to the surface above.
 *
 * Both paths read the same DOM value, so there is one source of truth for
 * "is there a filter to clear".
 *
 * Laws: [L06] appearance via DOM attributes + CSS, never React state;
 *       [L03] responder registration in a layout effect (via `useResponder`);
 *       [L11] the ✕ is a control that emits, the field handles;
 *       [L17]/[L20] one-hop component-tier aliases, composed children keep
 *       their own tokens; [L19] file pair + `data-slot`.
 *
 * @module components/tugways/tug-filter-field
 */

import "./tug-filter-field.css";

import React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { TUG_ACTIONS } from "./action-vocabulary";
import type { FocusPolicy, KeyViewBehavior } from "./focus-manager";
import { TugIconButton } from "./tug-icon-button";
import { TugInput, type TugInputSize } from "./tug-input";
import { useOptionalResponder } from "./use-responder";

/**
 * What a {@link TugFilterField} tells its host. Only
 * `filterFieldDidChangeQuery` is required; every other moment is optional and
 * a no-op when unimplemented.
 */
export interface TugFilterFieldDelegate {
  /** REQUIRED. Every input change, and `""` on a clear. */
  filterFieldDidChangeQuery(query: string): void;
  /** The ✕ or Escape-on-non-empty, AFTER the `""` change notification. */
  filterFieldDidClear?(): void;
  /** Enter in the field. */
  filterFieldDidSubmit?(query: string): void;
  /** ArrowDown — the host moves the key view onto its list. */
  filterFieldDidRequestAdvance?(): void;
  /** Escape while already empty — the host may yield focus up its ladder. */
  filterFieldDidRequestDismiss?(): void;
}

export interface TugFilterFieldProps {
  /** The behavior contract. See {@link TugFilterFieldDelegate}. */
  delegate: TugFilterFieldDelegate;
  /** Placeholder text — the house form is `Filter <section>`. */
  placeholder: string;
  /** Initial text. The field is uncontrolled; reset it by `key` remount. */
  defaultValue?: string;
  /**
   * Field size, forwarded to `TugInput`.
   * @default "sm"
   */
  size?: TugInputSize;
  /** Author the field into a focus group ([P02]); forwarded to `TugInput`. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
  /** Walk policy for the registered stop. */
  focusPolicy?: FocusPolicy;
  /** Accessible name for the field. Defaults to the placeholder. */
  "aria-label"?: string;
  /** Test hook on the wrapper. */
  "data-testid"?: string;
  /** Additional class names on the wrapper. */
  className?: string;
}

/**
 * A list's filter field. See the module docstring for the delegate contract,
 * the value-authority model, and the two Escape arbiters.
 */
export function TugFilterField({
  delegate,
  placeholder,
  defaultValue,
  size = "sm",
  focusGroup,
  focusOrder,
  focusPolicy,
  "aria-label": ariaLabel,
  "data-testid": dataTestid,
  className,
}: TugFilterFieldProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  // WebKit collapses a programmatic `select()` on the mouseup that ends the
  // focusing click; one guarded `preventDefault` keeps the selection.
  const pendingFocusClickRef = React.useRef(false);

  // The delegate is read at call time, never captured, so a host may pass a
  // fresh object each render without stale notifications.
  const delegateRef = React.useRef(delegate);
  delegateRef.current = delegate;

  const currentQuery = React.useCallback(
    (): string => inputRef.current?.value ?? "",
    [],
  );

  /** Reflect emptiness onto the wrapper so CSS reveals the ✕ ([L06]). */
  const syncEmptyAttribute = React.useCallback((): void => {
    wrapperRef.current?.setAttribute(
      "data-empty",
      currentQuery() === "" ? "true" : "false",
    );
  }, [currentQuery]);

  const clear = React.useCallback((): void => {
    const input = inputRef.current;
    if (input === null) return;
    input.value = "";
    syncEmptyAttribute();
    delegateRef.current.filterFieldDidChangeQuery("");
    delegateRef.current.filterFieldDidClear?.();
    input.focus();
  }, [syncEmptyAttribute]);

  // Chain rung: a bare Escape in the base focus mode arrives here as
  // CANCEL_DIALOG. The handler is an accessor so an EMPTY field exposes no
  // handler at all and the walk continues to the surface above — the chain
  // reads the actions map live on every dispatch, so this needs no re-render.
  const responderId = React.useId();
  const actions = React.useMemo(
    () => ({
      get [TUG_ACTIONS.CANCEL_DIALOG](): (() => void) | undefined {
        return currentQuery() === "" ? undefined : clear;
      },
    }),
    [clear, currentQuery],
  );
  const { ResponderScope, responderRef } = useOptionalResponder({
    id: responderId,
    actions,
  });

  // Engine rung: while the query is non-empty the field owns Escape, so the
  // Escape ladder yields instead of dismissing the surrounding surface.
  const focusBehavior = React.useCallback(
    (): KeyViewBehavior => ({
      container: "none",
      captures: (key) => key.key === "Escape" && currentQuery() !== "",
    }),
    [currentQuery],
  );

  const onChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      syncEmptyAttribute();
      delegateRef.current.filterFieldDidChangeQuery(event.target.value);
    },
    [syncEmptyAttribute],
  );

  const onFocus = React.useCallback((): void => {
    inputRef.current?.select();
  }, []);

  const onMouseDown = React.useCallback((): void => {
    pendingFocusClickRef.current =
      document.activeElement !== inputRef.current;
  }, []);

  const onMouseUp = React.useCallback((event: React.MouseEvent): void => {
    if (!pendingFocusClickRef.current) return;
    pendingFocusClickRef.current = false;
    event.preventDefault();
  }, []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape") {
        if (currentQuery() !== "") {
          event.preventDefault();
          event.stopPropagation();
          clear();
          return;
        }
        delegateRef.current.filterFieldDidRequestDismiss?.();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        delegateRef.current.filterFieldDidSubmit?.(currentQuery());
        return;
      }
      if (event.key === "ArrowDown") {
        if (delegateRef.current.filterFieldDidRequestAdvance === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        delegateRef.current.filterFieldDidRequestAdvance();
      }
    },
    [clear, currentQuery],
  );

  const setWrapperRef = React.useCallback(
    (el: HTMLDivElement | null): void => {
      wrapperRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  return (
    <div
      ref={setWrapperRef}
      data-slot="tug-filter-field"
      data-empty={defaultValue === undefined || defaultValue === "" ? "true" : "false"}
      data-testid={dataTestid}
      className={cn("tug-filter-field", className)}
    >
      <ResponderScope>
        <TugInput
          ref={inputRef}
          type="text"
          size={size}
          className="tug-filter-field-input"
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          defaultValue={defaultValue}
          spellCheck={false}
          autoComplete="off"
          focusGroup={focusGroup}
          focusOrder={focusOrder}
          focusPolicy={focusPolicy}
          focusBehavior={focusBehavior}
          onChange={onChange}
          onFocus={onFocus}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onKeyDown={onKeyDown}
        />
        <span className="tug-filter-field-clear">
          <TugIconButton
            icon={<X />}
            aria-label="Clear filter"
            size="2xs"
            onClick={clear}
          />
        </span>
      </ResponderScope>
    </div>
  );
}
