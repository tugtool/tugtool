/**
 * Tugways DOM Utility Hooks -- Barrel Export
 *
 * Three appearance-zone hooks for zero-re-render DOM mutations.
 *
 * **Authoritative reference:** design-system-concepts.md Concept 5
 * ([D12] appearance-zone discipline, [D13] single-property signatures,
 * [D14] five structure-zone rules).
 *
 * ## Usage
 *
 * ```tsx
 * import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks";
 *
 * function MyComponent() {
 *   const ref = useRef<HTMLDivElement>(null);
 *   useCSSVar(ref, "--td-accent", isActive ? "var(--td-accent-warm)" : "var(--td-accent-cool)");
 *   useDOMClass(ref, "is-highlighted", isHighlighted);
 *   useDOMStyle(ref, "border-width", isThick ? "3px" : "1px");
 *   return <div ref={ref} />;
 * }
 * ```
 *
 * ## Table T02: Zone Classification Quick Reference
 *
 * Every UI mutation in tugways belongs to exactly one zone. The zone
 * determines the mechanism -- the choice is mechanical, not a judgment call.
 *
 * | Zone       | Mechanism                                     | Hooks / Tools                                         | Re-renders              |
 * |------------|-----------------------------------------------|-------------------------------------------------------|-------------------------|
 * | Appearance | CSS custom properties, CSS classes, DOM style | useCSSVar, useDOMClass, useDOMStyle, RAF + refs        | Never                   |
 * | Local data | External mutable store + selective subscriptions | useSyncExternalStore, useState (local)              | Subscribing component only |
 * | Structure  | React state at the right ancestor level       | useState, useReducer, split contexts                  | The affected subtree    |
 *
 * ## Table T03: Five Structure-Zone Rules
 *
 * All new tugways code from Phase 4 forward must follow these rules.
 * Violations in older code are fixed when that code is next touched.
 *
 * | Rule | Statement                                                  | Anti-pattern |
 * |------|------------------------------------------------------------|--------------|
 * | 1    | State lives at the lowest common ancestor, not higher      | Lifting card-local state to deck canvas |
 * | 2    | Split contexts by domain and frequency                     | Mixing connection status and feed data in one context |
 * | 3    | Never derive state in useEffect                            | `useEffect(() => setFiltered(items.filter(...)))` |
 * | 4    | Never define components inside components                  | `function Card() { const Inner = () => <div/>; }` |
 * | 5    | Never create objects/arrays/functions inline in JSX props  | `<Child style={{ color: 'red' }} />` without stable ref |
 *
 * @module hooks
 */

export { useCSSVar } from "./use-css-var";
export { useDOMClass } from "./use-dom-class";
export { useDOMStyle } from "./use-dom-style";
