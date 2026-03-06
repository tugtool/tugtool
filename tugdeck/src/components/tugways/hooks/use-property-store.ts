/**
 * use-property-store.ts -- usePropertyStore hook and TugcardPropertyContext.
 *
 * Provides a React hook for card content components to create and register a
 * PropertyStore with the enclosing Tugcard. Inspectors can then discover,
 * read, write, and observe properties without importing card internals.
 *
 * Usage:
 * ```tsx
 * function MyCardContent() {
 *   const store = usePropertyStore({
 *     schema: [
 *       { path: 'style.backgroundColor', type: 'color', label: 'Background' },
 *     ],
 *     initialValues: { 'style.backgroundColor': '#ffffff' },
 *   });
 *
 *   const bg = useSyncExternalStore(
 *     cb => store.observe('style.backgroundColor', cb),
 *     () => store.get('style.backgroundColor') as string,
 *   );
 *
 *   return <div style={{ backgroundColor: bg }}>Content</div>;
 * }
 * ```
 *
 * Design decisions:
 *   [D01] Context callback registration for PropertyStore
 *   [D05] Per-path observe for useSyncExternalStore
 *
 * Spec S04, Spec S05
 *
 * See also: tugplan-tugways-phase-5d4-observable-properties.md
 */

import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { PropertyStore } from "../property-store";
import type { PropertyDescriptor } from "../property-store";

// ---------------------------------------------------------------------------
// TugcardPropertyContext (Spec S05)
// ---------------------------------------------------------------------------

/**
 * Registration callback type. Tugcard provides this callback so that card
 * content can register its PropertyStore.
 *
 * Spec S05 (#s05-tugcard-property-context)
 */
export type PropertyStoreRegistrar = (store: PropertyStore) => void;

/**
 * React context that Tugcard provides with a registration callback.
 *
 * Card content calls usePropertyStore(), which internally calls this callback
 * in useLayoutEffect to install the store. This mirrors the TugcardDataContext
 * pattern.
 *
 * Default value is null so usePropertyStore() works outside a Tugcard without
 * throwing -- the registration call is simply skipped.
 *
 * [D01] Context callback registration for PropertyStore
 * Spec S05 (#s05-tugcard-property-context)
 */
export const TugcardPropertyContext = createContext<PropertyStoreRegistrar | null>(null);

// ---------------------------------------------------------------------------
// usePropertyStore options (Spec S04)
// ---------------------------------------------------------------------------

/**
 * Options for creating a PropertyStore via usePropertyStore.
 *
 * Spec S04 (#s04-use-property-store)
 */
export interface UsePropertyStoreOptions {
  /** Property descriptors defining the schema. */
  schema: PropertyDescriptor[];
  /** Initial values for each schema path. */
  initialValues: Record<string, unknown>;
  /**
   * Optional override for get(). When provided, get() calls onGet instead of
   * reading from the internal map. Used for bridging to external state.
   */
  onGet?: (path: string) => unknown;
  /**
   * Optional side-effect hook for set(). Called after internal write and
   * observer notification.
   */
  onSet?: (path: string, value: unknown, source: string) => void;
}

// ---------------------------------------------------------------------------
// usePropertyStore hook (Spec S04)
// ---------------------------------------------------------------------------

/**
 * Create a PropertyStore and register it with the enclosing Tugcard.
 *
 * The store is created once on first render via useRef -- it is stable across
 * re-renders. The store is registered with Tugcard via TugcardPropertyContext
 * in useLayoutEffect (Rule #3) so it is available before events fire.
 *
 * Returns the stable PropertyStore instance. Card content uses the store
 * directly for useSyncExternalStore subscriptions:
 *
 * ```ts
 * useSyncExternalStore(
 *   cb => store.observe(path, cb),
 *   () => store.get(path),
 * )
 * ```
 *
 * [D01] Context callback registration for PropertyStore
 * Spec S04 (#s04-use-property-store)
 */
export function usePropertyStore(options: UsePropertyStoreOptions): PropertyStore {
  // Create the PropertyStore once on first render. The ref holds the stable
  // instance across re-renders. We initialize lazily using a sentinel ref.
  const storeRef = useRef<PropertyStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new PropertyStore({
      schema: options.schema,
      initialValues: options.initialValues,
      onGet: options.onGet,
      onSet: options.onSet,
    });
  }

  // Capture the registration callback from Tugcard's context. May be null
  // when rendered outside a Tugcard.
  const registrar = useContext(TugcardPropertyContext);

  // Ref for the registrar so the useLayoutEffect closure stays fresh even if
  // the context value changes (Rule #5).
  const registrarRef = useRef(registrar);
  registrarRef.current = registrar;

  // Register the store with Tugcard in useLayoutEffect (Rule #3) so the store
  // is available before any events fire. Re-runs if the store instance changes
  // (which only happens on mount since storeRef is stable).
  useLayoutEffect(() => {
    const store = storeRef.current!;
    registrarRef.current?.(store);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return storeRef.current;
}

// Re-export PropertyStore and related types for convenience
export type { PropertyDescriptor } from "../property-store";
export { PropertyStore } from "../property-store";
export type { PropertySchema, PropertyChange, PropertyChangeListener } from "../property-store";

