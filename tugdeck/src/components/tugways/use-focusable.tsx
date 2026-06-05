/**
 * useFocusable -- register a component as a focusable in the focus engine.
 *
 * The focus-engine sibling of `useResponder`: where `useResponder` registers
 * a node in the action-routing chain, `useFocusable` registers a stop in the
 * app-authored Tab walk. A component can be both -- the two axes (action
 * routing vs. keyboard target) are independent ([P01]).
 *
 * Tolerant by design, exactly like `useOptionalResponder` ([L26]): inside a
 * `FocusManagerContext` it registers the focusable and writes
 * `data-tug-focusable`; outside one it is a silent no-op so leaf controls can
 * still render in standalone previews and tests without a provider. The
 * returned `focusableRef` and the registration both key off the manager, so a
 * provider transition (null <-> non-null) flips the registration and the
 * attribute without ever replacing the DOM element -- mount identity is
 * preserved.
 *
 * Registration runs in `useLayoutEffect` ([L03]): the focusable must be in the
 * registry before any keyboard handler that walks it can fire. `consumesTab`
 * is held by reference (read live at dispatch time) so a component can toggle
 * its Tab-consuming sub-state without re-registering; structural fields
 * (`id` / `group` / `order` / `policy`) re-register when they change.
 */

import React, { useCallback, useContext, useLayoutEffect, useRef } from "react";
import { FocusManagerContext, FocusModeContext } from "./focus-manager";
import type { FocusPolicy, KeyViewBehavior } from "./focus-manager";

// ---- Options / result ----

export interface UseFocusableOptions {
  /** Stable id for this focusable. Should be a constant at the call site. */
  id: string;
  /** Named focus group; the walk sorts by (group ordinal, item order) ([P02]). */
  group: string;
  /** Item order within the group. */
  order: number;
  /** Walk policy. Defaults to `accept`. */
  policy?: FocusPolicy;
  /**
   * Whether to actually register. Defaults to `true`. A control that is only
   * *authored* into the Tab walk by its surrounding surface passes `false`
   * until that surface supplies a group — keeping it a plain native focus stop
   * (the global ring still paints on keyboard focus) without making the app's
   * walk non-empty and thereby suppressing native Tab for its un-authored
   * siblings. The end-state model: a control joins the walk when its surface
   * authors a focus group for it ([P02]).
   */
  register?: boolean;
  /**
   * Transient "I consume Tab right now" predicate (e.g. an editor with an open
   * completion). Held by reference and read live, so toggling it does not
   * re-register the focusable.
   */
  consumesTab?: () => boolean;
  /**
   * The component's key-view behavior ([P01]) — container kind, commit mode,
   * descend/select/act callbacks, and a key-capture predicate. Read live at
   * dispatch time (held by reference), so a component may vary what its current
   * item descends to without re-registering. Omit for a plain focus stop.
   */
  behavior?: () => KeyViewBehavior | null;
}

export interface UseFocusableResult {
  /**
   * Ref callback to attach to the focusable's root DOM element. Writes
   * `data-tug-focusable="<id>"` so the manager can project the key view onto
   * the DOM and resolve the element for a given focusable id.
   */
  focusableRef: (el: Element | null) => void;
}

// ---- useFocusable ----

/**
 * Register the calling component as a focusable. **Tolerant form** -- the only
 * form, matching the focus engine's "every interactive affordance can opt in
 * from anywhere" stance. No-ops outside a `FocusManagerContext`.
 */
export function useFocusable(options: UseFocusableOptions): UseFocusableResult {
  const manager = useContext(FocusManagerContext);
  // The focus mode this focusable belongs to: the surrounding surface's pushed
  // mode (via `useFocusTrap` → `FocusModeContext`), or the base mode in the app
  // shell. A trapped surface's contents thus join its mode and the Tab walk
  // cycles within them ([#cfrunloop-model]).
  const focusMode = useContext(FocusModeContext);

  // Latest options, read by the live `consumesTab` proxy without
  // re-registering. Same shape as `useOptionalResponder`'s `optionsRef`.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Tracks the element the ref callback last saw, so a provider transition can
  // remove the attribute from the prior element.
  const currentElementRef = useRef<Element | null>(null);

  // Register in the commit phase; unregister on unmount or before re-register.
  // Structural fields are in the dep array so a change re-registers; the
  // function-typed `consumesTab` is intentionally NOT, to avoid thrashing the
  // effect on every render -- it is read live through `optionsRef`.
  const { id, group, order, policy, register = true } = options;
  useLayoutEffect(() => {
    if (manager === null || !register) return;
    manager.registerFocusable({
      id,
      group,
      order,
      policy,
      modes: [focusMode],
      consumesTab: () => optionsRef.current.consumesTab?.() ?? false,
      behavior: () => optionsRef.current.behavior?.() ?? null,
    });
    return () => {
      manager.unregisterFocusable(id);
    };
  }, [manager, id, group, order, policy, register, focusMode]);

  // A stop authored into a focus group opts into the focus-preservation axis
  // ([card-state-model]): a stable `data-tug-focus-key` (its authored
  // `group:order`, identical every mount — unlike the per-render `useId()`)
  // lets `captureFocus` record it as `{ kind: "dom" }` and `applyBagFocus`
  // resolve the same element on cold-boot restore, carrying the keyboard ring
  // with it. Un-authored stops (no `group`) are not restorable and stay out.
  const focusKey = register && group !== "" ? `${group}:${order}` : null;

  // Stable ref callback that writes `data-tug-focusable` (and the focus-key)
  // only when a manager is in scope. Mirrors `useOptionalResponder`'s
  // `responderRef`: the DOM element is never replaced across a provider
  // transition, only the attribute flips.
  const focusableRef = useCallback(
    (el: Element | null) => {
      const prev = currentElementRef.current;
      if (prev && prev !== el) {
        prev.removeAttribute("data-tug-focusable");
        prev.removeAttribute("data-tug-focus-key");
      }
      if (el && manager !== null && register) {
        el.setAttribute("data-tug-focusable", id);
        if (focusKey !== null) el.setAttribute("data-tug-focus-key", focusKey);
      }
      currentElementRef.current = el;
    },
    [id, manager, register, focusKey],
  );

  return { focusableRef };
}

// ---- useRovingFocusable ----

export interface UseRovingFocusableResult {
  /**
   * Point the group's single focusable at the member that currently holds
   * roving focus (the `tabIndex=0` element), or `null`. Moves the engine's
   * `data-tug-focusable` onto it and, when the group holds the key view,
   * re-projects the ring onto it. Pass `keyboard: true` for arrow-roving (the
   * ring follows the arrows), `false` for a pointer-driven move within the group
   * (the ring clears), or omit to preserve the current modality. Call it
   * whenever the roved member changes.
   */
  setRovedElement: (el: Element | null, keyboard?: boolean) => void;
}

/**
 * Register a **roving group** as a single stop in the Tab walk. Where
 * `useFocusable` projects the key view onto one fixed element, a roving group
 * (tab bar, radio / option / choice group, accordion, list) is one Tab stop
 * whose *projected element* moves under arrow navigation. The group registers
 * one focusable id; `setRovedElement` carries that id's `data-tug-focusable`
 * (and, when the group holds the key view, the focus ring) onto whichever member
 * currently has roving focus, via the manager's `refreshKeyViewProjection`.
 *
 * Tolerant by design like `useFocusable` ([L26]): a silent no-op outside a
 * `FocusManagerContext`. Registration runs in `useLayoutEffect` ([L03]) so the
 * focusable is in the registry before any Tab handler walks it. The ring
 * tracking is pure DOM mutation through the manager — no React state, no
 * re-render ([L06] appearance via DOM, [L22] observe/mutate without round-trip);
 * current options are read live through a ref ([L07]).
 */
export function useRovingFocusable(options: UseFocusableOptions): UseRovingFocusableResult {
  const manager = useContext(FocusManagerContext);
  const focusMode = useContext(FocusModeContext);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // The element that currently carries this group's `data-tug-focusable`.
  const rovedElementRef = useRef<Element | null>(null);

  const { id, group, order, policy, register = true } = options;
  useLayoutEffect(() => {
    if (manager === null || !register) return;
    manager.registerFocusable({
      id,
      group,
      order,
      policy,
      modes: [focusMode],
      consumesTab: () => optionsRef.current.consumesTab?.() ?? false,
      behavior: () => optionsRef.current.behavior?.() ?? null,
    });
    return () => {
      manager.unregisterFocusable(id);
      const el = rovedElementRef.current;
      if (el) {
        el.removeAttribute("data-tug-focusable");
        rovedElementRef.current = null;
      }
    };
  }, [manager, id, group, order, policy, register, focusMode]);

  const setRovedElement = useCallback(
    (el: Element | null, keyboard?: boolean) => {
      const prev = rovedElementRef.current;
      if (prev !== el) {
        if (prev) prev.removeAttribute("data-tug-focusable");
        if (el && manager !== null && register) {
          el.setAttribute("data-tug-focusable", id);
        }
        rovedElementRef.current = el;
      }
      // When this group holds the key view, chase the projection onto the new
      // member so the ring follows the arrows — appearance-zone DOM only ([L06]).
      if (manager !== null && manager.keyView() === id) {
        manager.refreshKeyViewProjection(keyboard);
      }
    },
    [id, manager, register],
  );

  return { setRovedElement };
}

/**
 * Returns the nearest `FocusManager`, or `null` outside a provider. Sibling of
 * `useResponderChain`.
 */
export function useFocusManager() {
  return useContext(FocusManagerContext);
}
