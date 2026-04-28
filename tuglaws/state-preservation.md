# State Preservation

*The component- and card-level state preservation protocol — capture, persist, restore. The mechanism that makes [card-state-model.md](card-state-model.md)'s per-axis contracts (focus, scroll, form-control value) hold across tab switches, pane activation, app hide/unhide, and cold-boot reload.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [tuglaws.md](tuglaws.md).*

---

## Why

[L23] — *internal implementation operations must never lose, destroy, or cease to apply user-visible state* — is the law this document implements. Scroll position, form-control value, selection, and focus are user data. The user put them there. A re-lex, a tab switch, a pane teardown, a cold-boot reload, or any other framework-driven bookkeeping operation must not be observable in any of those axes.

The naïve interpretation of L23 is "save and restore." That interpretation is wrong: save-and-restore is destruction with attempted recovery, and recovery is fallible. A capture that misses an axis loses the user's data. A restore that fires before the DOM is ready paints the user's selection on the wrong element. A `requestAnimationFrame` that races React's commit cycle drops focus.

The correct interpretation is **preserve where you can, capture-and-replay only when you must**. In-app transitions (intra-pane tab switch, pane activation change, drag aborted) preserve by leaving the DOM mounted; the user's state stays alive in the live tree without any save call ever firing. Cold-boot restore, cross-pane move, and tab-close-then-reopen genuinely have nothing to preserve — the DOM is gone — so the protocol captures the user's state into a serialized `CardStateBag` at the moment of teardown and replays it on reconstruction.

This document describes that capture-and-replay machinery: the two layers of opt-in, the deterministic save/restore lifecycle, the DOM attributes that drive it, the type shapes, and the per-axis tests that gate it ([A9]).

---

## Two layers of opt-in

The protocol has two layers because the question "what is the unit of preserved state?" has two answers in tugdeck.

### Component-level — `useComponentStatePreservation`

An individual stateful control opts in by passing a `componentStatePreservationKey` to its hook call. The framework treats the control as a leaf: at capture time it reads the control's current state via the registered `captureState` closure; at restore time it pushes a previously captured payload back through `restoreState`. The component owns the meaning of the payload (a boolean for a checkbox, a number for a slider, the open accordion section index for an accordion) and the framework treats it as opaque JSON.

The hook is implemented in [`use-component-state-preservation.tsx`](../tugdeck/src/components/tugways/use-component-state-preservation.tsx). Usage:

```tsx
function TugCheckbox({ componentStatePreservationKey, ...props }: Props) {
  const [checked, setChecked] = useState(false);
  useComponentStatePreservation({
    componentStatePreservationKey,
    captureState: () => checked,
    restoreState: (saved) => {
      if (typeof saved === "boolean") setChecked(saved);
    },
  });
  // ...
}
```

This layer is the right tool when the unit of state is a single control's intrinsic value (slider position, accordion expanded section, switch on/off). Composite controls compose by wrapping their subtree in `<ComponentStatePreservationScope prefix="...">`, which prepends `prefix + "/"` to every nested key — composite components can embed other opt-in components without knowing their inner keys.

Captured payloads land in `bag.components`, keyed by the (scoped) `componentStatePreservationKey`. Every entry is JSON-serializable; the framework persists the bag through tugbank.

### Card-level — `useCardStatePreservation`

A card's content factory (the React component rendered inside `CardHost`) opts in by registering an `onSave` / `onRestore` callback pair. This is the right tool when the unit of state is a richer payload that the card-content component itself manages — the document of a tide engine, the route + tools-open chrome of a `tug-prompt-entry`, the cursor + decoration state of a code editor.

The hook is implemented in [`use-card-state-preservation.tsx`](../tugdeck/src/components/tugways/use-card-state-preservation.tsx). Usage:

```tsx
function TideCardContent() {
  useCardStatePreservation<TideContentBag>({
    onSave: () => engine.snapshot(),
    onRestore: (state, { isActive }) => {
      engine.applySnapshot(state);
      if (isActive) engine.paintMirrorAsActive();
      else engine.paintMirrorAsInactive(publish);
    },
    onCardActivated: () => engine.paintMirrorAsActive(),
    onCardWillDeactivate: () => engine.paintMirrorAsInactive(publish),
  });
  // ...
}
```

`onSave` is called by `CardHost` on tab deactivation and on `saveState` RPC; `onRestore` is called on cold-boot mount and after cross-pane move. Both layers can coexist within the same card — a tide-card content uses `useCardStatePreservation` for its engine document, and the chrome around it (a `TugCheckbox` in a sidebar, a `TugAccordion` in a settings drawer) opts into `useComponentStatePreservation` independently. Their captures land in different axes of the bag (`bag.content` vs. `bag.components`) and never collide.

---

## Public identifiers

Everything below is grep-stable. Searching this document for a name listed here finds the canonical one-line purpose. Defining files are linked at the head of each cluster.

### Hooks

Defined in [`use-component-state-preservation.tsx`](../tugdeck/src/components/tugways/use-component-state-preservation.tsx) and [`use-card-state-preservation.tsx`](../tugdeck/src/components/tugways/use-card-state-preservation.tsx).

- **`useComponentStatePreservation`** — Component-level opt-in. Takes `{ componentStatePreservationKey, captureState, restoreState }`; registers the closures (held in refs synced every render) with the nearest `ComponentStatePreservationRegistry` inside `useLayoutEffect` ([L03]). No-op when `componentStatePreservationKey` is `undefined` or when rendered outside any card. ([D13], [A9])
- **`useCardStatePreservation`** — Card-level opt-in. Takes `{ onSave, onRestore, onCardActivated?, onCardWillDeactivate? }`; registers a `CardStatePreservationCallbacks` record with the enclosing `CardHost` via `CardStatePreservationContext`. Stable wrappers that read from refs at call time — option changes do not re-register ([D02]).

### Registry

Defined in [`component-state-preservation-registry.ts`](../tugdeck/src/components/tugways/component-state-preservation-registry.ts).

- **`ComponentStatePreservationRegistry`** — Per-card registry of opt-in component state preservation entries. One instance per card. Exposes parent-first iteration (lexicographic on `treePath`) so the framework can harvest the full component tree into `bag.components` in a single deterministic order. Owns only the data structure and iteration semantics; the framework orchestration (`captureCardState` / `restoreCardState`) lives elsewhere and consumes the registry.

### Card-level context and callback record

Defined in [`use-card-state-preservation.tsx`](../tugdeck/src/components/tugways/use-card-state-preservation.tsx).

- **`CardStatePreservationContext`** — React context provided by `CardHost` to its children. Carries `{ cardId, register }` so descendants can both register save/restore callbacks and learn the id of the card they render inside without prop-drilling. `null` when rendered outside `CardHost` (the hook then no-ops).
- **`CardStatePreservationContextValue`** — The shape of the context's value. Members: `cardId: string` (stable identity of the enclosing card — survives cross-pane moves), `register: (callbacks: CardStatePreservationCallbacks) => void` (the stable registration entry point; called once per mount).
- **`CardStatePreservationCallbacks`** — The save/restore record handed to `register`. Members: `onSave`, `onRestore`, optional `onContentReady`, optional `restorePendingRef`, optional `onCardActivated`, optional `onCardWillDeactivate`. `CardHost` writes `onContentReady` and sets `restorePendingRef` before calling `onRestore`; the hook's no-deps `useLayoutEffect` reads them after the child commits.
- **`onCardActivated`** — Optional callback on `CardStatePreservationCallbacks`. Fires when this card transitions to being the deck-level focus destination (`isFocusDestination` flips `false` → `true`). Production routing dispatches through the deck store's `invokeActivationCallback` channel; the record field is retained for tests and compatibility. Typical implementation in EM (engine-managed) cards: `engine.paintMirrorAsActive()`. FC (DOM-authority) cards leave it unset — `CardHost` re-applies `bag.focus` + `bag.domSelection` directly for them.
- **`onSave`** — Required callback on `CardStatePreservationCallbacks`. Returns the card's serialized `bag.content` payload. Called synchronously by `CardHost` on tab deactivation and on `saveState` RPC. Must not return a Promise.
- **`onRestore`** — Required callback on `CardStatePreservationCallbacks`. Receives `(state, { isActive })`. `state` is the previously-captured `bag.content`; `isActive` is `true` iff this card is the deck-level first responder at the moment of restore. The consumer routes selection paint through `paintMirrorAsActive` (active) or `paintMirrorAsInactive(publish)` (inactive) accordingly ([L23]).

### Type shapes

Defined in [`layout-tree.ts`](../tugdeck/src/layout-tree.ts).

- **`CardStateBag`** — The flat per-card preservation envelope. Optional members compose by axis: `scroll` (outer host-content scroll), `content` (the `useCardStatePreservation` payload), `formControls` (record of `FormControlSnapshot` keyed by `data-tug-state-key`), `regionScroll` (record keyed by `data-tug-scroll-key`), `domSelection` (the card-boundary selection range), `focus` (the `FocusSnapshot`), `components` (the `useComponentStatePreservation` axis, keyed by scoped `componentStatePreservationKey`). Stored in DeckManager's in-memory cache and durably under tugbank's `dev.tugtool.deck.cardstate/{cardId}`. ([D49], [D50])
- **`FocusSnapshot`** — Discriminated-union shape recording which descendant of the card root held focus at save time. Four kinds: `{ kind: "none" }` (nothing focused inside the card), `{ kind: "form-control", componentStatePreservationKey }` (a native `<input>`/`<textarea>` carrying `data-tug-state-key`), `{ kind: "dom", focusKey }` (a non-form-control focusable element carrying `data-tug-focus-key`), `{ kind: "component-owned" }` (a component that manages its own focus + selection together — e.g. `TugPromptInput`'s contentEditable; the owning component's `bag.content` carries the detail). Captured by `captureFocus` in [`card-host.tsx`](../tugdeck/src/components/chrome/card-host.tsx); applied by `applyFocusSnapshot` on cold-boot restore for the active card of the active pane only ([D10]).

### DOM attributes

The protocol's surface area in HTML. Authors add these attributes to opt their elements into the corresponding axis of the bag.

- **`data-tug-state-key`** — On a native `<input>` or `<textarea>` (or the `tug-input` / `tug-textarea` / `tug-value-input` widgets that wrap them). Captures `.value`, selection range, and scroll position into `bag.formControls[key]`. The same key doubles as the focus key — `FocusSnapshot` kind `form-control` reads it so authors do not add a second `data-tug-focus-key` attribute. Key must be unique within the card subtree. (See [card-state-model.md](card-state-model.md) → Form-control Value Preservation.)
- **`data-tug-focus-key`** — On any non-form-control focusable element (button, tab, custom focusable `tabindex=0` widget) that wants its focus restored. Captured into `FocusSnapshot` kind `dom`. Key must be unique within the card subtree.
- **`data-tug-scroll-key`** — On an inner scrollable region (most notably `tug-markdown-view`'s virtual-list container). Captures `{ x, y }` into `bag.regionScroll[key]`. Applied on mount and re-applied for late-mounting regions via the same `MutationObserver` that restores form controls.
- **`data-tug-prompt-input-root`** — Marker attribute on the outer container of a component that owns its own focus + selection state together (e.g. `TugPromptInput`). Causes `captureFocus` to serialize the focus as `FocusSnapshot` kind `component-owned`. The owning component's `bag.content` carries the actual detail.

---

## Save / restore lifecycle

The framework drives both layers from a small set of well-defined moments. Outside these moments, no capture or restore is happening — the protocol does nothing per-keystroke and reads no React state.

### Capture moments

`CardHost` calls registered `onSave` callbacks (and the framework iterates `ComponentStatePreservationRegistry` for `bag.components`) at exactly these moments:

1. **Tab deactivation.** The user switches away from this card to a sibling within the same pane. The card stays mounted; the captured bag is held in DeckManager's in-memory cache and debounced to tugbank.
2. **`saveState` RPC.** Triggered by Swift on app-level events (resign-active, hide). The framework captures every active card's bag in one pass. This is the "before backgrounding" capture.
3. **Close-before-destroy.** A flush path. Before a card is torn down (close or move to a different pane), the framework captures one last bag so reopen / drop can replay it.

The capture-phase invariant ([A9], gated by [`smoke-capture-phase-save.test.ts`](../tests/app-test/harness-smoke/smoke-capture-phase-save.test.ts)) is that capture runs **before any DOM mutation** in the same React commit. If a tab switch tears down the outgoing card's DOM and then runs capture, the captured value is empty. The protocol guarantees the inverse: capture runs in `useLayoutEffect` (Rule 3 / [L03]) before the commit phase that would unmount, so the live DOM is always observable when `captureState` / `onSave` fire. The smoke test asserts this at the architecture level so the invariant can never silently regress.

### Restore moments

`CardHost` calls `onRestore` (and the framework iterates the registry to push payloads into `restoreState`) at exactly these moments:

1. **Cold-boot mount.** First mount of `CardHost` after a process boot, when a previously-saved bag exists for this `cardId`.
2. **Cross-pane move replay.** A card moved between panes is unmounted at the source and re-mounted at the destination; the bag captured at close-before-destroy is replayed on the new `CardHost`.
3. **Tab-close-then-reopen.** Same shape as cross-pane move — a fresh `CardHost` mount with a previously-saved bag.

Restore does **not** fire on intra-pane tab switch. Tab switches are pure visibility transitions: the inactive card's DOM stays mounted, the user's state stays alive in the live tree, and there is nothing to restore because nothing was destroyed. This is L23 in its strongest form.

### What's in `bag` at save time vs. restore time

Both ends see the same shape: a `CardStateBag`. At save time, every axis is populated from the live DOM and the live React tree (`captureFocus(cardRoot)`, walking `data-tug-state-key` for `bag.formControls`, walking `data-tug-scroll-key` for `bag.regionScroll`, calling each registered `captureState()` for `bag.components`, calling the card's `onSave()` for `bag.content`). At restore time, the same bag is replayed onto a freshly-mounted DOM: form controls re-set their `.value` (with a `MutationObserver` re-applying for late mounts), regions re-scroll, the focus snapshot is dispatched through `applyFocusSnapshot` on the active card of the active pane, and the components-axis is replayed in parent-first order via the registry.

---

## Restore ordering and `onContentReady`

A subtle constraint: when a card's `onRestore(bag.content)` mutates React state, the resulting DOM does not exist yet at the moment `onRestore` returns. The hook bridges this with `onContentReady` and `restorePendingRef`:

1. `CardHost` sets `callbacks.restorePendingRef.current = true`.
2. `CardHost` calls `callbacks.onRestore(bag.content, { isActive })`.
3. The card's `onRestore` calls (e.g.) `engine.applySnapshot(state)` — a React state setter.
4. React commits; the child's DOM lands.
5. The hook's no-deps `useLayoutEffect` fires (it runs on every commit), reads `restorePendingRef`, fires `onContentReady` if set, resets the flag.
6. `CardHost`'s post-attach effect, gated on `onContentReady`, applies `bag.scroll`, `bag.formControls`, `bag.regionScroll`, `bag.domSelection`, `bag.focus` — the DOM-authority axes — only after the content has committed.

This is the deterministic alternative to `requestAnimationFrame` (Rule 12, [D78], [D79]). RAF timing relative to React's commit cycle is not a contract; a child-driven `useLayoutEffect` is.

---

## DOM attributes — quick table

For the per-axis contract these attributes participate in, see [card-state-model.md](card-state-model.md). For the protocol behind them — when capture runs, how late-mounting controls are restored, what `bag.formControls` looks like — this section is canonical.

| Attribute | Saved into | Saved fields | Notes |
|-----------|-----------|--------------|-------|
| `data-tug-state-key="<key>"` | `bag.formControls[key]` | `value`, `selectionStart`, `selectionEnd`, `selectionDirection`, `scrollTop`, `scrollLeft` | Native `<input>` / `<textarea>` value preservation. Doubles as the focus key — `FocusSnapshot` kind `form-control` references it. |
| `data-tug-focus-key="<key>"` | (not stored in bag axis) | — | Drives `FocusSnapshot` kind `dom`. Resolved on restore by keyed lookup inside the card root. |
| `data-tug-scroll-key="<key>"` | `bag.regionScroll[key]` | `x`, `y` | Inner scrollable region. Re-applied for late mounts via the same `MutationObserver` as form controls. |
| `data-tug-prompt-input-root` | (component-owned) | — | Marker attribute. `captureFocus` serializes focus on any descendant as `FocusSnapshot` kind `component-owned`; the owning component's `bag.content` carries the real detail. |

Authors add these attributes; the framework owns capture and replay. There is no second mechanism for any of these axes; if a control wants its state preserved across cold boot, it opts in via one of these attributes (or via `useComponentStatePreservation` for non-DOM-authority state).

---

## `FocusSnapshot` in depth

`FocusSnapshot` is the discriminated-union output of `captureFocus(cardRoot)`. The four kinds correspond to the four classes of focusable element the framework recognizes:

- **`{ kind: "none" }`** — `document.activeElement` is `null`, on `document.body`, on a descendant outside the card root, or on an element that matches none of the opt-in markers. The bag stores no focus (or stores `{ kind: "none" }` explicitly); restore is a no-op.
- **`{ kind: "form-control", componentStatePreservationKey }`** — Focus is on a native form control with `data-tug-state-key`. The same key is the focus key. Restore re-focuses after `bag.formControls[key].value` has been re-applied so the caret lands on the restored content.
- **`{ kind: "dom", focusKey }`** — Focus is on a non-form-control focusable element with `data-tug-focus-key`. Restore looks up the element by attribute value and calls `.focus()`.
- **`{ kind: "component-owned" }`** — Focus is on a descendant of an element marked with `data-tug-prompt-input-root` (or another component-owned marker). The owning component manages focus and selection together; the bag's `content` axis carries the real state, and the framework merely notes that focus belonged to this component on save.

Restore applies `bag.focus` only on cold-boot for the active card of the active pane. In-app transitions (tab switch, pane activation, app hide/unhide while the process stays alive) leave focus alone — the DOM never unmounts, so focus was never lost.

---

## `CardStateBag` in depth

`CardStateBag` is a flat object: every member is optional and every member is independent. Adding a new axis is additive — a new `bag.X` field, a new capture step, a new restore step — and never disturbs existing axes.

| Axis | Field | Source at capture |
|------|-------|-------------------|
| Outer scroll | `scroll` | `hostContentEl.scrollLeft` / `scrollTop` |
| Card content | `content` | `useCardStatePreservation` callbacks' `onSave()` |
| Form controls | `formControls` | Walk `data-tug-state-key` inside the card root |
| Region scroll | `regionScroll` | Walk `data-tug-scroll-key` inside the card root |
| DOM selection | `domSelection` | `selectionGuard.getCardRange(cardId)` |
| Focus | `focus` | `captureFocus(cardRoot)` |
| Components | `components` | Iterate `ComponentStatePreservationRegistry` parent-first |

Axes compose: a card with a `useCardStatePreservation` engine, three opt-in `useComponentStatePreservation` controls, two `data-tug-state-key` form controls, one `data-tug-scroll-key` region, and an active selection produces a bag with all seven axes populated. None of them know about the others; the framework writes each axis from a distinct source.

---

## Authoring rules

**Opt in for uncontrolled state.** Native form controls, `tug-markdown-view`'s scroll position, an accordion's open-section index — any state where the source of truth is the DOM or a `useState` inside the component itself. Use `data-tug-state-key` for the form-control case; use `useComponentStatePreservation` otherwise.

**Do not opt in for controlled state.** When a parent component re-renders on every keystroke and passes `value` down as a prop, the parent's state pipeline is already preserving the value — opting into the protocol would be a second source of truth and would race the prop. The same applies to any state that lives in tugbank-backed app-wide stores (theme, layout) — those are preserved by their own persistence path and have no place in the per-card bag.

**Pick keys for uniqueness within the card subtree.** `componentStatePreservationKey`, `data-tug-state-key`, `data-tug-focus-key`, `data-tug-scroll-key` all share the same uniqueness contract: unique within the card. The card is the natural scope because every preservation axis is per-card. Composite components that embed other opt-in components should wrap their subtree in `<ComponentStatePreservationScope prefix="...">`; the prefix is automatically prepended to nested keys, so a checkbox at `theme/dark-mode` inside a `theme`-prefixed scope inside a `settings`-prefixed scope ends up at `settings/theme/dark-mode` in `bag.components` and cannot collide with another card's `dark-mode` checkbox.

**Capture must be synchronous and serializable.** `captureState` and `onSave` are called inside `useLayoutEffect` cleanup or inside a synchronous teardown path; they must return a JSON-serializable value and must not return a Promise. The framework reads `captureRef.current()` at harvest time. If a component's true state is async (e.g. an in-flight network response), capture only what's already settled.

**Restore must tolerate unknown payload shapes.** Card-content code evolves; an old bag pulled out of tugbank may carry a payload shape the current code doesn't recognize. `restoreState` and `onRestore` should narrow defensively (`typeof saved === "boolean"`, `Array.isArray(saved)`) and quietly drop a payload they cannot interpret. Orphan keys in `bag.components` whose components no longer exist in the card are dropped by the framework ([D13] / Q5).

---

## Relationship to AT-tags

The [A9] protocol is gated end-to-end by AT-tags from [app-test-inventory.md](app-test-inventory.md). Each tag pins one transition or one component-roster axis of the protocol; the inventory is the regression catalog.

| AT-tag | Gate |
|--------|------|
| [AT0001](app-test-inventory.md#at0001-intra-pane-tab-switch--fc-focus-loss) | Intra-pane tab switch — FC focus loss |
| [AT0002](app-test-inventory.md#at0002-intra-pane-tab-switch--em-focus-loss) | Intra-pane tab switch — EM focus loss |
| [AT0004](app-test-inventory.md#at0004-app-resign--become-active-focus-restore) | App resign → become-active focus restore |
| [AT0006](app-test-inventory.md#at0006-cross-pane-move--focus-restore) | Cross-pane move — focus restore |
| [AT0008](app-test-inventory.md#at0008-oncardactivated-hook--infrastructure) | `onCardActivated` hook — infrastructure |
| [AT0009](app-test-inventory.md#at0009-inactive-mount-em-card) | Inactive-mount EM card |
| [AT0010](app-test-inventory.md#at0010-markdown-view-copy-selection-persistence) | Markdown-view copy-selection persistence |
| [AT0014](app-test-inventory.md#at0014-scroll-persistence) | Scroll persistence |
| [AT0017](app-test-inventory.md#at0017-savestate-rpc-parity) | `saveState` RPC parity |
| [AT0024](app-test-inventory.md#at0024-no-component-level-state-preservation-protocol) | Component State Preservation Protocol foundational gate |
| [AT0027](app-test-inventory.md#at0027-layout-state--split-pane-divider-accordion-expansion) | Layout state — split-pane divider, accordion expansion |
| [AT0029](app-test-inventory.md#at0029-scroll-key-audit-across-components) | Scroll-key audit across components |

The capture-phase invariant itself is gated by [`smoke-capture-phase-save.test.ts`](../tests/app-test/harness-smoke/smoke-capture-phase-save.test.ts) — the architecture-level smoke test that asserts capture runs before any DOM mutation in the same commit.

---

## Files

Primary sources — the files that define the protocol's exported identifiers. Look here when you need to see the actual implementation.

- [`tugdeck/src/components/tugways/use-card-state-preservation.tsx`](../tugdeck/src/components/tugways/use-card-state-preservation.tsx) — `useCardStatePreservation` hook; `CardStatePreservationContext`, `CardStatePreservationContextValue`, `CardStatePreservationCallbacks` types; the `onCardActivated` / `onSave` / `onRestore` callback shapes.
- [`tugdeck/src/components/tugways/use-component-state-preservation.tsx`](../tugdeck/src/components/tugways/use-component-state-preservation.tsx) — `useComponentStatePreservation` hook; `ComponentStatePreservationScope` provider; `useComponentStatePreservationScopePrefix` accessor.
- [`tugdeck/src/components/tugways/component-state-preservation-registry.ts`](../tugdeck/src/components/tugways/component-state-preservation-registry.ts) — `ComponentStatePreservationRegistry` class; parent-first iteration semantics; per-card lifecycle.
- [`tugdeck/src/layout-tree.ts`](../tugdeck/src/layout-tree.ts) — `CardStateBag`, `FocusSnapshot`, `FormControlSnapshot`, `RegionScrollSnapshot`, `DomSelectionSnapshot` type definitions.

Secondary sources — where the protocol is wired up in practice.

- [`tugdeck/src/components/chrome/card-host.tsx`](../tugdeck/src/components/chrome/card-host.tsx) — `captureFocus`, `applyFocusSnapshot`, the `registerStatePreservationCallbacks` plumbing, the post-attach effect that orders DOM-authority restore after `onContentReady`.
- [`tugdeck/src/deck-manager.ts`](../tugdeck/src/deck-manager.ts) — Per-card `CardStateBag` cache; activation and deactivation callback channels (`registerActivationCallback`, `invokeActivationCallback`, `registerDeactivationCallback`); `saveState` RPC entry point.
- [`tests/app-test/harness-smoke/smoke-capture-phase-save.test.ts`](../tests/app-test/harness-smoke/smoke-capture-phase-save.test.ts) — Architecture-level smoke test gating the capture-phase invariant.

---

## Cross-Links

- [card-state-model.md](card-state-model.md) — The per-axis contract (focus, scroll, form-control value, selection). This doc describes the mechanism; that doc describes what each axis means to authors.
- [lifecycle-delegates.md](lifecycle-delegates.md) — The deck-level `TugCardDelegate` event pipe (`cardWillActivate` / `cardDidActivate` / etc.). The preservation-layer callbacks (`onCardActivated`, `onSave`, `onRestore`) ride atop this pipe — when a `cardWillDeactivate` lifecycle moment fires for card A and `cardWillActivate` fires for card B, the framework dispatches `onCardWillDeactivate` on A's preservation record and (after restore) `onCardActivated` on B's.
- [pane-model.md](pane-model.md) — Deck → Pane → Card hierarchy; cards are the unit of preservation, panes own geometry, the deck owns the per-card bag cache.
- [responder-chain.md](responder-chain.md) — First-responder promotion drives the `isActive` flag in `onRestore`; `applyFocusSnapshot` interacts with the responder chain on cold-boot restore.
- [app-test-inventory.md](app-test-inventory.md) — Every AT-tag that gates this protocol. The regression catalog.
- [tuglaws.md](tuglaws.md) — [L23] (state preservation across bookkeeping operations); [L09] / [L10] (Pane vs. Card responsibilities); [L03] (`useLayoutEffect` for registrations).
- [design-decisions.md](design-decisions.md) — [D13] (Component State Preservation Protocol), [D49] (per-tab state bag), [D50] (`useCardStatePreservation` hook), [D78] (child-driven ready callback), [D79] (no `requestAnimationFrame` for state-commit-dependent ops).
