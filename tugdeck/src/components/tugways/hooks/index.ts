/**
 * Tugways DOM Utility Hooks -- Barrel Export
 *
 * Three appearance-zone hooks for zero-re-render DOM mutations.
 * Part of the three-zone mutation model (design-system-concepts.md Concept 5).
 *
 * ## Three Mutation Zones
 *
 * | Zone       | Mechanism                                          | Hooks / Tools              | Re-renders |
 * |------------|----------------------------------------------------|----------------------------|------------|
 * | Appearance | CSS custom properties, CSS classes, DOM style      | useCSSVar, useDOMClass, useDOMStyle, RAF + refs | Never |
 * | Local data | External mutable store + selective subscriptions   | useSyncExternalStore, useState (local) | Subscribing component only |
 * | Structure  | React state at the right ancestor level            | useState, useReducer, split contexts | Affected subtree |
 *
 * ## Five Structure-Zone Rules
 *
 * All new code from Phase 4 forward must follow these rules:
 *
 * | Rule | Statement                                          | Anti-pattern |
 * |------|----------------------------------------------------|--------------|
 * | 1    | State lives at the lowest common ancestor, not higher | Lifting card-local state to deck canvas |
 * | 2    | Split contexts by domain and frequency             | Mixing connection status and feed data in one context |
 * | 3    | Never derive state in useEffect                    | `useEffect(() => setFiltered(items.filter(...)))` |
 * | 4    | Never define components inside components          | `function Card() { const Inner = () => <div/>; }` |
 * | 5    | Never create objects/arrays/functions inline in JSX props | `<Child style={{ color: 'red' }} />` without stable ref |
 *
 * ## References
 *
 * - design-system-concepts.md Concept 5, [D12] (appearance-zone), [D14] (structure rules)
 *
 * @module hooks
 */

export { useCSSVar } from "./use-css-var";
export { useDOMClass } from "./use-dom-class";
export { useDOMStyle } from "./use-dom-style";
