/**
 * useComponentPersistence — opt-in Component Persistence Protocol ([D13],
 * [A9]) registration hook for stateful `tugways` components.
 *
 * A component that owns user-visible state calls this hook with a stable
 * `persistKey` plus `captureState` / `restoreState` closures. The
 * framework harvests every registered component at explicit capture
 * moments (will-resign, will-hide, close-before-destroy, `saveState`
 * RPC) and writes results into `bag.components` keyed by the caller's
 * scoped persistKey.
 *
 * Three pieces collaborate:
 *
 *   - `useComponentPersistence({ persistKey, captureState, restoreState })`
 *     is the component-facing hook. Per [A9a] it stores the closures in
 *     refs synced on every render (so the framework always reads the
 *     latest render's closures, never a stale mount-time capture). The
 *     hook registers the ref pair with its nearest
 *     `ComponentPersistenceRegistry` inside a `useLayoutEffect` per
 *     [L03] — registration is in place before any event-driven consumer
 *     could call capture.
 *
 *   - `<PersistenceScope prefix>` is a context provider that prepends
 *     `prefix + "/"` to every nested `persistKey`, letting composite
 *     components embed other opt-in components without knowing their
 *     inner keys. Scopes nest additively; scope depth is carried in the
 *     context's `treePath` so the registry's parent-first iteration sees
 *     ancestors before descendants (per [D13] Q3 resolution).
 *
 *   - `CardComponentRegistryContext` carries the per-card registry
 *     reference down the tree. `CardHost` provides it; rendering a
 *     component that calls this hook outside any provider is a
 *     supported graceful case (gallery demos, standalone tests): the
 *     hook no-ops with a single dev-warn per call site.
 *
 * Opt-in: components that do not pass a `persistKey` (or that are used
 * outside a card) carry no persistence. Uniqueness of scoped keys at
 * card scope is enforced by the registry in dev (dev-only throw on
 * duplicate). Capture is synchronous and must not return a Promise; the
 * framework reads `captureRef.current()` during save and expects a
 * serializable value.
 */

import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import type { ComponentPersistenceRegistry } from "./component-persistence-registry";
import { isDevEnv } from "../../lib/dev-env";

/**
 * Internal context value carried down the React tree from `CardHost`.
 *
 *   - `registry` is `null` outside any card — a rendered-outside-a-card
 *     component should degrade gracefully (dev-warn, no-op) rather than
 *     throw, so we carry a nullable value instead of an undefined context.
 *   - `prefix` is the accumulated `<PersistenceScope>` chain, including
 *     the trailing `/` separator (empty at card root).
 *   - `treePath` records the scope depth as a sequence of sentinel
 *     indices — one segment per enclosing `<PersistenceScope>`. The
 *     registry's parent-first iteration sorts on `treePath` lex order;
 *     a deeper path is always longer than any ancestor's, so ancestors
 *     iterate first. The sentinel value is irrelevant (we always push
 *     `0`); only the length matters. Within a given depth, the
 *     registry's stable fallback preserves registration order, which
 *     matches React's document-order for siblings' effects.
 */
export interface CardComponentRegistryContextValue {
  registry: ComponentPersistenceRegistry | null;
  prefix: string;
  treePath: readonly number[];
}

const DEFAULT_CONTEXT_VALUE: CardComponentRegistryContextValue = {
  registry: null,
  prefix: "",
  treePath: [],
};

/**
 * Context carrying the per-card registry reference down the tree. Root
 * provider is `CardHost`; nested `<PersistenceScope>` providers extend
 * the prefix and treePath. Default value signals "not inside a card"
 * and the hook no-ops gracefully when encountered.
 */
export const CardComponentRegistryContext =
  createContext<CardComponentRegistryContextValue>(DEFAULT_CONTEXT_VALUE);

/**
 * Read the currently-accumulated `<PersistenceScope>` prefix. Exposed
 * for tests and for composite components that need to know their own
 * scoped namespace; most callers do not need this directly.
 */
export function usePersistenceScopePrefix(): string {
  return useContext(CardComponentRegistryContext).prefix;
}

export interface PersistenceScopeProps {
  /**
   * Prefix segment to prepend to every nested `persistKey`. The
   * terminating `/` separator is added automatically. Must be
   * non-empty; an empty prefix would collapse into the parent scope
   * and defeat the purpose of the nesting boundary.
   */
  prefix: string;
  children?: ReactNode;
}

/**
 * Wrap a subtree so nested `useComponentPersistence` calls auto-prefix
 * their keys with `prefix + "/"`. Scopes nest additively. A composite
 * component can embed other opt-in components without knowing their
 * inner `persistKey`s.
 *
 * Dev-only: an empty `prefix` throws — empty would be indistinguishable
 * from the parent scope and would silently lose the uniqueness
 * boundary.
 */
export function PersistenceScope({
  prefix,
  children,
}: PersistenceScopeProps): React.ReactElement {
  const parent = useContext(CardComponentRegistryContext);

  if (isDevEnv() && prefix.length === 0) {
    throw new Error(
      "[A9] <PersistenceScope> requires a non-empty `prefix`.",
    );
  }

  const value = useMemo<CardComponentRegistryContextValue>(
    () => ({
      registry: parent.registry,
      prefix: parent.prefix + prefix + "/",
      treePath: [...parent.treePath, 0],
    }),
    [parent.registry, parent.prefix, parent.treePath, prefix],
  );

  return (
    <CardComponentRegistryContext.Provider value={value}>
      {children}
    </CardComponentRegistryContext.Provider>
  );
}

export interface UseComponentPersistenceOptions<T> {
  /**
   * Stable identifier for this component instance's slot in
   * `bag.components`. Must be unique within the card's scope after
   * `<PersistenceScope>` prefixing; duplicates throw in dev.
   *
   * Accepts `undefined` so components can expose opt-in persistence
   * behind an optional prop without contorting their render tree to
   * avoid the hook call (a conditional `useComponentPersistence` would
   * violate the Rules of Hooks). The hook still fires every render;
   * when `persistKey` is missing it skips registration and the
   * outside-a-card dev-warn, so a non-opting caller pays no cost and
   * emits no noise.
   */
  persistKey: string | undefined;
  /**
   * Return the component's current serializable state. Must be
   * synchronous. Called by the framework at explicit capture moments
   * only; never per-keystroke.
   */
  captureState: () => T;
  /**
   * Apply a previously-captured payload to the component's state.
   * Called at most once per component mount, before user interaction
   * (see [D07]). Idempotent on unknown payload shapes is recommended
   * but not enforced — orphan keys are dropped by the framework per
   * [D13] / Q5.
   */
  restoreState: (saved: T) => void;
}

/**
 * Opt into the Component Persistence Protocol.
 *
 * Pattern:
 *
 * ```tsx
 * function TugCheckbox({ persistKey }: Props) {
 *   const [checked, setChecked] = useState(false);
 *   useComponentPersistence({
 *     persistKey,
 *     captureState: () => checked,
 *     restoreState: (saved) => { if (typeof saved === "boolean") setChecked(saved); },
 *   });
 *   // ...
 * }
 * ```
 *
 * Hook behavior outside a card (no `CardComponentRegistryContext`
 * provider): no-op with a single dev-warn per call site. Gallery demos
 * and standalone component tests therefore continue to render without
 * requiring a card wrapper.
 */
export function useComponentPersistence<T>({
  persistKey,
  captureState,
  restoreState,
}: UseComponentPersistenceOptions<T>): void {
  const { registry, prefix, treePath } = useContext(
    CardComponentRegistryContext,
  );

  // Hold the latest render's closures in refs, then re-sync on every
  // render. The framework reads `.current` at capture/restore time, so
  // the closures always see the latest React state. Refs (not state)
  // keep this out of React's update graph entirely — per [D13] Q2b,
  // [L02]-adjacent (external-state-aware but not a store).
  const captureRef = useRef<(() => unknown) | null>(null);
  const restoreRef = useRef<((saved: unknown) => void) | null>(null);
  captureRef.current = captureState as () => unknown;
  restoreRef.current = restoreState as (saved: unknown) => void;

  // Freeze the treePath at register-time so registry iteration order is
  // stable across re-renders. The scope-depth-driven path never changes
  // for a given mount.
  const treePathRef = useRef<readonly number[] | null>(null);
  if (treePathRef.current === null) {
    treePathRef.current = treePath;
  }

  // Opt-in gate: when the caller passes `persistKey === undefined` the
  // hook stays a no-op. This lets components expose a `persistKey?`
  // prop without forking their render tree. `scopedKey` is kept stable
  // as an empty string when disabled so the effect's dep array is
  // stable (the effect body early-returns before it's consulted).
  const isEnabled = typeof persistKey === "string" && persistKey.length > 0;
  const scopedKey = isEnabled ? prefix + persistKey : "";

  // One-shot dev-warn when the hook is used outside a card. A per-mount
  // ref guards the warning so repeated renders don't spam the console.
  const warnedRef = useRef(false);

  useLayoutEffect(() => {
    if (!isEnabled) return;
    if (!registry) {
      if (isDevEnv() && !warnedRef.current) {
        warnedRef.current = true;
        console.warn(
          `[A9] useComponentPersistence("${scopedKey}") rendered outside a ` +
            `CardComponentRegistryContext; state will not persist. This is ` +
            `expected in gallery demos and standalone tests.`,
        );
      }
      return;
    }

    registry.register(
      scopedKey,
      captureRef as RefObject<() => unknown>,
      restoreRef as RefObject<(saved: unknown) => void>,
      treePathRef.current ?? [],
    );
    return () => {
      registry.unregister(scopedKey);
    };
    // treePathRef is immutable for the mount; captureRef/restoreRef are
    // re-synced above and read by the framework via `.current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled, registry, scopedKey]);
}
