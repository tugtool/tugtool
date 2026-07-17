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
- [turn-lifecycle.md](turn-lifecycle.md) — The Dev session's assistant-turn state machine as one derived projection (`deriveLifecycleSnapshot` / `canSubmit`), and the source→delegate rule ([L28]): controls that change a turn's settings subscribe to that projection and decline while a turn is live, never reaching into the running turn.
- [responder-chain.md](responder-chain.md) — The tree of components that own semantic state, and the walk that routes typed actions through them. Read before writing any component that emits or handles an action.
- [action-naming.md](action-naming.md) — The action vocabulary. Every action has one canonical `kebab-case` name, exported as a `TUG_ACTIONS.*` constant, referenced by constant at every call site.
- [menus.md](menus.md) — The macOS menu bar as a projection of frontend state: the `menuState` wire contract, the four validation tiers, the menu-driven control-frame catalog, the identifier namespace, and the promoted-chord rule.
- [component-authoring.md](component-authoring.md) — The component author's checklist. How to build a tugways component end-to-end — files, hooks, attributes, tokens, tests.
- [focus-language.md](focus-language.md) — The keyboard-focus model: focus is a ring + behind-tint, selection is a native fill, motion is two planes (Tab linear / arrows spatial) with explicit commit. The engine attributes appearance reads, and the authoring contract (focusGroup / persistentDefaultRing / useSeedKeyView / useSpatialOrder). Read before adding a focusable control or a dialog/sheet/alert.
- [list-view-usage.md](list-view-usage.md) — House rules for `TugListView` consumers: compose `TugListRow`, never reimplement the row state ramp, the selection-ownership matrix, the consumer inventory, and the sanctioned custom-cell exceptions.
- [slash-commands.md](slash-commands.md) — How Claude Code slash commands flow through Tug end-to-end: the three-tier model (`supported-local` / `pass-through` / `hidden`), catalog sources, the decision procedure for mapping a command, the mechanical recipes, output flow-back, and the probe-and-fixture discipline. Read before touching slash-command support.
- [session-card-unsupported-slash-commands.md](session-card-unsupported-slash-commands.md) — Why some of Claude Code's slash commands are hidden from the session card's `/` popup. The maintained mirror of `HIDDEN_SLASH_COMMANDS` in `slash-supported.ts`; the discoverable answer to "why isn't `/vim` here?". Doctrine lives in `slash-commands.md`.
- [turn-metric.md](turn-metric.md) — The one canonical definition of a "turn": tugcode `totalTurns` is the authority, every other counter reconciles to it. The turn rule (S01), the `#t…m…` transcript address (S02), the four-way equality invariant, and the rewind carve-out.

## Changes & commits

- [tracking-changes.md](tracking-changes.md) — How a session's file changes are captured, classified, and committed. The two-layer doctrine (capture annotates, git status decides), the `file_events` ledger, the four capture origins (`exact`/`bash`/`turn`/`replay`), per-file contention (`shared`) and the row-liveness rule, the capture-gap inventory, the three read-side buckets (attributed/foreign/unattributed), and the commit disposition contract (exit-3 refusal, `--tree`, `left_behind`). Read before touching attribution, `tugutil context`/`commit`, or the commit skill.

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

- [devise-skeleton.md](devise-skeleton.md) — Template for plan documents (the format `/tugplug:devise` authors and `/tugplug:implement` walks). Kept here per user decision; it is a template, not a tuglaws law or architecture doc.
