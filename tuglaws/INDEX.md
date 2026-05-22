# Tuglaws — Reading Guide

*Where to look for what. Each entry below is a single source of truth for its topic; cross-references take you between docs without duplicating content.*

## Start here

- [framework-architecture.md](framework-architecture.md) — Narrative overview of the tug framework: React for tree reconciliation, CSS+DOM for appearance, the responder chain for action routing. Read first.
- [tuglaws.md](tuglaws.md) — The numbered laws (`[L##]`). Invariants every change is checked against; violations require updating the design first.
- [design-decisions.md](design-decisions.md) — The numbered decisions (`[D##]`). Each entry records a non-obvious choice and its rationale; laws reference decisions and vice versa.
- [recipes.md](recipes.md) — Named patterns the laws imply but don't spell out (`[R#]`). Reach for the recipe by name when a situation matches; reference implementations cited inline.

## Component & UI architecture

- [pane-model.md](pane-model.md) — The Deck → Pane → Card hierarchy. What each level owns; the naming rules that encode it across code, CSS, DOM, wire format, and menus.
- [card-state-model.md](card-state-model.md) — Selection, focus, scroll, and form-control values across tabs, pane activation, and reload. The per-axis contract; cross-refs `state-preservation.md` for the underlying protocol.
- [state-preservation.md](state-preservation.md) — The [A9] save/restore protocol end-to-end: `useComponentStatePreservation`, `useCardStatePreservation`, FocusSnapshot, CardStateBag. Read this for the mechanism; read `card-state-model.md` for the per-axis contract.
- [lifecycle-delegates.md](lifecycle-delegates.md) — The deck-level `TugCardDelegate` event pipe: construction, activation, deactivation, move, resize, destruction. The `MessageChannel` drain queue; `CardHost` portal lifecycle.
- [route-lifecycle.md](route-lifecycle.md) — The per-prompt-entry `RouteLifecycle` pipe: how the command route is held as external state and how route changes reach observers. The route-scoped sibling of `lifecycle-delegates.md` — synchronous, finer-grained.
- [responder-chain.md](responder-chain.md) — The tree of components that own semantic state, and the walk that routes typed actions through them. Read before writing any component that emits or handles an action.
- [action-naming.md](action-naming.md) — The action vocabulary. Every action has one canonical `kebab-case` name, exported as a `TUG_ACTIONS.*` constant, referenced by constant at every call site.
- [component-authoring.md](component-authoring.md) — The component author's checklist. How to build a tugways component end-to-end — files, hooks, attributes, tokens, tests.

## Theming, palette, tokens

- [token-naming.md](token-naming.md) — The seven-slot prefix scheme for CSS custom properties. Every design-system token declares its kind in its name.
- [color-palette.md](color-palette.md) — The TugColor OKLCH palette. Components consume semantic tokens; the palette provides the colors those tokens resolve to.
- [theme-engine.md](theme-engine.md) — The CSS-first, file-based theme runtime. How themes load, switch, and override tokens at runtime.

## Testing & build infrastructure

- [app-test-harness.md](app-test-harness.md) — Architecture of the `Tug.app` integration-test harness: subprocess driving, WKWebView, the trusted-event problem, fidelity envelope, lifecycle model.
- [app-test-inventory.md](app-test-inventory.md) — The AT-tag catalog. Stable, append-only identifiers gating selection / focus / state-preservation regression tests.
- [code-signing-mac.md](code-signing-mac.md) — The `Tug Dev` self-signed signing pipeline (macOS only). Why the app-test harness depends on it; procedures and failure modes.
- [wasm-crates.md](wasm-crates.md) — WASM crates in tugdeck (`tugmark-wasm`, `tugdiff-wasm`). Per-crate layout, build pipeline, lazy-load convention, and the checklist for adding a new one.

## Templates

- [tugplan-skeleton.md](tugplan-skeleton.md) — Template for `roadmap/` plan documents. Kept here per user decision; it is a template, not a tuglaws law or architecture doc.
