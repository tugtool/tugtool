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
import type { FocusPolicy } from "./focus-manager";

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
    });
    return () => {
      manager.unregisterFocusable(id);
    };
  }, [manager, id, group, order, policy, register, focusMode]);

  // Stable ref callback that writes `data-tug-focusable` only when a manager
  // is in scope. Mirrors `useOptionalResponder`'s `responderRef`: the DOM
  // element is never replaced across a provider transition, only the
  // attribute flips.
  const focusableRef = useCallback(
    (el: Element | null) => {
      const prev = currentElementRef.current;
      if (prev && prev !== el) {
        prev.removeAttribute("data-tug-focusable");
      }
      if (el && manager !== null && register) {
        el.setAttribute("data-tug-focusable", id);
      }
      currentElementRef.current = el;
    },
    [id, manager, register],
  );

  return { focusableRef };
}

/**
 * Returns the nearest `FocusManager`, or `null` outside a provider. Sibling of
 * `useResponderChain`.
 */
export function useFocusManager() {
  return useContext(FocusManagerContext);
}
