# Laws of Tug

*Invariants for the tugways system. Violating any law requires updating the design first — never silently diverge.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` references within this file.*

---

## Rendering Discipline

**L01. One `root.render()`, at mount, ever.** State changes flow through subscribable stores or direct DOM manipulation. Never re-render the root from external code. [D40, D42]

**L02. External state enters React through `useSyncExternalStore` only.** No `useState` + manual sync. No `useEffect` copying external values into React state. [D40, D68]

**L03. Use `useLayoutEffect` for registrations that events depend on.** Responder nodes, selection boundaries, and any setup that keyboard/pointer handlers require must be complete before events fire. [D41]

**L04. Never measure child DOM inline after triggering child `setState` from a parent effect.** The child's DOM is stale until its own commit. Use a child-driven ready callback via `useLayoutEffect`. [D78]

**L05. Never use `requestAnimationFrame` for operations that depend on React state commits.** RAF timing relative to React's commit cycle is a browser implementation detail, not a contract. Use the ready-callback pattern (L04). [D79]

---

## State and Mutation Zones

**L06. Appearance changes go through CSS and DOM, never React state.** Class toggles, attribute changes, and style mutations that don't affect React's subtree are free. Use them. [D01, D03, D12, D13]

**L07. Every action handler must access current state through refs or stable singletons, never stale closures.** `useResponder` registers actions once at mount. If a handler reads a value that changes over time, it must go through a ref. [D09, D11]

**L08. Live preview is appearance-zone only; commit crosses zone boundaries.** During mutation transactions, all preview mutations are CSS/DOM. The commit handler may write to stores or React state. Never mix preview with state changes. [D64, D65]

---

## Component Architecture

**L09. Tugcard composes chrome; CardFrame owns geometry.** Cards never set their own position, size, or z-index. CardFrame handles drag, resize, and stacking. Tugcard handles header, icon, accessory, and content. [D15, D31]

**L10. One responsibility per layer.** DeckManager owns the layout tree. DeckCanvas maps state to components. CardFrame owns geometry. Tugcard owns chrome. Card content owns domain logic. Don't reach across layers. [D05, D15]

**L11. Controls emit actions; responders handle actions.** Controls (buttons, sliders, pickers) are not responder nodes. They dispatch ActionEvents into the chain. Responders receive and handle them. [D08, D61, D62, D63]

**L12. Selection stays inside card boundaries.** `SelectionGuard` clamps selection on `selectionchange`. Every card registers its content area as a selection boundary. [D34, D35, D36, D37, D38]

---

## Motion

**L13. CSS handles declarative motion. TugAnimator handles programmatic motion. `requestAnimationFrame` is not for animation.** CSS (`transition`, `@keyframes`) owns hover/focus states, Radix `data-state` enter/exit, and continuous animations. TugAnimator owns animations needing completion promises, cancellation, multi-element coordination, or physics curves. RAF is for gesture-driven frame loops (drag, resize, autoscroll) that read input and write DOM each frame. [D76]

**L14. Radix Presence owns enter/exit DOM lifecycle; TugAnimator does not cross that boundary.** Radix delays DOM removal by listening for `animationend`, which WAAPI does not fire. All Radix-managed enter/exit uses CSS `@keyframes` via `tw-animate-css` + `data-state`. TugAnimator is for animations where code controls DOM insertion and removal. [D76]

---

## Token System

**L15. Interactive controls use token-driven control states; content areas stay static.** Every interactive control uses the six-slot token convention: `--tug-base-<plane>-control-<constituent>-<emphasis>-<role>-<state>`. States lighten progressively (rest darkest, hover, active lightest). Content areas have no state transitions. No box-shadow elevation, no translateY press-down, no gradients — color transitions provide all interaction feedback. [D04, D70, D82]

**L16. Every color-setting rule declares its rendering surface.** If a CSS rule sets `color`, `fill`, or `border-color` without setting `background-color` in the same rule, it must include a `@tug-renders-on` annotation naming its surface token. Rules that set both foreground and background are self-documenting. `audit-tokens lint` enforces this. [D81, D83]

**L17. Component alias tokens resolve to `--tug-base-*` in one hop.** No alias-to-alias chains. Every component alias must point directly to its `--tug-base-*` target. `audit-tokens lint` flags multi-hop chains. [D71]

**L18. Use element/surface as the canonical vocabulary.** Tokens producing visible marks (text, icons, borders) are *elements* (`--tug-base-element-*`). Tokens defining the field behind them are *surfaces* (`--tug-base-surface-*`). Contrast pairing means an element token rendered on a surface token. [D71, D82]
