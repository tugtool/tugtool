# The Focus Language

*The single keyboard-focus model every interactive surface in the app obeys: the visual signature of focus and selection, the two planes keyboard motion moves on, and how commit is separated from movement. Read this before adding a focusable control, a dialog/sheet/alert, or any surface a keyboard user navigates.*

*Cross-references: `[L##]` → [tuglaws.md](tuglaws.md). `[D##]` → [design-decisions.md](design-decisions.md). The visual overview lives in the **Focus Language** gallery card (`gallery-focus-language.tsx`); the full design history is `roadmap/tugplan-focus-language.md`.*

---

## Why one language

A keyboard user needs to answer two questions at every moment: *where am I?* and *what is chosen?* Before this model the app answered the first with one global orange outline on whatever held DOM focus, and conflated the second with the first. The focus language separates them and makes both answers consistent across every archetype — a button, a text field, a radio group, a list, a dialog box — so the treatment a user learns on one control reads correctly on all of them.

The engine (the `FocusManager`) is unchanged by this language: it owns the key view, the cursor, the per-card scope stack, and projects them as DOM attributes. The language is **appearance** ([L06]) — CSS keyed on those engine attributes. No component sets a focus style from React state.

---

## The signature: focus is a ring, selection is a fill

Two independent marks, never conflated:

- **Keyboard focus** = a **ring** (role color) plus a faint **behind-tint** (role color) on the focused component. It says *the keyboard is here*.
- **Committed selection** = the component's **native fill** — a radio dot, a choice/tab pill, a checkbox/option fill, a row fill. It says *this is chosen*.

They are orthogonal: a ring can sit on an already-selected item (it is offset just outside the item so it survives atop a fill — which is what lets multi-select work with no extra checkmark).

**Leaf vs. item-group:**

- A **leaf** (button, text field, checkbox, switch, slider) rings the **whole component** — box *and* label together, never just the glyph.
- An **item-group** (radio group, choice group / tab bar, option group, list, accordion, dialog answer list) tints the **container** and rings the **cursor item** inside it.

## One role axis, default `action`

There is no role-less branch. Every focusable's ring, selection-fill, and behind-tint resolve from a single role axis whose default is `action` (the interactive blue). Role-bearing controls (checkbox, switch, radio, choice, option, and role buttons) color both the fill and the ring with their role (`danger`, `accent`, …); a role-less control simply rides the action default. A text input is role-less by default, but its **validation** state maps onto the axis — an invalid field is the `danger` role and focuses red.

## Buttons: fill is the live control; the default rests at a tint

A pure action control has no separate "selected" state, so the cursor takes over the fill — but **solid fill is reserved for selection and the live (focused) control**. Three resting states:

- **Rest** — outlined.
- **Recommended default** — the button `Return` fires while the cursor rests elsewhere — rests at a **tint** (`primary` emphasis) with a ring. This is the `persistentDefaultRing` treatment; the engine owns the `data-default-ring` attribute so the one-filled-ring-per-scope invariant is structural. The ring is a **promise, and it must be honest**: `persistentDefaultRing` both paints the ring and registers the button as the scope's Return-home, so it must be set only while `Return` really fires that button. A surface whose `Return` is consumed elsewhere mid-flow gates it — the question wizard's Submit wears the ring only at the review step with every question answered (`Return` on a live question commits-and-advances; before review the ring would lie). The at0202 suite pins this, together with the reveal that scrolls the newly-lit Submit into view.
- **Live / focused** — promotes to its **filled** role style + a role-colored ring; siblings demote to outlined.

A whole **container** that becomes the key view (popover, sheet, alert, inline-dialog box) can't fill: it wears a box-shadow ring that hugs the radius with no reflow, and the quiet "within" variant when it merely contains the active control.

---

## Motion: two planes, explicit commit

Keyboard motion moves on two independent planes, and **commit is a separate act**:

- **Tab plane (linear).** `Tab` / `Shift-Tab` moves the **key view** through the focusable stops of the current focus mode, in author-declared order. The walk is contained to the current focus mode — it never escapes into another card or a dismissed surface.
- **Arrow plane (spatial).** Within a focused item-group, the arrows move a **cursor** over the members. The order is **author-declared, not geometric** — named rings (closed loops along an axis) and seams between rows, with optional per-node neighbor overrides. A roving cursor never changes the selection.
- **Commit.** `Space` commits the ringed member; `Enter` fires the scope's default (the recommended-default button). Arrows never select.

**Arrow ownership.** A capturing control — a text editor that needs the arrows for its caret — suspends the spatial plane while it holds the key view. `Tab` or `Escape` returns control to the plane.

**Per-card key-window model.** Focus contexts are **per card**. Each card owns its own key view, cursor, default-ring stack, scope stack, **and first responder**, like windows in a windowing system; only the active card's context is live.

The first responder is the chain's *single global* register (see [responder-chain.md](responder-chain.md)), but the key-window model makes focus per-card — so card **activation must restore the first responder** alongside the key view, as the fifth per-card axis. The engine does this in `FocusManager.adoptKeyCard` ([P21] activation): it promotes the responder that contains the activated card's key view (a resting card's editor; a sheet's focused control → the sheet's responder). Without it, a first-responder-routed accelerator (Cmd-W `close`, Cmd-. `cancel-dialog`) is dropped on the just-activated card while the engine's Escape ladder — which reads the active context directly — still works. The first responder must NOT be left to ride DOM `focusin`: that does not fire when the activated key view is a focus-refusing control (a dialog button) or when the activation `.focus()` is idempotency-skipped (DOM focus already on target).

## The card's focus destination — one rule

A card has **one focus destination at any moment**, and it is a rule, not an element: the context's **pushed key destination** when it owns one — a pending card-modal dialog's trap (Question / Permission), a mid-flow focus cycle, a descended scope — and the **resting editor** otherwise ([P20]). Every path that places focus "back on a card" must resolve the destination through that rule:

- **Activation** (click, tab switch, pane promotion, cross-pane move, window blur→focus, cold boot) dispatches through `applyBagFocus`, whose first act is `adoptKeyCard`: a context that owns a pushed destination gets its key view focused and the resting-editor claim is skipped.
- **Lifecycle reclaims** — a sheet/banner `didHide` over the card, a pane drag/resize commit (`cardDidMove` / `cardDidResize`, which fire even for a zero-move title-bar click), the body's mount claim — run the same gate before falling back to the editor (the session card consolidates this as `reclaimFocusDestination`).

A raw "focus the editor" claim is a bug even when it *looks* harmless: under a modal scrim the entry stands down, so the claim cannot move DOM focus — but its **responder promotion still fires**, the chain seed re-points the key view at the editor, and the dialog silently loses its ring and arrow walk while DOM focus sits correctly on the dialog. Symptomless in the DOM, dead to the keyboard.

**The modal barrier covers pane chrome.** While a card is card-modal, a pointerdown anywhere in its pane *outside the bright dialog island* — the scrimmed transcript, and equally the pane's **title bar, frame, and resize edges** — is a stray click: the chain redirects its promotion to the dialog island as a programmatic (non-pointer) promotion, so the seed yields to the dialog's finer key view and the ring survives. Only the pane whose *visible* card is modal participates; a background tab's dialog does not capture its pane. The click still activates the pane / starts the drag — it just never re-places the keyboard.

Boundaries pinned by tests: window blur→focus (at0148), resting-card activation clicks for every click target (at0201), cross-card click-away/click-back onto a modal card — title bar and content, both dialog kinds (at0203).

## No dead surface inside a text substrate

A text editor's interactive surface is its **host**, not its content box. CM6 owns pointer selection and (previously) drag acceptance only within `contentDOM`, which is content-sized — so a host taller than its content (the Dev prompt opens at a min-height) had a blank band that *looked* like editor but ate the caret on click (WebKit's mousedown focus default blurred to body) and refused file drops. The rules:

- **Clicks land the caret.** A primary-button mousedown anywhere inside the host that no finer surface claims (content → CM6 selection, gutters → line select, scrollbar band → native) focuses the editor and lands the caret at the nearest document position (`host-click.ts`). The band advertises `cursor: text`. A read-only editor (the prompt stood down behind a card-modal dialog) claims nothing.
- **Drags target the host.** The drop extension's listeners ride the host (`drop-extension.ts`), so the accept ring and drop caret work over the whole editor, blank band included.
- **A composite entry is ONE drop surface.** The prompt entry layers one entry-root set of drag handlers over its chrome (attachment strip, toolbar, status row); the substrate claims drags over the editor first (`defaultPrevented` is the layering contract), and everything else routes into the same editor pipeline, cued by the editor's own ring + drop caret at the clamped nearest position. Help the drop land — never make the user hunt for the magic pixel.

Pinned by at0204 (blank-band click keeps the caret; drops accept on the band and on the toolbar).

---

## Drag and the keyboard

**A drag is a content gesture, not a focus gesture — on both ends.** Starting a drag does not activate the card the drag starts in; dropping does not activate, focus, or move the key card of the card the drop lands in. A drag from an inactive card leaves it inactive. A drop into an inactive card inserts the content and leaves no caret behind. A drop into the key card inserts at the drop point and the caret follows only because focus was already legitimately there. No drop handler may call `activateCard`, `setKeyCard`, `place()`, or a raw `.focus()`.

This is the platform's rule, not ours to reinvent. Apple's HIG says content should be draggable from inactive windows "without necessarily bringing those windows to the front," and dropping from an active window into an inactive one leaves activation and focus on the source. The WHATWG drag-and-drop model specifies no focus or activation semantics at any point in the drag; the `drop` default action for an editing host is to insert the data "in a manner consistent with platform-specific conventions" — the web defers to the platform, and our platform is macOS. Our handlers `preventDefault()` and perform insertion themselves, so no per-browser default focus behavior runs: the outcome is entirely ours, and it is *insert without focusing*.

**Pointer selection commits on pointerdown.** A list moves its committed selection — the `data-selected` fill, the delegate's `onSelect` — on `pointerdown`, not on `click`, exactly as `NSTableView` selects the row a mousedown lands on and then drags what it selected. Click-gated selection makes selection structurally unreachable from any gesture that becomes a drag (a drag fires no `click`) and from any first-click-activates gesture (the activation `mousedown` `preventDefault` eats the `click`). The click path stays as an idempotent fallback for synthetic clicks that arrive with no preceding pointerdown — `Space` on a focusable child inside a cell bubbles one — but pointerdown is where selection is decided.

**Activation defers for gestures on draggable content.** The Mac "first click activates" convention is implemented by `preventDefault()`ing the activation `mousedown`, and a `preventDefault`ed mousedown is also the browser's signal *not* to begin a native drag — so a naive activation click swallows the whole first drag. The gesture interpreter therefore resolves the ambiguity the way macOS does, after mousedown rather than at it: a `pointerdown` inside a `[draggable="true"]` element in a non-active card **arms** a pending activation instead of committing one and skips the `preventDefault`; a `dragstart` **cancels** it (the gesture is a drag — the source card stays inactive, macOS background-drag semantics); a `pointerup` **commits** it, running the same activation transfer the synchronous branch runs. The two endings are mutually exclusive by construction: once a native drag begins the browser ends the gesture with `dragend`, never `pointerup`.

Two consequences are intended, not accidents:

- A plain click on a draggable row in a background card raises the pane on pointer**up**, not pointerdown — the same as clicking an icon in a background Finder window.
- Because the gesture keeps the browser's mousedown focus default, the browser walks up from the click target and focuses the nearest tabindex'd ancestor — the background card's container. The watchdog corrects it, but **quietly**: this is browser churn from a gesture the engine deliberately let through, not a raw focus write by our code, and ledgering it as a steal would warn on every drag about a writer no author could fix. The engine knows the window is open because the interpreter opens it (`beginDeferredGesture`) and closes it when the gesture resolves.

**The first click after a native drag has no `pointerdown`.** A native drag session consumes the pointer stream's release: WebKit's pointer-event state machine still holds the pointer "down" when the drag ends, so the next press emits only `mousedown` (its release delivers the catch-up `pointerup` that re-syncs the machine). Every pointer-gesture layer in the deck — activation classification, chain promotion, engine placement, list selection — rides capture-phase `pointerdown`, so without correction the entire first post-drag click is invisible: no activation, no selection, no caret. The gesture interpreter heals the stream in one place rather than teaching every layer a mousedown fallback: a trusted primary `mousedown` with no preceding `pointerdown` synthesizes the missing `pointerdown` on the same target, synchronously, before any other mousedown listener runs. Authors must not add per-component mousedown fallbacks for this case — the healed stream is the contract.
- **Chain promotion defers with activation.** The responder chain's `pointerdown` promotion is skipped for the same gestures — draggable content in a non-key card — because the deferral would otherwise split the registers: the chain first responder would land on the drag source while the deck first responder stayed on the key card, mis-routing the next accelerator. If the gesture resolves as a click, the activation-moment settlement ([P21]'s framework half, `settleFirstResponderForActivation`) owns the chain register, which is its designed job; if it resolves as a drag, nothing was touched and the outgoing card's registers are undisturbed.

---

## The contract — engine attributes → CSS

For any focusable, the engine projects these attributes; CSS reads them ([L06]). Components do not invent their own focus attributes.

| Attribute | On | Renders |
|-----------|----|---------|
| `data-key-view-kbd` | a **leaf** | ring (role) + faint behind-tint (role) |
| `data-key-view-kbd` | an **item-group container** | faint behind-tint (role) on the container |
| `data-key-cursor` | an **item** | ring (role), offset so it survives atop a fill |
| `data-selected` / native checked-active state | the component | the component's **native fill** in the role color |
| `data-default-ring` | a button | the recommended-default ring (engine-owned; one per scope) |
| `data-key-within` | a container | the quiet "contains the active control" mark |

Role resolves from a prop (or a validation class) to the matching `--tug7-…-filled-{role}-*` family; default `action`. The geometry/color knobs are the `--tugx-focus-*` tokens.

---

## One writer, one interpreter, one truth

The engine has exactly **one focus-write primitive**: `FocusManager.place(cardId, target, opts)`. A placement records the card's `FocusTarget` (a serializable descriptor: a focusable id, a stable `group:order` focus key, a `data-tug-state-key`, a responder, the card's engine surface, or none) and — iff that card is the key card — realizes it transactionally: the target is **resolved first** (the named focusable registered and rendered, the responder reachable, the state-key element connected), and only a resolvable target commits key view, route, and focus in one pass. An unresolvable target returns `unrealized` and changes nothing — a ring is never lit over a destination that is not there. A claim for a background card records (and caches its key view for the [P20] activation restore) but moves nothing. The persisted `bag.focus` is just the serialized target, so restore, activation, tab switch, and cmd-tab return are the same operation; a keyboard placement naming a not-yet-mounted focusable realizes declaratively when the matching focusable registers.

**One interpreter — who may classify a pointer gesture.** `gesture-interpreter.ts` owns every document-level pointer listener in the deck (the post-drag resync shim, `pointerdown`, `mousedown`, `pointerup`, `pointercancel`, `dragstart`, `dragend`) and classifies each gesture exactly once into a `GestureClassification`: where it landed, whether it activates / defers / deselects / does nothing, whether the chain promotes from the target or a redirect, whether the engine may place, whether the paired mousedown's browser focus default is prevented, and the named reasons behind each. Consumers — the pane-focus controller, the responder chain, `TugListView` — **read** that record; none re-derives a gesture fact from the event. Four independent walks that had to agree by hand is what produced activation `preventDefault` killing native drags, a gate that refused the engine's own sink, and a cross-module one-shot latch handing placement suppression between modules. Consumers reading one record cannot disagree, and registration order stops being a correctness input.

Two consequences authors must uphold: a surface that wants a gesture-level policy **declares** it (`data-tug-placement="suppress"` on chrome whose clicks must not move the key view, re-declared `"place"` on the surface inside it that must; `data-tug-focus="refuse"`; `data-tug-fr-preserve`; `data-no-activate`) rather than installing its own document listener to intercept the stream. And the interpreter's listeners must fire first: they register from `usePaneFocusController`'s `useLayoutEffect` in `deck-canvas.tsx`, a *child* of `ResponderChainProvider`, and child layout effects run before the parent's. Moving the install site into the provider would silently invert the order.

**Deselect is a deliberate classification.** A pointerdown deselects only when its target **is** the deck canvas's background element (`data-deck-canvas-background`, matched by identity, not containment). A gesture that merely misses every pane — a portal gap, an overlay seam, geometry below the fold — classifies as chrome and changes no activation. Deselect used to be the *absence* of a pane under the pointer, which made a click that missed silently clear the active card.

**The router is the target, not `document.activeElement`.** Keys dispatch from the engine's `FocusTarget`; DOM focus is a peripheral the engine points at one of two places, derived from the target's class — the **route**:

- **`engine-routed`** — every non-text target (buttons, lists, tab bars, chips, containers). The engine parks `document.activeElement` on the **key sink** (`[data-tug-key-sink]`, a visually-hidden always-mounted register rendered by the provider; a focus-jailing surface hosts its own sink inside the jail, and the engine parks at the innermost). Keys reach the component through the key-view delegation channel (`KeyboardRoute`, `KeyViewBehavior.onKey`), not through element keydown handlers — an engine-routed element under the sink never sees its own `keydown`. The park is hygiene, not a routing precondition: keys route from the target whether or not the park has landed. Focus resting on the sink is the **engine** holding the keyboard, never the user focused on a control — every consumer that classifies `document.activeElement` must treat it that way. `FocusManager.mayClaimActivationFocus` counts a parked sink as nothing-to-steal, like `<body>`: an activation click that finds the sink under `activeElement` proceeds to its focus dispatch and lands its caret in one click instead of stranding with settled registers. A live engine keyboard behind the park — a ringed list mid-arrow-walk — is protected downstream instead: `resolveBagFocus` resolves to `none` when the engine already holds the target card's key view, so a permitted dispatch realizes the recorded target ([P20]) and its generic default-focus walk can never displace a live ring (the walk would land on the first tabbable — a section's filter input — and yank the ring off the list the same gesture just placed it on).
- **`dom-granted`** — text surfaces only: a responder with a registered **focus contract** (the CM6 editors), or a `state-key` / engine-surface target. The engine GRANTS real DOM focus (contract first, generic walk second, always `preventScroll`) and stands back; the surface owns its caret, selection, and IME.

The **repealed rule**: "every ringable stop must be DOM-focusable" is dead, and with it the tabindex sprawl. Engine-routed stops render **no `tabindex`** — the ring is the engine's promise that keys route there, not that the element can hold DOM focus. (WebKit's mousedown default focuses any tabindex'd ancestor; not rendering one removes that steal class by construction.)

**Raw `.focus()` is legal only inside a granted window.** A substrate may claim its own surface (CM6 `view.focus()`) while its responder's focus contract makes it the dom-granted target — the engine legalizes that claim (`focusin` promotion, key-card-gated). Everything else — every "put the keyboard somewhere" write — routes through `place()`. There is no legal raw focus write to an engine-routed element.

**Grants are idempotent.** No engine-realized grant may call `.focus()` on a surface that already contains `document.activeElement`. WebKit drops focus to `<body>` when an already-focused contenteditable is re-`focus()`ed, so a redundant grant does not "reassert" anything — it destroys the state it was meant to restore, and the watchdog declines to correct `<body>`. The guard belongs in the substrate that owns the view (`paintMirrorAsActive` guards on `view.hasFocus`), not at each call site, so every engine-hook consumer inherits it; the selection and scroll re-asserts that follow a grant are already idempotent and stay unconditional. This is why an engine `place()` may keep invoking the hook unconditionally: the hook is safe to re-run.

**One truth — the DOM is a projection, not a second model.** Every focus mark (`data-key-view`, `data-key-view-kbd`, `data-key-within`, `data-focus-mode`, `data-default-ring`) **and** the one legal `document.activeElement` are computed together by a single pure derivation over engine state (`computeProjection`) and applied by a single convergence pass (`reproject`, diff-then-write). Projection is **state-driven, not transition-driven**: any caller may reproject at any time and the DOM converges to the model. This is what makes a transient key-card change harmless — the marks are an image of state, not a residue of the transitions that wrote them, so a card that goes away and comes back derives the same record it started with. Authors never write a focus mark; mutate state and let the projection follow.

**The watchdog is the reconciler.** `checkFocusInvariant` runs the same derivation the projection does, in two registers. It first heals the **marks** — reprojecting whatever drifted — **quietly** (`debug`, never the steal ledger): mark drift is our own missed transition, and ledgering it would blunt the budget assertions the app-tests rely on. It then enforces the **register**: it computes the one legal `activeElement` for the current route (engine-routed → a sink; dom-granted → the granted surface by containment; accessibility mode → the key-view element itself) and **reasserts** it when an illegal element holds it — re-park, re-grant. Every register correction is attributed in the **steal ledger** (`getFocusInvariantReport().steals`, offender → count, surfaced in the dev panel and budget-asserted in app-tests): any `warn`-level steal is a bug in the writing code, never noise to suppress. Browser focus landing on the engine's own stop (a clicked key view) is corrected quietly (`debug`) — ring and router agree; only the register was off.

**Corrections never fail silently.** A correction the watchdog wanted to run but could not — most concretely, a re-park that finds no `[data-tug-key-sink]` to park on and returns `false` — records a `warn`-level ledger entry naming what it wanted to do and why it couldn't. A watchdog that classifies a steal correctly and then no-ops without a trace converts a caught bug into an uncaught one: that is exactly how an illegal caret survived a correctly-detected steal. The ledger is already surfaced in the dev panel and budget-asserted in app-tests, so a failed correction becomes a test failure for free.

**The reconciler's carve-outs are named contracts, not undocumented exceptions.** Four survive, and each is a rule with a reason:

- **The deferred-gesture window.** While the interpreter has parked a gesture's activation (draggable content in a background card), the browser's own mousedown focus default is deliberately let through, so the focus move it produces is corrected **quietly** — browser churn from a gesture the engine chose not to prevent, not a raw write any author could fix. The window opens and closes with the gesture (`beginDeferredGesture` / `endDeferredGesture`), and the interpreter is its only caller.
- **The reassert budget.** A bounded number of corrections per settled state, so the reconciler stands down instead of fighting a peer focus enforcer (a Radix `FocusScope`) at event cadence. Exhausting it is itself a `warn` — a stand-down is reported, never silent.
- **Standing legality classes.** A park on any sink, a bare native control, and `<body>`/`null` are legal without further inspection: the first two are the engine's own registers, and the last is the transient the browser leaves behind between writes.
- **The chrome allowlist.** `data-tug-chrome="non-focus-capturing"` is the one DOM input to the activation-permission query — chrome that holds DOM focus without meaning to own the keyboard. It shrinks as the interpreter models more chrome gestures; it never grows to describe new element kinds.

**Activation permission is an engine query.** Whether an activation may claim focus is answered by `FocusManager.mayClaimActivationFocus(cardId, deckState)` from engine state — deck focus and focus-destination status, the key card, the target card's recorded target and route, plus the one allowlist above. It replaced a nine-branch taxonomy of element kinds that tried to enumerate "configurations where DOM focus is really the engine": every branch was a place for the DOM model and the engine model to disagree. Refusal remains the default and logs its reason at `debug`, so a refused activation is diagnosable without a scratch test.

**Accessibility: focus-follows is the primary screen-reader mechanism.** In `accessibility` keyboard-access mode ([P10], `keyboardAccessStore`, tugbank-backed, host-switched by the Swift side's `NSWorkspace.isVoiceOverEnabled` observation via the `voiceover-changed` control frame), the engine grants real DOM focus to every engine-routed key view — the element regains a `tabindex="-1"` at grant time, the mirror tracks every key-view move, and the watchdog's legal set becomes the key-view element. Real focus on real widgets is the one pattern every assistive technology handles; the sink is never focused while a key view exists. The sink itself carries a quiet `aria-label`, no `aria-activedescendant` (invalid from a sibling), and is never `aria-hidden` (a focusable element must not be).

Consequences authors must uphold:

- **Never pair a paint half with a focus half by hand.** The historical `setKeyView(id, true)` + `focusKeyView()` shape is exactly the drift class this design removed; call `place()`.
- **Never handle keys on an engine-routed element.** Element-level `onKeyDown` on a stop under the sink is structurally dead code; declare a `KeyViewBehavior.onKey` (or a list's `onKeyViewKey` delegate) instead.
- **Never render a `tabindex` on an engine-routed stop.** Focusability is granted (accessibility mirror, dom-granted surfaces), never declared statically.
- **Never grant focus to a surface that already has it.** Guard the `.focus()` in the substrate on the surface's own focus predicate — see "Grants are idempotent" above.
- **Never claim focus from a drop.** A drop inserts content; it does not activate, focus, or move the key card — see "Drag and the keyboard."
- **The ledger is permanent.** Treat any attributed steal as a bug in the writing code path; fix the writer, never widen the legal set.

Enforcement is the watchdog + ledger, the pinned app-tests (at0246 boot honesty, at0247 relaunch, at0250 steal trap, at0251 dialog budget, at0252 accessibility mirror), and reviewer judgment against this section — deliberately **not** a lint rule; a mechanical checker must never gate correct code, and the watchdog sees actual drift (including from browser defaults no lint could model).

---

## Authoring contract

Building a control or surface that participates in the language:

- **Appearance is CSS only** ([L06]). Style focus/selection by selecting on the engine attributes above. Never drive a focus style from React state.
- **Author controls into a focus group.** Give every focusable a `focusGroup` (the enclosing surface's group) and a `focusOrder`; that is what puts it in the `Tab` walk and the spatial plane. A control with neither is a native-only stop and will read as "Tab skips it."
- **Seed the opening key view** with `useSeedKeyView(\`${group}:${order}\`)` — the field for a form, the list for a picker, the default button for a button-only surface. For a Radix-trapped dialog, prefer `onOpenAutoFocus` → `event.preventDefault()` + `focusManager.armKeyboardRestore(...)` so the engine, not Radix, owns the seed.
- **Mark the commit button** with `persistentDefaultRing` (and `primary` emphasis) so it holds the default ring and owns `Return`. Danger confirmations seed the default on **Cancel** so `Return` can't fire a destructive action. Gate the flag when the surface's `Return` is consumed elsewhere mid-flow (a wizard whose options commit on `Return`): the ring must light only when `Return` truly fires the button — see "Buttons" above.
- **Never focus the resting editor directly from a lifecycle trigger.** Any reclaim that can fire while a card-modal dialog is pending must resolve the card's focus destination through the [P20] gate (`adoptKeyCard`, or the session card's `reclaimFocusDestination`) — see "The card's focus destination — one rule."
- **Declare the arrow order** with `useSpatialOrder(rowGridOrder([...]))` (or a hand-built `SpatialOrder`). For a **dialog/sheet/alert**, the `useSpatialOrder` call must run **inside** the trap's `FocusModeScope` — mount a small null-rendering registrar there (see `AlertSpatialOrder` / `ConfirmPopoverSpatialOrder`); calling it in the component body binds the order to the mode *above* the trap ([L03]).
- **The engine is structure** ([L22]). Key view, cursor, scope stack, and cycling-mode push/pop are the `FocusManager`'s; never mirror them in `useState`.

Reference implementations: `TugConfirmPopover` and `TugAlert` (dialog button rows), the session-card pickers and `gallery-sheet` bodies (field + buttons), `TugListView` (item-group + cursor).

---

## See also

- [component-authoring.md](component-authoring.md) — the per-component checklist this language plugs into.
- [responder-chain.md](responder-chain.md) — action routing; the chain is how `Space`/`Enter`/`Escape` reach the right handler once focus is established.
- [tuglaws.md](tuglaws.md) — [L06] appearance via CSS, [L22] zone boundaries, [L03] layout-effect registration, [L19] component authoring.
