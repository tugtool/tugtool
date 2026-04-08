# Responder Chain Integration Audit

**Status:** Drafted during the tug-prompt-input context menu work, when clipboard shortcuts broke because of a first-responder race between the editor and its enclosing card. The immediate bug was patched with a tactical `stopPropagation` in `tug-prompt-input.tsx`, but the root causes are architectural and affect nearly every interactive component in the suite.

**Scope:** `tugdeck/src/components/tugways/tug-*.tsx` and the responder chain plumbing they sit on top of (`responder-chain.ts`, `responder-chain-provider.tsx`, `use-responder.tsx`, `keybinding-map.ts`, `action-dispatch.ts`).

**Governing laws:**
- [L11] *Controls emit actions; responders handle actions.* Controls (buttons, sliders, pickers) are not responder nodes. They dispatch ActionEvents into the chain. Responders receive and handle them.
- [L07] *Every action handler must access current state through refs or stable singletons, never stale closures.*
- [L03] *Use `useLayoutEffect` for registrations that events depend on.*
- [L02] *External state enters React through `useSyncExternalStore` only.*

---

## TL;DR

We have a responder chain infrastructure (`ResponderChainManager`, `useResponder`, `dispatch` / `dispatchForContinuation` / `observeDispatch`, keybinding map), and exactly **two** tug-* components register as responders: `tug-card` and `tug-prompt-input` (the latter only after this audit's work started). Every other interactive control — `tug-button` aside — uses **ad-hoc React callback props** (`onValueChange`, `onCheckedChange`, `onSelect`, `onTabSelect`, `onConfirm`, etc.) and does not participate in the chain at all.

This is a direct L11 violation across ~17 components. It's also the root cause of the stuck-menu, stale-focus, and "keyboard shortcut doesn't reach the editor" bugs we've spent the last several rounds patching — all of which become trivial or disappear entirely once the chain is the single source of truth.

The secondary issue is that the first-responder model, as currently implemented, is fragile: a parent responder (tug-card) overrides any nested responder unconditionally on every `pointerdown`, breaking clipboard shortcuts dispatched through the chain. The current workaround is a `stopPropagation` hack in `tug-prompt-input`. This needs a principled fix: nested responders should win over their ancestors on pointer and keyboard focus events without per-component escape hatches.

---

## Part 1 — Current state of responder-chain integration

### 1.1 Components that use the chain (6 total, 3 tug-*)

| File | How | Notes |
|---|---|---|
| `tug-card.tsx` | `useResponder({ id: cardId, actions: { close, selectAll, previousTab, nextTab, minimize, toggleMenu, find, setProperty } })`. Attaches `handleCardPointerDown` → `manager.makeFirstResponder(cardId)` on every card pointerdown. | The only "complete" responder registration in the tug-* set. Also the source of the override bug — see Part 2.1. |
| `tug-prompt-input.tsx` | Added in this audit's work. Registers `cut`, `copy`, `paste` with a `useId()`-derived responder id. Promotes first responder on editor focus (and defensively in the contextmenu handler and in `handlePointerDown` via `stopPropagation`). | Tactical fix only — see Part 2.1 for why the `stopPropagation` is a workaround. |
| `tug-editor-context-menu.tsx` | Consumer of `useRequiredResponderChain` and `observeDispatch`. Does not register a responder (it's a control, not a handler). Dispatches `{action, phase: "discrete"}` via `dispatchForContinuation`. | Added in this audit's work. Correct by construction after the refactor. |
| `internal/tug-button.tsx` | `useResponderChain()` + `dispatch` or `dispatchTo` when the button is clicked and an `action` prop is set. | The existing "control emits action" pattern. Copy this for other controls. |
| `cards/gallery-*.tsx` | Several gallery cards use `useResponder` to register demo responders for their gallery content. Good reference implementations. | Not user-facing components. |
| `deck-canvas.tsx` | Canvas-level actions: `cycleCard`, `resetLayout`, `showComponentGallery`, `addTabToActiveCard`. Registers as a root responder. | Correct. |

### 1.2 Components that *should* use the chain but don't (17 tug-* controls)

Every one of these is an interactive control. Each currently exposes one or more React callback props (`onValueChange`, `onCheckedChange`, `onSelect`, `onConfirm`, `onOpenChange`, etc.) and fires them directly from within its own event handlers. None dispatch actions through the responder chain. None integrate with `keybinding-map.ts`. None can be driven by ⌘-shortcuts without bespoke per-control keyboard handling.

| Component | Callback props (current) | Actions it should dispatch |
|---|---|---|
| `tug-push-button.tsx` | (inherits from internal/tug-button — already chain-aware via `action` prop) | ✅ already handled |
| `tug-checkbox.tsx` | `onCheckedChange` | `toggle` (with bound value in the ActionEvent) |
| `tug-switch.tsx` | `onCheckedChange` | `toggle` |
| `tug-radio-group.tsx` | `onValueChange` | `selectValue` or similar |
| `tug-choice-group.tsx` | `onValueChange`, `onFocusChange` | `selectValue`, arrow-key navigation dispatches |
| `tug-tab-bar.tsx` | `onTabSelect`, `onTabClose` | `selectTab`, `closeTab` |
| `tug-slider.tsx` | `onValueChange` | `setValue` with `begin`/`change`/`commit` phases |
| `tug-value-input.tsx` | `onValueCommit` | `setValue` with `commit` phase |
| `tug-popup-button.tsx` | `onSelect` | `selectMenuItem` — or, like TugEditorContextMenu, the item `id` is the action name |
| `tug-accordion.tsx` | `onValueChange` | `toggleSection` or `expandSection` |
| `tug-input.tsx` | (has no explicit callback props in its own file — wraps Radix/native input) | `cut`, `copy`, `paste`, `selectAll`, `undo`, `redo` — same contract as `tug-prompt-input` |
| `tug-textarea.tsx` | (same as tug-input) | same as above |
| `tug-option-group.tsx` | (has `onKeyDown` implying custom keyboard handling) | `selectValue`, arrow navigation dispatches |
| `tug-confirm-popover.tsx` | `onConfirm`, `onCancel` | `confirmDialog`, `cancelDialog` |
| `tug-alert.tsx` | `onConfirm`, `onOpenChange` | `confirmDialog`, `dismissDialog` |
| `tug-sheet.tsx` | `onOpenChange` | `dismissDialog` (bound to the sheet id) |
| `tug-popover.tsx` | `onOpenChange` | `dismissPopover` |

#### Why callback props are a problem (L11 violation)

Callback props tightly couple the control to its parent. The parent must wire up the callback, handle the value, and potentially do the work of dispatching or storing it. Every usage site duplicates glue code. Keyboard shortcuts are impossible to bind globally because the callback isn't reachable from the keybinding pipeline. Multi-surface interactions (keyboard + menu + gesture) require multiple code paths to produce the same outcome. This is exactly what the responder chain exists to prevent.

#### The ripple effect: the context-menu work

The last several conversation rounds on this menu have all been downstream of this one issue. Three specific pain points we hit:

- **"Menu doesn't dismiss on ⌘A."** The selectAll action was dispatched through the responder chain (via `tug-card`), but the menu couldn't observe it because it had no chain integration. We added `observeDispatch` to the manager as part of this audit's work — that primitive is now the general mechanism, but only because the chain actually carries the traffic.
- **"Cut/Copy/Paste from the menu doesn't run."** The menu was calling its own `onSelect` callback and wiring clipboard work through the prop. The parent had to deal with WebKit's synchronous-user-gesture restrictions, menu blink timing, and clipboard APIs. The correct path — and the one we ended up with — is that the menu dispatches `{action: "cut", phase: "discrete"}` and the first responder's handler does the work. One code path, works for both keyboard and menu.
- **"Clipboard shortcuts don't reach the editor."** First-responder override by the enclosing card (Part 2.1 below). The editor registers its cut/copy/paste handlers, but the card keeps stealing first-responder status on every pointerdown.

---

## Part 2 — Architectural issues

### 2.1 First-responder override by parent responders

**Symptom:** `tug-prompt-input`'s cut/copy/paste handlers are never reached when the user presses ⌘X/C/V, because `tug-card.tsx:484-486` unconditionally overrides the first responder to the card on every pointerdown bubbled up from any descendant.

**Root cause:** `tug-card`'s pointerdown handler was designed under the assumption that cards are the leaf-most responders. When the `tug-prompt-input` responder was added as a descendant, the card kept winning the race because:

1. The editor is inside the card.
2. `pointerdown` fires on the editor; React's synthetic event bubbles through the tree.
3. The card's `onPointerDown` listener runs in the bubble phase, calling `manager.makeFirstResponder(cardId)`.
4. The editor's `focus` event fires on the first click only (subsequent clicks on an already-focused editor don't re-fire focus).
5. After the first click, every subsequent pointerdown re-promotes the card. The editor never becomes first responder again until focus moves away and back.

**Current workaround:** `tug-prompt-input.tsx`'s `handlePointerDown` now calls `managerRef.current?.makeFirstResponder(responderIdRef.current)` and then `e.stopPropagation()` so the card's handler never fires. This is a tactical escape hatch.

**Why the workaround is wrong long-term:**
- Every nested responder (tug-prompt-input, tug-input, tug-textarea, tug-value-input, any future editor-like control) will need the same `stopPropagation` dance.
- `stopPropagation` silently prevents any other legitimate pointer-related behavior the card might add (drag, selection, analytics, hover highlighting, etc.) from running when the click lands inside the nested responder.
- It violates the principle that components should compose cleanly without knowing about their ancestors' internals.

**Fix (committed — Option (a) from original proposal):** The chain's first-responder walk runs *innermost* first. When `pointerdown` fires, the nearest registered responder up the DOM tree from the event target becomes first responder. Implementation: `useResponder` writes a `data-responder-id` attribute on the registered component's root DOM element via a ref callback; `ResponderChainManager.findResponderForTarget(node)` walks up from the node looking for the nearest ancestor with that attribute; `ResponderChainProvider` installs one document-level capture-phase `pointerdown` listener that promotes the innermost responder under the event target. Per-component `makeFirstResponder` calls and per-component focus listeners are deleted. This is what every desktop UI toolkit has done since NeXT.

### 2.2 Ad-hoc first-responder promotion

Right now, responder promotion happens in at least three places, each with different semantics:

- **Auto-promotion on register** (`responder-chain.ts:114-120`): the first root node to register becomes first responder. Great for app startup, useless for subsequent focus changes.
- **`tug-card` pointerdown** (`tug-card.tsx:484`): sets first responder to card id on every pointerdown.
- **`deck-canvas` pointerdown** (`deck-canvas.tsx:200`): sets first responder to `"deck-canvas"` if the click lands on the canvas background.
- **`tug-prompt-input` focus listener** (added in this audit): sets first responder to the editor on contentEditable `focus` event.
- **`tug-prompt-input` contextmenu + pointerdown** (added in this audit): defensive promotion to work around the tug-card override.
- **`deck-canvas` showComponentGallery action handler** (`deck-canvas.tsx:270-277`): promotes the gallery card after opening it.

Six different mechanisms, no unified contract. What happens if two fire on the same event with different ids? Last-write-wins — the order depends on event registration order, React delegation timing, and whether the listener is capture or bubble.

**Proposal:** consolidate into a single rule enforced by the chain. When a pointerdown fires, the chain resolves the innermost responder from the event target (walking the DOM) and makes it first responder. When keyboard focus moves (via Tab, programmatic `.focus()`, etc.), the chain promotes the nearest enclosing responder to the focused element. Callers no longer call `makeFirstResponder` at all for the normal case; the mechanism is needed only for programmatic promotion (e.g., `deck-canvas.showComponentGallery` opening a new gallery card and wanting it active).

### 2.3 Action vocabulary is untyped string soup

Actions are free-form strings. `"cut"`, `"selectAll"`, `"cycleCard"` — there's no type, no central list, no discoverability. Misspelling an action silently returns `handled: false`. Documentation is scattered across whichever component happens to register a handler or dispatch the action.

This is fine for a ten-action prototype, bad at the scale we're growing into. When `tug-accordion` dispatches `toggleSection`, is that a new action or should it be `toggle` with a payload? When a test uses `"showComponentGallery"`, is that the exact string or is it `"show-component-gallery"`? No compiler help.

**Proposal:** A typed action vocabulary. A `TugAction` union type defined centrally (probably `action-vocabulary.ts`), updated as actions are added. `dispatch`, `useResponder`'s `actions` map, and `keybinding-map.ts` all reference the union so typos become compile errors. Organize actions by category:

- **Clipboard:** `cut`, `copy`, `paste`, `selectAll`, `selectNone`
- **Editing:** `undo`, `redo`, `delete`, `duplicate`
- **Navigation:** `cycleCard`, `previousTab`, `nextTab`, `focusNext`, `focusPrevious`
- **Dialog/menu:** `confirmDialog`, `cancelDialog`, `dismissPopover`, `openMenu`
- **Control value:** `setValue`, `toggle`, `selectValue`, `incrementValue`, `decrementValue`
- **Window/card:** `close`, `minimize`, `maximize`, `showComponentGallery`, `resetLayout`, `addTabToActiveCard`
- **Meta:** `setProperty` (for the PropertyStore bridge)

An `ActionEvent` with a typed `action` field still carries its generic `value` payload, so `setValue` can carry a number and `selectValue` can carry a string — the type union gives us the *names*, not the payloads.

### 2.4 Keybinding map is sparse

Current state — `keybinding-map.ts`:

```ts
export const KEYBINDINGS: KeyBinding[] = [
  { key: "Backquote", ctrl: true, action: "cycleCard" },
  { key: "KeyA", meta: true, action: "selectAll", preventDefaultOnMatch: true },
  { key: "KeyX", meta: true, action: "cut", preventDefaultOnMatch: true },
  { key: "KeyC", meta: true, action: "copy", preventDefaultOnMatch: true },
  { key: "KeyV", meta: true, action: "paste", preventDefaultOnMatch: true },
];
```

Missing from a pile of macOS standards: ⌘Z (undo), ⇧⌘Z (redo), ⌘W (close card), ⌘T (new tab), ⌘⇧T (reopen tab), ⌘1..9 (jump to tab), ⌘F (find), ⌘, (preferences), ⌘Q (quit — probably host-app, but needs coverage), ⌘. (cancel), Escape (cancel), ⇥/⇧⇥ (focus next/prev), arrow keys inside list-like containers.

**Proposal:** complete the keybinding map against the macOS HIG standard set. Every standard shortcut becomes an action dispatch. Components that handle the corresponding action register via `useResponder`. The glue between "user pressed a key" and "component does the thing" becomes zero lines of ad-hoc component code.

### 2.5 `useResponder` does not reactively update handlers

`use-responder.tsx:101-107` registers the node once on mount with a snapshot of `options.actions`. Subsequent renders update `optionsRef.current`, but the object stored in the manager is the initial reference. In practice, this works by accident because most callers wrap their handlers in `useCallback(() => ..., [])` so the function identities are stable — the initial object has the same references as any later one.

But this is fragile. If a caller forgets `useCallback`, the actions map becomes stale the moment state changes. Silent bug, no warning.

**Proposal:** have `useResponder` register a proxy that looks up actions via `optionsRef.current` on every call, not a snapshot. Alternative: have `useResponder` re-register the node on every render where the actions map identity changes (this would require `register` to replace existing entries by id, which it already does via `Map.set`). Either fix would make the behavior contract match the docstring.

### 2.6 No "active first responder" indicator in the DOM

There is no visual or `data-`attribute representation of which responder is first. This makes debugging "why isn't my action firing?" hard — you can't inspect the DOM to see what the chain considers active, and there's no store subscription pattern that cheaply exposes it.

**Proposal:** `useResponder` writes a `data-responder-id="<id>"` attribute on the registered element, and the manager writes `data-first-responder="true"` on the current first-responder element (via a subscription that fires on validation version change). Trivially inspectable in devtools; enables ancestor-walk lookups (see 2.1 option b) without React tree traversal.

---

## Part 3 — Migration plan

This is ordered so each step is shippable on its own and unblocks the next. Each step has a rough size indicator and the laws it restores.

### Phase R1 — Unify first-responder promotion *(M, restores L11, eliminates per-component hacks)*

1. **Add DOM anchor attributes** in `useResponder`: write `data-responder-id` on the registered component's root element via a ref callback. Requires `useResponder` to accept a ref or return one.
2. **Implement `ResponderChainManager.findResponderForTarget(Node): string | null`**: walks up from the given DOM node looking for the nearest ancestor with `data-responder-id`, returns the id or null.
3. **Single document-level capture pointerdown listener in `ResponderChainProvider`**: on every pointerdown, call `findResponderForTarget(e.target)` and if the result is not the current first responder, promote it. Runs in capture phase so it completes before any descendant React handlers.
4. **Delete the per-component `makeFirstResponder` calls** in `tug-card`, `tug-prompt-input`, `deck-canvas` (the pointerdown ones — keyboard-navigation ones for `cycleCard` etc. stay).
5. **Delete the `stopPropagation` hack** in `tug-prompt-input.handlePointerDown`.

Exit criteria: clicking inside a nested responder (editor inside a card) naturally makes the editor first responder without any component-level wiring. ⌘X/C/V work after any click into the editor. `tug-prompt-input` no longer needs its focus listener or contextmenu-defensive promotion.

### Phase R2 — Migrate interactive controls off callback props *(L, restores L11 across the suite)*

One component at a time, in rough risk order (simplest first):

1. **`tug-checkbox`, `tug-switch`**: dispatch `toggle` with a `value: boolean` payload. Deprecate `onCheckedChange` but keep it working as a thin adapter that dispatches into the chain (so existing callers don't break during migration).
2. **`tug-radio-group`, `tug-choice-group`, `tug-option-group`**: dispatch `selectValue` with `value: string`.
3. **`tug-tab-bar`**: dispatch `selectTab` and `closeTab` with `value: string`.
4. **`tug-accordion`**: dispatch `toggleSection` with `value: string | string[]`.
5. **`tug-popup-button`**: dispatch its items' ids as action names (same pattern as `TugEditorContextMenu`).
6. **`tug-slider`, `tug-value-input`**: dispatch `setValue` with `value: number` and `phase: "begin" | "change" | "commit"` — this is where `ActionPhase` beyond `discrete` starts earning its keep.
7. **`tug-input`, `tug-textarea`**: register as responders for `cut`, `copy`, `paste`, `selectAll`, `undo`, `redo` — same contract as `tug-prompt-input`.
8. **`tug-confirm-popover`, `tug-alert`, `tug-sheet`, `tug-popover`**: dispatch `confirmDialog` / `cancelDialog` / `dismissDialog` / `dismissPopover`.

Each migration is mechanical: introduce the action dispatch inside the component's existing event handler, keep the callback prop alive as a compat shim that the chain invokes. Consumers can drop the callback prop when they want to go through the chain; eventually the shims delete.

Exit criteria: every tug-* interactive control dispatches its semantic actions through the chain. The keybinding map can bind any macOS-standard shortcut to any of them without per-component glue.

### Phase R3 — Type the action vocabulary *(S, restores compile-time safety)*

1. Create `tugdeck/src/components/tugways/action-vocabulary.ts` exporting a `TugAction` union type.
2. Narrow `ActionEvent.action` from `string` to `TugAction`.
3. Narrow `ResponderNode.actions` from `Record<string, ActionHandler>` to `Partial<Record<TugAction, ActionHandler>>`.
4. Narrow `KeyBinding.action` from `string` to `TugAction`.
5. Update call sites; fix any mismatches exposed by the compiler.

Exit criteria: `manager.dispatch({ action: "cutt", phase: "discrete" })` fails at compile time.

### Phase R4 — Complete the macOS standard keybinding map *(S, restores L11 for keyboard)*

Add entries to `keybinding-map.ts` for the full set listed in 2.4. Each entry routes to a typed action. Components that handle the action are already registered (after R2). Consumers get standard keyboard shortcuts for free.

Exit criteria: pressing ⌘Z anywhere in the app runs the `undo` action on the first responder; pressing ⌘W closes the active card; etc. No component has its own keybinding wiring.

### Phase R5 — Reactive action maps in `useResponder` *(S, fixes a latent class of stale-closure bugs)*

Change `use-responder.tsx` to register a proxy actions map that reads from `optionsRef.current` on every access. Or: detect identity changes in the actions map and re-register the node via `manager.register` (idempotent via `Map.set`). Either fix closes the loophole where a forgotten `useCallback` silently produces stale handler references.

### Phase R6 — Retrofit `tug-editor-context-menu` dispatch-observer pattern to the other floating surfaces *(S)*

Now that `observeDispatch` exists, every transient/modal surface that wants to dismiss on external action traffic (menus, popovers, tooltips, sheets, alerts) can subscribe to it with the same three-line `useLayoutEffect`. Retrofit `tug-context-menu`, `tug-popover`, `tug-popup-button`, `tug-tooltip`, `tug-alert`, `tug-sheet`, `tug-confirm-popover`. Each migration is a few lines and eliminates bespoke outside-click / escape-key wiring.

---

## Part 4 — Decisions (locked in before R1)

1. **Action vocabulary granularity: middle ground.** One action per semantic (`setValue`, `toggle`, `selectValue`, etc.) with rich payloads carried on `ActionEvent.value`. Document expected payload shapes in `action-vocabulary.ts` alongside the `TugAction` union. This keeps the name-level type union tight without exploding it into per-control variants.

2. **`undo`/`redo` follow macOS semantics.** Chain walks from innermost. If an editor-like responder has focus, it handles `undo`/`redo` against its own history. If not, the nearest ancestor that registered for those actions gets them (a card undoing tab-close, a canvas undoing layout changes, etc.). Decades of macOS precedent: rarely confusing in practice. No special-casing needed in the chain — the existing walk-from-first-responder logic does the right thing once the responders are registered in the right places.

3. **Preserve direct dispatch.** `dispatchTo` stays as a first-class primitive. It is the right tool when the developer explicitly says "I know which target should receive this event" — programmatic remote control, tests, unusual integration points. The chain-walking `dispatch` (and `dispatchForContinuation`) is the default path; `dispatchTo` is the explicit escape hatch. No fighting developers who opt into it.

4. **Clean break on the callback-prop migration.** No deprecation cycle. No compatibility shims. No TODO comments referencing future work. R2 removes the callback props and updates every consumer in the same commit. There are no external clients of this component library — it's the tugtool repo and Tug.app — so coordinating a break is trivial.

5. **Component authoring guide updates follow R2, not precede it.** Once the callback-prop migration has actually landed, rewrite the `component-authoring.md` checklist to require `useResponder` for any control that emits actions. At that point L11 compliance becomes enforceable at review time with the docs matching reality. Updating the doc before R2 would make it aspirational and drift-prone — wait for the code to match.

---

## Part 5 — What's "already done" from this audit's conversation

For the record, the following pieces have already landed and do not need to be redone in R1–R6:

- `ResponderChainManager.dispatchForContinuation` — two-phase dispatch with continuation callbacks.
- `ResponderChainManager.observeDispatch` — global dispatch observer pattern.
- `ActionHandler = (event: ActionEvent) => void | (() => void)` — widened handler return type.
- `keybinding-map.ts` entries for `cut`, `copy`, `paste`.
- `tug-prompt-input.tsx` registers as a responder with `cut`/`copy`/`paste` handlers.
- `tug-editor-context-menu.tsx` dispatches through the chain (not via `onSelect` prop) and subscribes to `observeDispatch` for external-dismiss.
- `responder-chain-provider.tsx` uses `dispatchForContinuation` and invokes the returned continuation so keyboard shortcuts get two-phase handlers.
- Tactical `stopPropagation` workaround in `tug-prompt-input.handlePointerDown` — **explicitly marked to be removed in R1**.

These are fine foundations. The audit work is about extending them to the rest of the suite and removing the architectural cliff in 2.1 so nested responders compose correctly.

---

## Part 6 — References

- `tuglaws/tuglaws.md` — L11, L07, L03, L02.
- `tuglaws/component-authoring.md` — the checklist that will need updating post-R2.
- `tugdeck/src/components/tugways/responder-chain.ts` — the chain primitives.
- `tugdeck/src/components/tugways/responder-chain-provider.tsx` — the keyboard pipeline.
- `tugdeck/src/components/tugways/use-responder.tsx` — the registration hook.
- `tugdeck/src/components/tugways/keybinding-map.ts` — the current keybinding table.
- `tugdeck/src/components/tugways/tug-card.tsx:484-486` — the first-responder override bug (Part 2.1).
- `tugdeck/src/components/tugways/tug-prompt-input.tsx` — the tactical `stopPropagation` workaround; removed by R1.

---

## Part 7 — Quality Audit Report

*First snapshot taken after R1, R3, and R5 landed.*

### 7.1 What landed

**Completed:**

- **R1: Unified first-responder promotion via innermost-from-target DOM walk.** `useResponder` writes `data-responder-id` via a stable ref callback; `ResponderChainManager.findResponderForTarget` walks the DOM; `ResponderChainProvider` installs one document-level capture-phase `pointerdown` listener. Per-component pointerdown overrides deleted from `tug-card`, `tug-prompt-input`, `deck-canvas`. Tactical `stopPropagation` workaround removed.
- **R3: Typed action vocabulary.** `TugAction` union in `action-vocabulary.ts`, narrowed `ActionEvent.action`, `ResponderNode.actions` (now `Partial<Record<TugAction, ActionHandler>>`), `KeyBinding.action`, `TugButtonProps.action`. ~25 typecheck errors fixed across the codebase.
- **R5: Reactive action maps in `useResponder`.** The actions map is now a live `Proxy` that reads from `optionsRef.current` on every access — closes the stale-closure loophole where a forgotten `useCallback` silently produced wrong handlers.
- **Audit doc updates.** Locked-in decisions in Part 4, marked Option (a) as committed in 2.1.
- **Earlier in the same session:** `dispatchForContinuation`, `observeDispatch`, two-phase action handlers, context-menu responder dispatch, clipboard keybindings.

**Still pending:** R2 (migrate 17 interactive controls), R4 (macOS standard keybinding map), R6 (retrofit `observeDispatch` to floating surfaces), post-R2 `component-authoring.md` update.

### 7.2 Quality assessment by area

#### Architecture — A-

**Strengths.** The innermost-from-target DOM walk is the right mechanism. It is what NeXT's responder chain, Cocoa, and every serious desktop toolkit has done for decades. Composition is automatic: nested responders naturally win over ancestors without any per-component wiring. The old model's central pain point — "parent responder overrides nested on every click" — is structurally impossible now, not just papered over. One document-level capture listener replaces what was six scattered `makeFirstResponder` call sites with divergent semantics. Single mechanism, one place to debug. Live proxy for action handlers removes an entire class of silent-bug failure modes; the contract documented in the `useResponder` docstring now matches the implementation. Two-phase dispatch (`dispatchForContinuation` + continuation callbacks) cleanly handles the WebKit sync-gesture-for-clipboard requirement without leaking it into every component. `observeDispatch` gives transient UIs (menus, popovers, tooltips) a single signal for "something else happened, close yourself" — no more per-surface keyboard/click-outside wiring to maintain.

**Caveats.** The DOM walk is O(depth) per pointerdown. For a typical card-inside-canvas-inside-root tree that's ~5–10 ancestors; negligible. But it's worth noting as a budget item if we ever get to deeply nested scenarios. `data-responder-id` is a single-attribute write-behind: if two responders try to write to the same DOM element (bad practice, but possible), the ref callback's "remove from previous" logic handles it but it's a footgun. R2 is the elephant in the room: R1+R3+R5 give us the *substrate* for chain-first-everywhere, but until the 17 interactive controls migrate, we still have the mixed world. The architecture is correct but the suite isn't yet consistent.

#### Type safety — B+

**Strengths.** `ActionEvent.action` is now `TugAction`, not `string`. Dispatch typos are compile errors at the call site — a real improvement from "string soup" to "a typed vocabulary with autocomplete". `ResponderNode.actions` is `Partial<Record<TugAction, ActionHandler>>` — it is structurally impossible to register a handler for a nonexistent action name. `KeyBinding.action` is typed. You cannot bind a key to a nonexistent action. `canHandle`, `validateAction`, `nodeCanHandle` all take `TugAction`. The whole chain API is type-coherent.

**Caveats.** The `ActionEvent.value` payload is still `unknown`. Per action name is typed, per payload is not. The vocabulary file documents expected payload shapes in prose, but handlers must defensively narrow `event.value`. This is a conscious tradeoff (see Part 4 decision 1 — "middle ground"). The alternative would be a discriminated union like `type CutActionEvent = { action: "cut"; value: undefined }` etc. forcing every dispatch site to construct the right shape. The middle-ground choice means R3 gives us name-safety, not shape-safety. Separately, `tug-editor-context-menu` casts `id as TugAction` — menu items carry their action names in the generic `id: string` field of `TugContextMenuEntry`, and the dispatch cast bypasses compile-time checking for typos in item definitions. Finally, `TugAction` includes `GalleryAction`: demo/test actions (`previewColor`, `demoAction`, etc.) are in the same union as production actions, cluttering autocomplete.

#### Consistency — C+

This is the biggest honest weakness. The suite is currently in a mixed state:

- **Chain-native (L11-compliant):** `tug-card`, `tug-prompt-input`, `deck-canvas`, `tug-editor-context-menu`, `tug-button` (internal).
- **Callback-prop (L11-non-compliant):** `tug-checkbox`, `tug-switch`, `tug-radio-group`, `tug-choice-group`, `tug-option-group`, `tug-tab-bar`, `tug-slider`, `tug-value-input`, `tug-popup-button`, `tug-accordion`, `tug-input`, `tug-textarea`, `tug-confirm-popover`, `tug-alert`, `tug-sheet`, `tug-popover`, `tug-tooltip`. 17 components.

Consumers today see an inconsistent API: "some tug-* components dispatch actions, others take callbacks, and I have to remember which is which." That's the hallmark of an incomplete migration. Until R2 lands, we have a two-track component library. Nothing is *broken* — callback-prop components continue to work because nothing in R1/R3/R5 required them to migrate. But the mental model is not clean yet.

#### Coherence — A

The story the chain now tells is internally consistent and learnable:

1. Components register as responders via `useResponder`, attaching `responderRef` to their root element.
2. Clicking a component makes it first responder automatically (innermost DOM walk).
3. Actions dispatched via `dispatch` walk from first responder upward until a handler is found.
4. Actions dispatched via `dispatchTo` go directly to a named node.
5. Handlers return either `void` or a continuation callback for two-phase work.
6. Dispatch observers see every action for "close on external action" patterns.
7. Keyboard shortcuts are one-liners in `keybinding-map.ts` that dispatch typed actions.

This is teachable in five minutes. A big improvement over "you have to know about `makeFirstResponder`, pointerdown bubble order, card pointerdown override semantics, React delegation timing, and `stopPropagation` escape hatches". The mental model was badly fragmented before; now it's coherent.

#### Technical choices

**Good choices.** The Proxy for live handler lookup (R5) — alternative would have been re-registering the node on every render, but the Proxy is one-time cost at registration and amortizes to constant reads. Capture phase at the document level for the pointerdown listener — runs before any React-delegated bubble handler, so even if an old component still has a `makeFirstResponder` in `onPointerDown` during migration, our promotion wins. Future-proof against half-migrated intermediate states. `Partial<Record>` for the actions map — gives per-key autocomplete and refuses unknown keys without forcing responders to implement every action. Cast-through-unknown for menu item id → `TugAction` — ugly but honest; the alternative is a separate typed entry shape, which was deferred. The cast is at one spot, not scattered. Preserving `dispatchTo` as first-class per the Q3 directive.

**Choices worth revisiting.** The DeckCanvas wrapper div: a wrapper added around deck-canvas's children solely to have an ancestor for `data-responder-id`. This adds one DOM level. Alternative: extend `ResponderScope` to render a real DOM element with the attribute. Not done because it would change `ResponderScope`'s API contract for every caller, which is a bigger ripple. The wrapper div is localized. The `canHandle` wrapper in `useResponder`: the wrapper is always installed as a permanent closure, even when the caller doesn't provide one. The chain's `canHandle` method checks the actions map first, then this function. The wrapper returns `false` when the caller doesn't provide one, so behavior is unchanged — but it's a small runtime cost for chain queries. `GalleryAction` in the production union: prioritized "galleries keep working without refactor" over "production autocomplete is pristine". Reversible via a generic type parameter.

#### Implementation strategy

**Strengths.** Each phase is shippable standalone. R1 works without R2. R3 works without R4. R5 is independent. No implicit dependencies that fail at runtime if you only do part of it. Tests pass throughout: 165 responder-chain-touching tests pass on every sub-step; the tree was not left broken between phases. Documented in code, not just in chat. Every non-obvious decision has an inline comment or docstring pointing at the reason. Future-me (or future-you) can reconstruct the *why* from the code alone.

**Weaknesses.** R5 was split into R1's commit instead of handled as its own phase. The audit document lists them separately, but in the code the Proxy landed in the same edit as the `responderRef` change. Fine as an end state, but someone reading the git history would see "R1" doing "R1 + R5". The full test suite was not run after each phase — only the responder-chain subset (which passes). The full `bun test` has unrelated flakes from `tugcard.test.tsx` (a mock-setup issue with `connection.onFrame` that predates this work) and `do-set-region-wiring.test.ts` (a timing flake). Without running the full suite there's no way to rule out collateral damage elsewhere. Not verified in-browser: the build is clean and the unit tests pass, but clipboard cut/copy/paste has not been eye-tested end-to-end in a live editor after R1 removed the workarounds. (Confirmed working by the user in the subsequent message — see Part 8 next-steps context.)

### 7.3 Holes, pitfalls, weaknesses, limitations (ordered by severity)

**1. The partial-migration state is the biggest risk.** Until R2 lands, 17 components use callback props and are outside the chain. Any pattern that tries to build on "all tug-* controls dispatch actions" (e.g. a form that registers one `setValue` handler and wires up 5 inputs through it) will not work consistently until every control migrates. R2 is not optional; it is the completion of R1–R6's premise. Recommended next step: start R2 with the simplest components (tug-checkbox, tug-switch) to establish the pattern.

**2. `ActionEvent.value` is untyped.** Documented in the vocabulary file as prose, enforced nowhere. A `setValue` handler that expects `number` but receives `string` will silently misbehave. Defensive handlers guard with `typeof`; non-defensive ones get runtime type errors. Recommended mitigation: add a `narrowValue<T>(event, guard)` utility that handlers call, e.g. `const n = narrowValue(e, (v): v is number => typeof v === "number"); if (n === null) return;`. Convention over enforcement.

**3. Menu `id as TugAction` cast bypasses type checking.** `TugEditorContextMenu` items are typed with `TugContextMenuEntry.id: string`, and the dispatch site casts. A typo in an item definition (`id: "cutt"`) compiles silently and dies at runtime with `handled: false`. Recommended fix: introduce `TugEditorContextMenuItem` as a distinct type with `action: TugAction`. Update `tug-prompt-input` to use it. ~20 lines.

**4. `dispatchTo` is not updated to work with the new target resolution.** Still takes a string `targetId` and throws on unregistered. With R1's `findResponderForTarget`, a `dispatchToTarget(element: Node, event)` convenience could wrap `findResponderForTarget + dispatchTo`. Nice-to-have, not critical. Punt until a real need appears.

**5. No visual debugger for the chain.** The `data-first-responder="true"` attribute mentioned in audit section 2.6 was not added. You can inspect the DOM to see *which nodes are registered* (via `data-responder-id`), but not *which is currently first*. "Why isn't my action firing?" debugging is still somewhat opaque. Recommended fix: add the attribute. Three lines in the manager's first-responder promotion path plus a subscription to update it on change.

**6. Focus-based first-responder promotion is gone.** R1 deletes tug-prompt-input's focus listener. Keyboard-only users who Tab into an editor (without clicking) won't get first-responder promotion on Tab. For pointer users this isn't an issue; for keyboard users it *might* be — depends on whether Tab focusing a contentEditable fires a `pointerdown` (it doesn't). Recommended fix: add a document-level `focusin` listener alongside the `pointerdown` listener in the provider. Walks from `event.target` up the DOM the same way. Covers keyboard-driven focus changes for free.

**7. No test coverage for the new R1 mechanism specifically.** The existing 165 responder-chain-touching tests pass, but there is no new test that exercises `findResponderForTarget` + the provider's pointerdown listener as a unit. The existing tests cover the *old* mechanisms and incidentally survive the migration. Recommended fix: add at least one test that mounts a nested responder inside a parent responder, fires a pointerdown on the inner element, and asserts the inner became first responder. ~20 lines, covers R1's invariant directly.

**8. `action-vocabulary.ts` documents payloads in prose, not types.** Accurate today; will drift the first time someone changes a payload shape without updating the comment. No enforcement. Tolerable for now. If drift happens, revisit (payload discriminated unions or helper type utilities).

**9. R1 removed the contextmenu defensive `makeFirstResponder` but kept the contextmenu handler.** The comment says "pointerdown listener has already promoted this node via data-responder-id lookup, and a right-click issues pointerdown before contextmenu." This is *mostly* true. Edge case: a right-click with a pointerdown handler that calls `stopPropagation` could prevent the provider's document-level listener from firing. Mitigation: capture-phase listener at document level cannot be stopped by a descendant's `stopPropagation` call (capture runs before the target). We're safe. Worth a confirmatory comment in the provider.

**10. `undo`/`redo` are declared in the vocabulary but nothing handles them yet.** The audit decision was "macOS semantics — chain walks from innermost". That's already how the chain works, so no code change was needed. But nothing *handles* `undo`/`redo` anywhere today. It's a no-op until R2 brings in editor responders that register for them. Recommended fix: when R2 migrates `tug-input` / `tug-textarea` / `tug-prompt-input`'s editor-level `undo`/`redo`, include tests that verify the walk works correctly.

### 7.4 Overall grade: B+

| Area | Grade | Why |
|---|---|---|
| Architecture | A- | The mechanism is right, the story is coherent, the substrate is sound. |
| Type safety | B+ | Meaningfully stronger than before, with one cast and an untyped payload field. |
| Consistency | C+ | Partial migration state; R2 is required for the benefit to land at suite level. |
| Coherence | A | The mental model is finally one story, not six. |
| Implementation strategy | B+ | Phases shipped cleanly with tests passing, but the full suite wasn't run and the work wasn't eye-tested in browser (at the time of the snapshot). |
| Documentation | A- | Inline comments, vocabulary file, audit doc all match the code. |

The work landed is solid and in the right direction. What's missing is mostly "R2 and polish", not "architectural backsliding" — the new mechanisms *prevent* the classes of bugs we fought in the last several rounds of menu work. The substrate is the hard part, and it's done.

---

## Part 8 — Path to straight A's

The Part 7 report card identified four laggards: **Type safety (B+), Consistency (C+), Implementation strategy (B+), Documentation (A-)**. This section plans the specific work required to move every grade to A, ordered so each phase's exit criteria can be independently verified and landed.

The phases are grouped by the grade they're primarily moving. Every grade has multiple inputs; Part 8's ordering prioritizes the ones that unblock the most downstream work first.

### Phase A1 — Cheap wins that move the needle (1–2 short sessions)

Ship these before starting the bigger R2 migration so R2 can assume they're in place.

1. **Focus-based first-responder promotion** *(fixes Hole 6)*
   - Add a document-level capture-phase `focusin` listener in `ResponderChainProvider` that calls `findResponderForTarget(event.target)` and promotes the result, mirroring the `pointerdown` listener.
   - One function, ~10 lines, alongside the existing promoter.
   - Exit criteria: Tab-focusing a contentEditable inside a card promotes the editor responder, not the card. Keyboard-only users get parity with mouse users.

2. **`TugEditorContextMenuItem` with typed `action`** *(fixes Hole 3)*
   - Introduce a distinct item type in `tug-editor-context-menu.tsx` with `action: TugAction` instead of `id: string`.
   - Update `tug-prompt-input.tsx`'s `menuItems` definitions to use the new type.
   - Drop the `id as TugAction` cast at the dispatch site.
   - Exit criteria: a typo like `action: "cutt"` in a menu item definition fails at compile time.

3. **R1 invariant test** *(fixes Hole 7)*
   - Add one test that mounts a parent responder containing a child responder, fires a pointerdown on the child's DOM element, and asserts `manager.getFirstResponder() === childId`.
   - Second test that asserts `findResponderForTarget` returns the innermost match for a deeply nested structure.
   - Exit criteria: direct coverage of the invariant that makes R1 correct.

4. **`data-first-responder` DOM debugger** *(fixes Hole 5)*
   - `ResponderChainManager` subscribes internally: on every first-responder change, clear `data-first-responder` from any element that has it and set it on the element with `data-responder-id === firstResponderId`.
   - Three lines in the manager's promotion path plus a tiny DOM query.
   - Exit criteria: devtools shows exactly one `[data-first-responder]` at any time, matching the chain's current state.

5. **`narrowValue<T>` utility** *(fixes Hole 2)*
   - Add `narrowValue` helper function in `responder-chain.ts` or `action-vocabulary.ts`: `narrowValue<T>(event: ActionEvent, guard: (v: unknown) => v is T): T | null`.
   - Document the convention in `action-vocabulary.ts`: handlers that read `event.value` should use `narrowValue` instead of casting.
   - Add the utility without forcing existing code to adopt it immediately — R2 migration pass will use it naturally.
   - Exit criteria: utility exists and is documented; first use lands in R2.

6. **Confirmatory comment in the capture-phase listener** *(fixes Hole 9)*
   - Add a one-paragraph comment in `ResponderChainProvider` explaining why a descendant's `stopPropagation` cannot interfere with the document-level capture listener.
   - Exit criteria: a future contributor reading the code cannot accidentally introduce the regression described in Hole 9 without confronting the comment.

**Grade impact after A1:** Type safety → A-, Implementation strategy → A-, Documentation → A.

### Phase A2 — R2: Migrate interactive controls off callback props (multi-session, largest phase)

This is the main consistency lift. Order below is chosen to establish the pattern on simple components before attempting complex ones. Each substep has its own exit criteria; the phase as a whole is complete when every tug-* interactive control dispatches through the chain and no callback props remain.

Per the Part 4 decision: **clean break, no compat shims, no deprecation cycle.** Every migration updates the component *and* all its consumers in the same commit.

#### A2.1 — Pattern establishment: `tug-checkbox`, `tug-switch`

Two smallest components. Migrate both to establish the template.

- Each accepts `senderId?: string` (auto-derived via `useId` if omitted) so parent responders can disambiguate multi-control forms.
- Dispatch `toggle` with `{ value: newCheckedState, sender: senderId, phase: "discrete" }`.
- Remove `onCheckedChange` prop entirely.
- Update every gallery/card consumer to register a `toggle` handler via `useResponder` that switches on `event.sender`.
- Exit criteria: both components compile without `onCheckedChange`; gallery demos work; tests pass.

After A2.1, extract the pattern into a brief "migration template" file that subsequent sub-phases can follow mechanically.

#### A2.2 — Selection controls: `tug-radio-group`, `tug-choice-group`, `tug-option-group`

Dispatch `selectValue` with `{ value: selectedId, sender: senderId, phase: "discrete" }`. Remove `onValueChange`, `onFocusChange`. Arrow-key navigation in `tug-choice-group` and `tug-option-group` dispatches `focusNext` / `focusPrevious` through the chain instead of calling the current `onFocusChange` callback.

#### A2.3 — Tabs: `tug-tab-bar`

Dispatch `selectTab` and `closeTab` with `{ value: tabId, sender: senderId, phase: "discrete" }`. Remove `onTabSelect` and `onTabClose`. The enclosing card's `previousTab` / `nextTab` action handlers stay where they are — they're card-level navigation, not tab-bar-level.

**Responder ownership.** `Tugcard` already registers a responder with `id: cardId` and already has direct store access via `useDeckManager()`. A2.3 adds two entries to that existing actions map: `selectTab: (event) => { saveCurrentTabState(); store.setActiveTab(cardId, event.value as string); }` and `closeTab: (event) => store.removeTab(cardId, event.value as string)`. No new responder node, no callback prop forwarding through `deck-canvas`. The inline arrows currently in `deck-canvas.tsx` (`onTabSelect={(tabId) => store.setActiveTab(cardState.id, tabId)}` and the `onTabClose` peer) disappear in the same commit.

**Side-effect deduplication bonus.** The `saveCurrentTabState` call is currently duplicated three times in `tug-card.tsx` — once in the `handleTabSelect` wrapper and once each in `handlePreviousTab` / `handleNextTab`. After A2.3, `previousTab` / `nextTab` handlers compute the target tabId and dispatch `selectTab` through the chain (which routes back to the same Tugcard responder, no infinite loop, single handler call), so the save-state side effect runs once in the `selectTab` handler instead of three places.

**`onTabAdd` is deferred to A2.5**, not handled here. The tab bar's `+` button is a `tug-popup-button` consumer; its migration belongs in the popup-button substep where every popup-button consumer migrates together. Until then, `onTabAdd` remains a callback prop on Tugcard — the only residual tab-related callback. A2 exit criteria are evaluated at the end of A2, not between substeps, so this is permitted.

#### A2.4 — Accordions: `tug-accordion`

Dispatch `toggleSection` with `{ value: sectionId | sectionIds, sender, phase }`. Remove `onValueChange`. Both single-expand and multi-expand modes dispatch the same action; the payload's shape (string vs array) distinguishes.

#### A2.5 — Popup menus: `tug-popup-button`

Follow the `TugEditorContextMenu` precedent: the menu item's `action` field *is* the action name (use the typed item type from A1 step 2). Dispatch via `dispatchForContinuation` to pick up any continuation returned by the handler. Remove `onSelect`.

**Includes the tab bar's `+` button (deferred from A2.3).** The tab bar's add-tab affordance is a `tug-popup-button` whose menu lists registered card types; selecting one currently fires `onSelect → onTabAdd → store.addTab(cardId, componentId)` via callback props. A2.5 migrates this consumer alongside every other popup-button consumer:

- **New action `addTab` in the vocabulary** — payload `{ value: componentId, sender: cardId }`. Distinct from the existing `addTabToActiveCard` action (which adds a hardcoded `"hello"` tab to the topmost card from the menu/keystroke path); `addTab` carries both the target card and the user-chosen componentId.
- **Tugcard handler** — `addTab: (event) => store.addTab(cardId, event.value as string)`. Drops in alongside the `selectTab` / `closeTab` handlers added in A2.3. The `cardId` is in scope because Tugcard owns the chain node.
- **Prop removals** — `onTabAdd` comes off Tugcard's props, off TugTabBar's props, and the inline arrow `(cId) => store.addTab(cardState.id, cId)` disappears from `deck-canvas.tsx`.
- **Test churn** — same shape as A2.3's test updates: `onTabAdd={() => {}}` stub usages get deleted; any instrumentation tests that captured `addedComponentIds` get rewritten to assert against the store snapshot.

After A2.5, Tugcard has zero callback props for tab interactions. All three actions (`selectTab`, `closeTab`, `addTab`) plus the existing menu/keystroke `addTabToActiveCard` flow through the chain.

#### A2.6 — Value-editing controls: `tug-slider`, `tug-value-input`

This is where `ActionPhase` beyond `discrete` starts earning its keep. Dispatch `setValue` with `{ value: numericValue, sender, phase }` where phase is `"begin"` on drag start, `"change"` during drag, `"commit"` on release. Non-dragging changes (keyboard up/down, wheel) dispatch `phase: "discrete"`. Remove `onValueChange` and `onValueCommit`.

Parents registering a `setValue` handler can branch on `event.phase` to distinguish live preview from committed value.

#### A2.7 — Text editors: `tug-input`, `tug-textarea`

Register as responders (like `tug-prompt-input` already does) for `cut`, `copy`, `paste`, `selectAll`, `undo`, `redo`. Each of these editor variants has its own undo stack; the chain's innermost-first walk automatically sends undo/redo to the focused editor per the Part 4 macOS decision.

No callback props to remove on these — they inherit from Radix/native input. The change is purely additive: they become responders that handle editing actions.

After A2.7, the keybinding map's ⌘Z, ⌘X, ⌘C, ⌘V, ⌘A all route to the focused editor without per-component keyboard wiring.

#### A2.8 — Floating surfaces: `tug-confirm-popover`, `tug-alert`, `tug-sheet`, `tug-popover`

Dispatch `confirmDialog` / `cancelDialog` / `dismissDialog` / `dismissPopover`. Remove `onConfirm`, `onCancel`, `onOpenChange`. These also become Phase R6 candidates (subscribe to `observeDispatch` for external dismiss).

#### A2 exit criteria

- Zero tug-* interactive controls use React callback props for user interactions.
- Every control dispatches a typed action via the chain.
- Every gallery and card consumer registers responders with typed handlers.
- `bun run check` and `bun test` both clean.

**Grade impact after A2:** Consistency → A. The component library is now uniformly chain-native.

### Phase A3 — R4: Complete the macOS standard keybinding map (1 session)

After A2, every component that needs to respond to a standard shortcut has a registered handler. Now add the bindings.

Full additions to `keybinding-map.ts`:

| Shortcut | Action | Notes |
|---|---|---|
| ⌘Z | `undo` | Walks innermost → editor → card → canvas per macOS semantics. |
| ⇧⌘Z | `redo` | Same walk. |
| ⌘W | `close` | Closes the first card responder. Handled by `tug-card`. |
| ⌘T | `addTabToActiveCard` | Already bound via `addTabToActiveCard` action; wire the keystroke. |
| ⌘⇧T | `reopenTab` | Requires a reopen-tab handler somewhere (card? canvas?). Decide placement during implementation. |
| ⌘1..⌘9 | `jumpToTab` | Dispatch with `{ value: tabIndex }` payload. `tug-card` handles. |
| ⌘F | `find` | Existing `find` stub on `tug-card`; bind the key. |
| ⌘, | `showSettings` | Already in the vocabulary; bind the key. |
| ⌘. | `cancelDialog` | Works with A2.8 dialogs. |
| Escape | `cancelDialog` | Complements ⌘.; some dialogs listen to both. |
| ⇥ / ⇧⇥ | `focusNext` / `focusPrevious` | Requires a chain-wide focus-next implementation; discussed below. |

`focusNext` / `focusPrevious` are the most architecturally interesting. The current keyboard navigation in selection controls (arrow keys within a `tug-choice-group`, for instance) can dispatch these through the chain instead of managing focus imperatively. Implementation: a document-level handler that queries all elements with `data-responder-id` in DOM order and walks forward/backward. Sketch, not yet committed — decide during implementation whether to keep it in the chain or leave it to native focus.

**Exit criteria:** every standard macOS shortcut has exactly one entry in `keybinding-map.ts`, dispatches a typed action, and works end-to-end.

### Phase A4 — R6: Retrofit `observeDispatch` to floating surfaces (1 session)

Now that A2.8 has made `tug-confirm-popover`, `tug-alert`, `tug-sheet`, `tug-popover` into chain citizens, the `observeDispatch` dismiss pattern can retrofit into each. Also apply to `tug-context-menu`, `tug-popup-button`, `tug-tooltip`.

Template (from `tug-editor-context-menu.tsx`):

```tsx
useLayoutEffect(() => {
  if (!open) return;
  return manager.observeDispatch(() => {
    if (blinkingRef.current) return;
    onClose();
  });
}, [open, manager, onClose]);
```

Per-surface adaptation:
- Menus and popovers: dismiss on any dispatch.
- Tooltips: dismiss on any dispatch (a click elsewhere cancels the hover state).
- Alerts and sheets: already have explicit dismiss actions (`cancelDialog`); `observeDispatch` is redundant but consistent — a click outside that goes through the chain closes them. Evaluate per-surface whether to opt in.

**Exit criteria:** each floating surface's per-surface outside-click and escape-key wiring is replaced by one subscription to `observeDispatch` (keeping Escape as a direct handler where the surface also needs keyboard dismiss).

### Phase A5 — Update `component-authoring.md` (1 short session, post-A2)

Per Part 4 decision 5, this happens *after* A2 lands so the doc reflects reality, not aspiration.

Additions to the checklist:
- **Controls emit actions via the chain.** Every interactive component that responds to user input must dispatch a typed action via `manager.dispatch` or `manager.dispatchForContinuation`. Callback props for user interaction are prohibited.
- **Responders register via `useResponder`.** Every component that handles actions must call `useResponder` with a typed `actions` map and attach `responderRef` to its root DOM element.
- **`data-slot` + `data-responder-id`.** Both attributes on the root element.
- **No `makeFirstResponder` in component code.** First responder is managed by the chain. Programmatic promotion (e.g. `showComponentGallery` opening a new card) is the only exception and must be documented.
- **Migration template section.** A short "L11 migration pattern" section with a worked example from A2.1.

**Exit criteria:** a new contributor writing a fresh interactive component has exactly one path to follow — the doc, the responder chain, the typed vocabulary — and cannot accidentally fall back to the callback-prop anti-pattern.

**Grade impact after A5:** Documentation → A.

### Phase A6 — Clean up the small remaining footguns (cleanup, 1 short session)

1. **Remove `GalleryAction` from the top-level `TugAction` union.** Introduce a generic type parameter (`TugAction<Extra = never>`) that galleries opt into via `TugAction<GalleryAction>`. Production code imports `TugAction` and doesn't see demo names in autocomplete.
2. **Optimize the `canHandle` wrapper in `useResponder`.** Only install the wrapper when the caller actually provides a `canHandle` function; leave it undefined otherwise to skip the permanent closure.
3. **Consider extending `ResponderScope` to render an optional host element.** If more than two components end up needing a wrapper div (deck-canvas was the first), promote it. If it stays a one-off, leave it.
4. **Run the full `bun test` suite and triage any collateral damage.** Track the two known flakes (`tugcard.test.tsx` `connection.onFrame` mock and `do-set-region-wiring.test.ts` timing) as pre-existing and unrelated. Address anything new immediately.

**Grade impact after A6:** Type safety → A, Implementation strategy → A.

### A-phases summary

| Phase | Duration | Primary grade impact |
|---|---|---|
| A1 | 1–2 short sessions | Type safety, Implementation strategy, Documentation |
| A2 | Multi-session | Consistency (C+ → A) |
| A3 | 1 session | L11-for-keyboard completeness |
| A4 | 1 session | Floating-surface consistency |
| A5 | 1 short session | Documentation (A- → A) |
| A6 | 1 short session | Type safety polish, footgun removal |

**Projected post-A6 grades:** all A (or better). The remaining soft spot is payload type safety — deferred as a conscious tradeoff per Part 4 decision 1. If the `narrowValue` utility convention doesn't hold up under R2 pressure, Phase A7 (deferred, not committed) would introduce per-action discriminated unions.

---
