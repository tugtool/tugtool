# Tuglaws

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

**L06. Ephemeral appearance state goes through CSS and DOM, never React state.** State whose only consumer is rendering and whose only purpose is to look a certain way — hover highlights, focus rings, active-press feedback, `data-state` toggles — belongs in the DOM. Class toggles, attribute changes, and style mutations that don't affect React's subtree are free. Use them.

This law does not apply to semantic data that happens to have a visual representation. Data is state that non-rendering code reads and acts on; rendering is a downstream consequence of the data, not the reason it exists. Examples: a form field's current value, the selected item in a list, a card's title, a user's zoom level. Data flows through React's render cycle because that is how controlled components and derived UI work — that is the contract, not an L06 violation.

The test: *does any non-rendering consumer depend on this state?* If yes, it is data and may live in React. If no — if the only thing that reads it is the renderer itself — it is appearance and belongs in the DOM. Get this test wrong in either direction and things break: data pushed into DOM refs becomes invisible to the code that cares about it; ephemeral visual state pushed through React triggers unnecessary re-renders and subtree invalidations. [D01, D03, D84, D12, D13]

**L07. Every action handler must access current state through refs or stable singletons, never stale closures.** `useResponder` registers actions once at mount. If a handler reads a value that changes over time, it must go through a ref. [D09, D11]

**L22. When external state drives direct DOM updates, observe the store directly — don't round-trip through React's render cycle.** If a store update produces DOM writes (not React state changes), subscribe via the store's observer API in a `useLayoutEffect` and update the DOM in the callback. Do not use `useSyncExternalStore` to pull the value into React and then escape via `useEffect` to write to the DOM — that injects React's scheduling (re-render → paint → effect) between the data change and the DOM update, causing frame delays and stale-closure bugs. `useSyncExternalStore` (L02) is for state that React components *render*. Store observers are for state that drives *direct DOM mutations* (L06).

**L08. Live preview in mutation transactions is appearance-zone only; commit crosses zone boundaries.** A *mutation transaction* is the specific UX pattern where the user begins an interaction that *drafts* a change, sees the draft rendered live against the target, and then either commits the draft (persisting it) or cancels it (rolling back). The defining feature is that the draft value is not yet a committed value — it exists only long enough to be previewed, and the user may discard it. Examples: scrubbing a hue onto a mock card, dragging to reposition a draggable element, dragging an opacity slider in a style inspector.

During the draft phase, all preview mutations are CSS/DOM — the draft is not React state because it may never be committed. The commit handler may write to stores or React state; cancel rolls back via DOM. Never mix preview with state changes.

This law does not apply to continuous controls whose every intermediate value *is* a committed value. Such interactions are not mutation transactions: there is no draft-vs-commit distinction, only a stream of atomic commits. Their values flow through React state normally, the same as any other data. Examples: a volume slider, a font-size stepper, a choice group, a color picker used as a setting editor rather than as a preview tool. The phase system (`begin` / `change` / `commit` / `discrete` / `cancel`) enables mutation-tx usage where needed — it does not require it, and the presence of phased dispatches does not by itself turn a value picker into a mutation transaction.

The test: *can the user end the interaction with a result that was never committed?* If yes, it is a mutation transaction and L08 applies — preview belongs in the DOM. If no — if releasing, committing, or disconnecting always leaves the last seen value as the committed value — it is not a mutation transaction and L08 does not apply. [D64, D65]

**L23. Internal implementation operations must never lose, destroy, or cease to apply user-visible state.** Scroll position, selection, focus, and visible content are user data — the user put them there. A re-lex, re-parse, DOM rebuild, or any other internal bookkeeping operation must preserve these invariants. "Save and restore" is not preservation; it is destruction with attempted recovery. The correct approach is to diff and mutate minimally so user-visible state is never disturbed.

---

## Component Architecture

**L19. Every component follows the component authoring guide.** File structure, module docstring, props interface, `data-slot`, `@tug-pairings`, `@tug-renders-on`, and CSS organization are not suggestions — they are the contract. A component that deviates from [component-authoring.md](component-authoring.md) is incomplete. [D05, D06]

**L09. Tugcard composes chrome; CardFrame owns geometry.** Cards never set their own position, size, or z-index. CardFrame handles drag, resize, and stacking. Tugcard handles header, icon, accessory, and content. [D15, D31]

**L10. One responsibility per layer.** DeckManager owns the layout tree. DeckCanvas maps state to components. CardFrame owns geometry. Tugcard owns chrome. Card content owns domain logic. Don't reach across layers. [D05, D15]

**L11. Controls emit actions; responders own state that actions operate on.** A *control* translates a user gesture into a typed intent and dispatches it into the chain — the state that handlers will modify lives elsewhere (a parent, a store, a separate component). A *responder* owns persistent semantic state that actions mutate over time and registers handlers for the actions that mutate it. Responders have a stable identity in the chain so the first-responder promotion mechanism can address them.

The distinction is conceptual, not categorical: it is about *who owns the state an action changes*, not about what kind of widget the component happens to be. The test is, "does this component own the state that this action is going to mutate?" If no, the component is an emitter — it can dispatch the action but another node owns the state, so another node is the responder. If yes, the component must register as a responder because it is the only code that knows how to perform the action on its own state.

Most interactive widgets are controls: their state lives in a parent that passes it back in via props. When such a widget interacts with the user, it dispatches an action whose handler — somewhere up the chain — updates the parent's state, which flows back down. The widget itself holds no authoritative state. Push buttons, sliders, checkboxes, switches, radio groups, choice groups, tab bars, accordions, and popup menus are all examples of this shape.

A component that owns its own state is a responder for the actions that mutate that state. A component that owns a caret, a selection, an undo stack, and a content document is a responder for `cut` / `copy` / `paste` / `selectAll` / `undo` / `redo` — those actions operate directly on state that lives inside the component and nowhere else. A component that owns a window and its contained document is a responder for `close` / `find` / `toggleMenu`. A component that owns a layout tree is a responder for `cycleCard` / `resetLayout`. Text editors, cards, and canvases are examples of this shape.

A single component may be both an emitter and a responder for the same action. A text editor with a context menu dispatches `cut` when the user clicks the menu item; the chain's innermost-first walk routes that dispatch right back to the editor, which handles it on its own selection. Components that own state close the loop on themselves. [D08, D61, D62, D63]

**L12. Selection stays inside card boundaries.** `SelectionGuard` clamps selection on `selectionchange`. Every card registers its content area as a selection boundary. [D34, D35, D36, D37, D38]

---

## Motion

**L13. CSS handles declarative motion. TugAnimator handles programmatic motion. `requestAnimationFrame` is not for animation.** CSS (`transition`, `@keyframes`) owns hover/focus states, Radix `data-state` enter/exit, and continuous animations. TugAnimator owns animations needing completion promises, cancellation, multi-element coordination, or physics curves. RAF is for gesture-driven frame loops (drag, resize, autoscroll) that read input and write DOM each frame. [D76]

**L14. Radix Presence owns enter/exit DOM lifecycle; TugAnimator does not cross that boundary.** Radix delays DOM removal by listening for `animationend`, which WAAPI does not fire. All Radix-managed enter/exit uses CSS `@keyframes` via `tw-animate-css` + `data-state`. TugAnimator is for animations where code controls DOM insertion and removal. [D76]

---

## Token System

**L15. Interactive controls use token-driven control states; content areas stay static.** Every interactive control uses the seven-slot token convention: `--<namespace>-<plane>-control-<constituent>-<emphasis>-<role>-<state>`. States lighten progressively (rest darkest, hover, active lightest). Content areas have no state transitions. No box-shadow elevation, no translateY press-down, no gradients — color transitions provide all interaction feedback. [D85, D70, D82]

**L16. Every color-setting rule declares its rendering surface.** If a CSS rule sets `color`, `fill`, or `border-color` without setting `background-color` in the same rule, it must include a `@tug-renders-on` annotation naming its surface token. Rules that set both foreground and background are self-documenting. `audit-tokens lint` enforces this. [D81, D83]

**L17. Component alias tokens (`--tugx-*`) resolve to `--tug7-*` in one hop.** No alias-to-alias chains. Every component alias must point directly to its `--tug7-*` target. `audit-tokens lint` flags multi-hop chains. [D71]

**L18. Use element/surface as the canonical vocabulary.** Tokens producing visible marks (text, icons, borders) are *elements* (`--tug7-element-*`). Tokens defining the field behind them are *surfaces* (`--tug7-surface-*`). Contrast pairing means an element token rendered on a surface token. [D71, D82]

---

## Composition

**L20. Each component owns tokens scoped to its own component slot; composed children keep theirs.** When component A composes component B, A's CSS references only A-scoped tokens (e.g., `radio` for TugRadioGroup) and B's CSS references only B-scoped tokens (e.g., `control` for TugButton). A never overrides, aliases, or references B's tokens. B's appearance remains independently tunable per theme. The seven-slot `component` slot is the ownership boundary. [L15, L18, L19]

---

## Licensing

**L21. Third-party code and patterns require license compliance before use.** When adopting code, algorithms, or substantial implementation patterns from external libraries: (1) verify the license is permissive (MIT, Apache-2.0, BSD, ISC); (2) preserve the required copyright notice in `THIRD_PARTY_NOTICES.md` at the repository root; (3) add a comment in the consuming source file referencing the notice entry. Studying public code for ideas requires no attribution. Copying or closely adapting specific implementations does. When in doubt, attribute. Never use code under GPL, LGPL, SSPL, or other copyleft licenses without explicit approval.
