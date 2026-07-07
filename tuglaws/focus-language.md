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
- **Lifecycle reclaims** — a sheet/banner `didHide` over the card, a pane drag/resize commit (`cardDidMove` / `cardDidResize`, which fire even for a zero-move title-bar click), the body's mount claim — run the same gate before falling back to the editor (the dev card consolidates this as `reclaimFocusDestination`).

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

## Authoring contract

Building a control or surface that participates in the language:

- **Appearance is CSS only** ([L06]). Style focus/selection by selecting on the engine attributes above. Never drive a focus style from React state.
- **Author controls into a focus group.** Give every focusable a `focusGroup` (the enclosing surface's group) and a `focusOrder`; that is what puts it in the `Tab` walk and the spatial plane. A control with neither is a native-only stop and will read as "Tab skips it."
- **Seed the opening key view** with `useSeedKeyView(\`${group}:${order}\`)` — the field for a form, the list for a picker, the default button for a button-only surface. For a Radix-trapped dialog, prefer `onOpenAutoFocus` → `event.preventDefault()` + `focusManager.armKeyboardRestore(...)` so the engine, not Radix, owns the seed.
- **Mark the commit button** with `persistentDefaultRing` (and `primary` emphasis) so it holds the default ring and owns `Return`. Danger confirmations seed the default on **Cancel** so `Return` can't fire a destructive action. Gate the flag when the surface's `Return` is consumed elsewhere mid-flow (a wizard whose options commit on `Return`): the ring must light only when `Return` truly fires the button — see "Buttons" above.
- **Never focus the resting editor directly from a lifecycle trigger.** Any reclaim that can fire while a card-modal dialog is pending must resolve the card's focus destination through the [P20] gate (`adoptKeyCard`, or the dev card's `reclaimFocusDestination`) — see "The card's focus destination — one rule."
- **Declare the arrow order** with `useSpatialOrder(rowGridOrder([...]))` (or a hand-built `SpatialOrder`). For a **dialog/sheet/alert**, the `useSpatialOrder` call must run **inside** the trap's `FocusModeScope` — mount a small null-rendering registrar there (see `AlertSpatialOrder` / `ConfirmPopoverSpatialOrder`); calling it in the component body binds the order to the mode *above* the trap ([L03]).
- **The engine is structure** ([L22]). Key view, cursor, scope stack, and cycling-mode push/pop are the `FocusManager`'s; never mirror them in `useState`.

Reference implementations: `TugConfirmPopover` and `TugAlert` (dialog button rows), the dev-card pickers and `gallery-sheet` bodies (field + buttons), `TugListView` (item-group + cursor).

---

## See also

- [component-authoring.md](component-authoring.md) — the per-component checklist this language plugs into.
- [responder-chain.md](responder-chain.md) — action routing; the chain is how `Space`/`Enter`/`Escape` reach the right handler once focus is established.
- [tuglaws.md](tuglaws.md) — [L06] appearance via CSS, [L22] zone boundaries, [L03] layout-effect registration, [L19] component authoring.
