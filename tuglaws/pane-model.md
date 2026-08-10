# Pane Model

*The canonical hierarchy for the tugdeck canvas: Deck → Pane → Card. This document formalizes what each concept is, what it owns, and the naming rules that encode it everywhere — code, CSS, DOM, wire format, and menus.*

---

## The Rule

**A Deck holds Panes; a Pane holds Cards; a Card holds one content component.** Position, size, z-order, drag, resize, and chrome are Pane responsibilities. Content identity — `componentId`, `title`, `state` — is a Card responsibility. Multi-card Panes surface a tab strip; a single-card Pane does not. Tabs are a UI affordance for switching among a Pane's Cards, not a separate data concept.

Everything else in this document explains how that rule manifests in code.

---

## Three Concepts

### Deck

The top-level canvas. Owns the layout tree: the set of all Panes, the ordered `cardIds` inside each Pane, and the currently-active Pane. A Deck is a flat state: `{ cards: Card[], panes: Pane[], activePaneId?: string, imposition? }` — not a tree. Cards and Panes live in two flat arrays, and every card belongs to exactly one Pane's `cardIds` list.

| Owner | Responsibility |
|-------|---------------|
| `DeckManager` | Mutations on the layout tree, invariant validation, subscription surface (`useSyncExternalStore`) |
| `DeckCanvas` | Renders the Panes, promotes the active Pane's active Card as first responder on mount |
| `DeckState` (type) | `{ cards, panes, activePaneId?, imposition? }` — the full shape of the tree |

**Deck invariants** (enforced by `validateDeckState`):
1. Every `pane.cardIds` entry references a real `state.cards[].id`.
2. Each card appears in exactly one pane's `cardIds` (no orphans, no duplicates).
3. No pane has `cardIds.length === 0` — closing the last card closes the Pane.
4. Every `pane.activeCardId` is a member of that Pane's `cardIds`.
5. `state.activePaneId`, when set, references a real Pane.
6. At most one Pane hosts each **sidebar** card's componentId, and that Pane carries no `slot` — a sidebar is the imposition's fixed end, not a link in its chain.

### Pane

The visual container. A rectangular frame on the canvas with chrome (title bar, optional tab bar, width and close controls) and a content region. Panes own **position**, **size**, **z-order** (implicit in array order within `deckState.panes`), **acceptsFamilies**, and the ordered `cardIds` list of the Cards they host.

| Owner | Responsibility |
|-------|---------------|
| `TugPane` (component) | Renders the frame; handles drag, resize, title bar, width popup, snap, tab bar |
| `TugPaneBanner` (component) | Renders the pane-scoped modal banner (error/status overlays) |
| `TugPaneState` (type) | `{ id, position, size, cardIds, activeCardId, title, acceptsFamilies, slot?, widthPreset? }` |

A Pane is a **responder** (per [L11]) for actions on Pane state: `close`, `find`, `toggleMenu`. A Pane is **not** responsible for Card content — it delegates to the active Card's `CardHost`.

#### Three geometry modes

A Pane always owns its geometry ([L09]); what varies is what it *derives* that geometry from. There are three modes, and they are mutually exclusive:

| Mode | Marked by | Horizontal | Vertical | Gestures |
|------|-----------|------------|----------|----------|
| **free** | no `slot`, and not a pinned sidebar | `position.x` / `size.width` | `position.y` / `size.height` | drag anywhere; all eight resize handles; snap |
| **pinned** | hosts a **sidebar-role** card whose `imposition.sidebars[id].pinned` is not `false` | held against the side its entry names, one gap in, its rail's width wide | one gap below the top, the deeper gap above the bottom — or its share of that run when it shares the rail | draggable — and the drag is what unpins it; deck-facing edge resize only (width), which keeps the pin |
| **imposed** | `slot: number` | pinned to the slot's anchor across the layout span | same vertical run as pinned | drag or resize evicts it back to free |

Both derived modes are the layout imposer's (`lib/layout-imposer.ts`), and the difference between them is what the arrangement's *end* is versus what its *slots* are.

**Pinned is a sidebar card.** It is not marked by a field on the Pane: a sidebar Pane is one hosting a card whose registration declares `layoutRole: "sidebar"` ([D128] — the Lens and Jots today), derived by `findSidebarPanes`, and whether it is standing at its pin is the deck-level `imposition.sidebars[componentId].pinned` (absent reads as pinned). It holds the arrangement's fixed end at a constant pin and keeps its rail's width, so it never overlaps — which is the point, because a slotted card can end up overlapped and a rail must never be slid under. Its side is that entry's `side`, one of the deck's layout axes.

**Both edges can carry a rail, and one edge can carry two cards.** Cards sharing a side share one rail and stand **front-to-back** in it, exactly as two Panes sharing a slot do: same pin, same width, same full vertical run, and z-order decides which one you see. Rails hold a z-band of their own, above every free Pane (a rail is never occluded by a card) and below the overlay base (or the rail would bury its own menus); within that band the members take the deck's ordinary array order, so `activateCard` raises one over the other. The title bar's **stack badge and picker** ([D123]) are how you reach the covered one — and with two identical rects they are the only way, which is why a rail counts as a stack for the badge exactly as a slot does. Dividing the rail's height between the members was tried first and rejected: it spends a rail to show two half-cards, which is what the Jots section was already doing inside the Lens, only less space-efficient. Nothing about the arrangement is persisted, because there is nothing left to persist — no split, no vertical order, only each card's side.

**The Lens open at its pin is the factory deck.** A launch that finds no persisted layout at all builds the default one with the Lens already standing at `DEFAULT_LENS_SIDE` (right) and nothing else on the canvas — so the first deck a user ever meets, the one setup hands them, has the Lens on it. Only a genuinely absent layout takes that path: a deck the user has emptied is a layout that says empty, and it is left as they left it.

**A pinned Lens is still draggable, and dragging it by the title bar is the only way off the pin.** The commit carries the same `evictSlot` an imposed pane's drag carries — one gesture, one rule: a manual move releases a Pane from whatever was deriving its geometry. Off the pin the Lens is an ordinary free Pane (eight handles, snap, tiling) and the arrangement spans the whole canvas, exactly as it does when the Lens is closed. Any choice in the Lens **Layout** section pins it back, as does closing and reopening it. Widening it by its deck-facing edge does **not** unpin it — that gesture commits width alone, and the arrangement keeps laying out against the moving edge live.

**Imposed is a slot.** The deck's `imposition.kind` (`"one-up"` through `"six-up"`) defines numbered slots across the span — the canvas minus each side's rail width and one gap. A slot is an anchor at a fixed fraction of the band: a Pane of width *w* in slot *k* of *N* sits `k / (N − 1) × max(0, band − w)` from the band's left edge. Slot 0 hugs that edge, the last slot hugs the band's right, and the ones between space evenly. **Numbering always runs left to right** — slot 1 is the leftmost position on the deck, whatever side the Lens holds. The Lens's side moves the band's edges, never the numbering; a number that meant "left" on one deck and "right" on another would be a number you had to think about before you could use it. It also keeps the pin's *shape* the same on both decks, which is what a Lens flip has to interpolate.

The property that rule exists for: **a Pane's place depends on its own width and nothing else's.** No slotted Pane can see another, so closing, opening, widening, or restacking any card leaves every other card exactly where it was. A slot is a place in the arrangement, never a place in a queue. Slack therefore spreads evenly between cards rather than pooling in one margin; an arrangement that holds still is worth more than one whose margins collect in one place.

**The imposer never touches a Pane's width**: a slot is a position anchor, not a rect, so widths stay the user's and overlap is ordinary geometry rather than a case to handle. Any number of Panes may hold the same slot — a slot is a vertical stack whose top Pane is visible, and the Lens list is one switching surface.

**Width is chosen, not derived.** A content Pane's width comes from the user through one of four doors — a resize handle, the title-bar width popup, the ⌃⌘1/2/3 chords and their Window-menu twins ([D130]), or the deck-wide **Card Width** default — and every one but the drag writes it through the same `movePane` a drag uses, held between the Pane's stack floor and ceiling and stamped as `widthPreset` so a picker can show which named width it is at ([D128]). A manual resize clears the stamp: a settled control shows what the geometry holds, never what it was last told. The imposer sees none of this; it places whatever width it finds.

**The other switching surface is local, and lives in the title bar.** A Pane whose slot holds more than one renders a **stack badge** — a layers glyph and the slot's depth — at the head of its title-bar controls, so the deck admits at rest that something stands behind the card in front. Clicking it opens the **stack picker**, a menu whose rows are miniatures of the title bars they stand for — each Pane's own icon and its own title-bar text, topmost-first, with the front one check-marked — and the badge stays **lit** for as long as the menu is down, the way a macOS menu-bar title holds its highlight; **Cmd-clicking the title bar** opens the same picker without raising the Pane clicked (the meta modifier's existing "interact with a background window without raising it" reading, inherited rather than carved out); and **⌘R** opens it for the focused Pane and closes it again on a second press. **The stack's no-look motion is the depth pair** ([D129]): `Window ▸ Next Card in Stack` (⌥⌘]) brings the Pane buried longest straight to the front and puts nothing on screen at all, which is what lets the press be repeated without looking, and `Window ▸ Previous Card in Stack` (⌥⌘[) is its exact inverse — the front Pane goes all the way to the back (`sendPaneBehind`) and the one beneath it fronts. NEXT raises the **bottom-most** Pane rather than the one below the front, and that is the whole of why it is a ring: each raise sends the outgoing front Pane exactly one place back, so a depth-N slot is home again after N presses and the user can count instead of look. Raising the next-one-down instead would ping-pong between the top two forever and never reach the third, because each raise rewrites the order the "next" was computed from — which is also why PREVIOUS must be a true rotation rather than a raise of the second-from-top. It is also what ⌘-backtick does with windows. All three items gate identically (depth > 1); they are menu items and not keybinding-map entries because AppKit resolves key equivalents before the web view sees a keydown. Choosing a row raises that Pane through the same `transferFocusForActivation` a Lens row click or a ⌘N assignment takes: one gesture vocabulary, three doors. The badge shows on **every** Pane in the stack, not just the top one, because it describes the *slot* and Panes in one slot may differ in width — a peeking buried Pane's title bar would otherwise be the one that lied about where it stands; a fully covered Pane is `visibility: hidden` anyway, badge included, so a same-width stack shows exactly one. **A Pane's name is one string produced in one place.** It is not any stored field: it composes the active card's registry title, the group name a multi-tab Pane carries, and the live override a card publishes on `cardTitleStore` once its identity resolves — which is why a Session card bound to a project is called `test-repo/petit-thaw` and not `Dev`. **The override replaces the registry title; it does not extend it.** A card publishes an override exactly when it has a name of its own, and that name says everything the type name said and more — `changes-rework.md` is evidently a file, and the row draws the card's document icon beside it besides — so `File : changes-rework.md` spent its first word on nothing. The registry title is the FALLBACK, what a Text card with no file open is called, not a category stamped on every name. A group name still prefixes, because it is redundant with nothing: it is the name the user gave a multi-tab Pane and no other part of the title bar carries it. That composition lives in `lib/pane-title.ts` (`composePaneTitleBarText` for the rule, `paneTitleBarTextFor` for callers holding deck state) and every surface that names a Pane goes through it: the title bar, the stack picker, and the Window menu's Pane list. A surface naming a **card** rather than a Pane takes `cardTitleTextFor` from the same module — the tab strip, which is per-tab and must not resolve the Pane's *active* card, and which carries no group name because the group prefixes the Pane once rather than once per tab. There is deliberately no card-type gate on it: the tab strip used to consult the override only for text cards, which is why a stacked Session card's tab read the literal word "Session" while its own title bar read `tugtool/stocky-pixie`. It is written down because the alternative already happened — a second, simpler rule over `CardState.title` lived in the menu-state projection, and it named a bound Session card `Untitled` in every list while its title bar named it properly. A surface that resolves the name itself will drift from the title bar the moment a card's identity becomes dynamic.

The stack is **derived**, never stored (`slotStackOf` over `DeckState.panes`), and the picker is built from that store data rather than from revealed DOM, so it needs nothing from the occlusion controller and works the same whether the Panes behind are hidden, peeking, or offscreen. Cmd-**drag** still drags, because the Cmd decision is resolved at the gesture's ending — in the drag machine's own no-travel branch — and a drag that travels never reaches it. See [D123].

#### Bullseye is a presentation over a mode, not a fourth mode

The three modes above stay mutually exclusive. **Bullseye** ([D131]) is not a fourth one: it is a temporary presentation that **supersedes** whichever mode a Pane holds, for as long as that Pane holds the first responder. Reached by ⌃⌘B or Window ▸ Bullseye, it paints the frame as a **one-up placement at comfy** — `imposeStyle({ slot: 0, count: 1 }, comfyWidth, pinnedFrame)`, which is the imposer's existing definition of centred-in-the-band rather than new centring math — over the full vertical run, with every other Pane receded. A rail can never hold it.

**It writes no geometry, so leaving it restores nothing.** Entering, holding, and leaving never call `movePane`, `centerPane`, or `setPaneWidth`: the only state change is `bullseyePaneId`, which is session-only and absent from `serialize()`, so a reload always comes back un-bullseyed. A bullseyed Pane's stored `position` / `size` / `slot` / `widthPreset` are last-known values in exactly the sense a pinned or imposed Pane's already are — and the width popup and Window ▸ Slim/Comfy/Wide keep showing the width the **store** holds, which is the width the frame returns to. Not writing four fields is strictly stronger than restoring them correctly.

**Four doors leave it, in two shapes.** Any path that writes a Pane's `position`, `size`, or `slot` releases *that* Pane — one helper, `_clearBullseyeFor`, honored by `movePane`, `setContentWidth`, and `assignCardToSlot`; the rule is stated over the mutation rather than over the caller, which is the same rule that already evicts a derived Pane on a manual gesture. And any move of the first responder out of the Pane ends it, cleared once from `_flipFirstResponder`, the single entry point for first-responder transitions — so the click, the ⌘R picker, both rings, the sidebar chords, and the canvas-background deselect are all covered, along with every focus path added later. A tab switch *inside* the bullseyed Pane keeps the posture: the question is whether the Pane hosts the responder, not which of its cards does. `bullseyePaneIdOf` derives on top of both, so a stale id is unreadable in the window before a flip commits.

**Every other content Pane leaves the canvas while bullseye holds**, sliding off the canvas and back on exit — a Pane that is merely dimmed is still one you can read. The displacement is one `left` override at render, so it writes nothing and returns to the pixel. **Which side it leaves by is read against the bullseyed card, not against the canvas**: Panes left of it go left, Panes right of it go right, so no Pane ever crosses the card arriving at the middle and relative order holds throughout the move. Both centres come from RESOLVED pins, never from stored `position.x`, which for a derived Pane is the superseded last-known value and would send every card in an imposition out the same side; the comparison is a CSS clamp rather than a measurement. It rides the existing FLIP settle out and back — **both clamp bounds park the Pane just past the canvas edge rather than a whole canvas beyond it**, because the settle's spring spends most of its distance early and a Pane sent that far is gone before the eye can follow it. The motion is what says "moved aside" rather than "closed". **Rails are excluded**: a rail that left would take the band's insets with it and the bullseyed card would jump the moment the posture began, so rails keep their pins and recede in place.

**The recede is the existing inactive-content dim at much deeper values**, on the two `.tug-pane-chrome` pseudo layers under a `data-bullseye` hook — never `.tug-pane-scrim`, which is the pane-modal layer and blocks pointer events. Deep is load-bearing: the inactive dim it builds on moves the card surface roughly 4%, so a small multiple of it reads as no change at all. Bullseye must stay non-modal, because clicking another Pane is one of its exit doors. Nothing may add `filter`, `transform`, `backdrop-filter`, `contain`, or `will-change` to `.tug-pane` for it: each makes every receded frame a containing block for its `position: fixed` descendants, and `TugSheet` portals into the frame while completion popups and banners position from viewport coordinates.

**If a title-bar bullseye control is ever added**, it should introduce a pane-addressed `set-bullseye` taking `{ paneId }` and have `toggle-bullseye` dispatch to it — the shape `set-pane-width` → `set-card-width` already has. The single action shipped today is correct only because both of its doors mean *the Pane I am in*.

Both derived modes resolve at render, in CSS, from custom properties (`--tug-imposer-inset-left` / `--tug-imposer-inset-right` for the span) rather than from a measured-and-committed rect. The deck installs no resize observation of any kind: the browser reflows derived Panes on a window resize or a Lens drag for free ([L06]). A derived Pane's stored `position`/`size` therefore hold last-known values, refreshed when the Pane leaves the mode; anything needing the truth measures the frame.

**Every horizontal pin is emitted as `left`**, measured from the left inset, in one shape on every deck. A frame positioned by one property in one form can *transition* between two arrangements; one that switched to `right`, or to a bare length where the other side had a percentage, could only cut. That is what lets a change to the `imposition` record settle rather than teleport: `DeckCanvas` marks the frames' container with `data-imposer-settling` for `IMPOSITION_SETTLE_MS` and every derived frame crosses to its new place.

**The pinned Lens crosses by a number, not by a pin.** Its two anchors are a bare length on the left and a percentage on the right, which are not the same kind of value and so have nothing to interpolate — and a `0%` added to the left one is simplified straight back out at computed-value time. So the side is carried as a registered `<number>` custom property, `--tugx-lens-rail` (0 left, 1 right), and the pin is one expression that mixes the anchors by it. Animating the number re-resolves the pin on every frame. Two consequences worth holding on to: `left` must be **absent** from the Lens frame's transition list, or the two drivers fight over one property; and the rail's own transition is declared **ungated**, because WebKit will not start a transition on a registered custom property whose covering `transition-property` arrives in the same style change as the value — and nothing but a re-imposition ever writes the rail, so there is nothing to gate it against.

**The settle is armed from the store, not from a render.** WebKit will not start a transition on a property whose covering `transition-property` arrives in the same style change as the value — so arming `data-imposer-settling` in a layout effect, which runs after React has already written the new `left`, puts both in one change and the frame cuts. `DeckCanvas` subscribes to the deck store directly: the subscriber runs before the re-render it causes, sets the attribute, and flushes it as a style change of its own (reading the resolved duration back), so the geometry arrives into a transition already in force. This is not a nicety — before it, a slot chosen with the pointer animated and the same slot chosen with the keyboard cut, because a pointer-down happens to activate a pane and armed the settle one style change early by accident.

**Motion curves are functions, not Bézier literals.** `lib/unit-functions.ts` holds the catalogue — a port of UpKit's `UPUnitFunction`, plus a critically damped spring — and `cssEasing` samples any of them into a CSS `linear()`. The settle names its curve once, as `IMPOSITION_SETTLE_EASING`; `DeckCanvas` writes it and the duration onto the frames' container as `--tugx-imposer-settle-easing` / `--tugx-imposer-settle-duration`, so a curve is swapped at its definition and tuned live by overriding the property.

**A gesture commits only once the pointer has travelled.** Under `DRAG_MOVE_THRESHOLD_PX` a title-bar press is a click: it focuses the Pane and commits nothing, and a derived Pane keeps the slot or the pin it started with. The conversion to free pixel geometry happens at the threshold crossing, not at pointer-down — so releasing the Lens from its pin takes an actual drag, which is the only gesture that means it.

#### Chrome has two heights, and the taller one is a masthead

A Pane's title bar is normally one 36px tier. A card whose identity is worth three lines can ask for a **72px masthead** instead ([D132]), and today exactly one does: the Session card, whose masthead carries `project/callsign` with the Pane controls, the session's description, the PULSE line, and a trailing telemetry popover.

**The height is fixed and ratified, never content-driven.** The masthead never reflows; overflow truncates. Chrome that changed height as its text changed would move every card in the Pane while the user was reading.

**The Pane owns the slot; the card's own family owns what is inside it.** `TugPane` opens the taller tier and sizes it, then mounts a tugways `SessionMasthead` into it, keyed by session id. That split is the point: chrome stays the Pane's ([L09]) without the PULSE feeder, the dwell queue, the compaction pin, the sparkline series and the telemetry popover moving into chrome code. The precedent is the Session card already rendering `TugPaneBanner` — Pane-class furniture, card-class content inside it.

**Which card the Pane asks is the ACTIVE one.** A card publishes a masthead sidecar beside its `cardTitleStore` string, and the Pane wears the masthead exactly when its frontmost tab publishes one — so the chrome swaps 36↔72 on tab switch and the content region reflows with it. A pinned 72px chrome over a Text tab would caption one card with another card's identity. A stacked Session card contributes nothing to the chrome; its identity still reads on its tab and in the stack picker.

**The height travels as a Pane-scoped custom property, `--tugx-pane-chrome-height`** — `--tug-masthead-height` when the masthead is up, `--tug-chrome-height` otherwise — and only the sites that are really measuring *the title-bar tier* follow it: the bar itself, the Pane scrim's top, the sheet clip's top, and the Pane banner's top. The tab bar's own metrics stay on `--tug-chrome-height`, because **the masthead and the tab bar stack rather than merge**: a multi-tab Session Pane's chrome is 72 + 36, masthead on top, an ordinary 36px tab row beneath it. Re-pointing a tab metric at the Pane property would give a masthead Pane 72px-tall tabs. The sheet needs only its clip's top re-pointed; the panel's in-pane height falls out of the measured clip rect for free, and the standalone `max-height` fallback must stay on the global token because a Pane-scoped property is undefined where there is no Pane.

The swap is safe against [L26] for a structural reason worth stating rather than relying on: `CardTitleBar` and `.tug-pane-body` are **siblings**, and `.tug-pane-content` is an empty `ref`'d div that cards portal into. A chrome-mode branch therefore has no card subtree to re-key or reparent, so the tab switch cannot cost the content region its mount identity. Keep that discipline — the chrome slot stays a sibling, nothing in the content region's key derives from chrome mode, and the height travels as a custom property ([L06]) — and keep the scroll-survival assertion that pins it.

### Card

The content identity. A Card has a stable id, a `componentId` that names its content type, a `title`, a `closable` flag, and an optional `state` bag carrying per-content persistence (scroll, selection, content-specific payload). Cards are the durable identity that survives cross-Pane moves — detach, merge, reorder all preserve a Card's id and its React-tree identity (because `CardHost` portals into the host Pane's DOM; it is never remounted).

| Owner | Responsibility |
|-------|---------------|
| `CardHost` (component) | Wraps the registered content factory with the four per-content contexts (`CardDataProvider`, `CardPropertyContext`, `CardPersistenceContext`, `CardDirtyContext`) + the responder scope keyed by `cardId` |
| `CardState` (type) | `{ id, componentId, title, closable, state? }` |
| `CardStateBag` (type) | `{ scroll?, selection?, content? }` — the per-content persistence payload |
| Card content component | The body registered via `registerCard(componentId, { contentFactory, defaultMeta, ... })` |

**A Card is not a responder for Pane state.** Actions like `close` that target the Pane walk up past the Card's own responder scope and are handled by the Pane or by DeckManager. A Card *is* a responder for content actions its body implements (`cut`, `copy`, `paste`, `selectAll`, `undo`, `redo`, and any custom actions).

---

## Tabs Are Not a Data Concept

**A tab is a UI affordance that appears on a Pane when that Pane's `cardIds.length > 1`.** `TugTabBar` is presentational: it renders one tab per `cardId`, dispatches `selectTab` and `closeTab` actions, and disappears when the Pane has only one card. There is no "Tab" type, no `TabState`, no `tabId`. The identity the tab strip surfaces is the underlying Card's `id`.

This is why the vocabulary sweep that produced this document removed every `tabId` parameter name in favor of `cardId`: there is no tab identity separate from a card identity.

| Pane's card count | Tab strip |
|---|---|
| 1 | Hidden |
| 2+ | Rendered; one tab per `cardId`; the Pane's `activeCardId` shows as selected |

---

## Naming Rules

Each layer of the system uses a distinct prefix so a reader can identify what a name refers to from its prefix alone.

### Components

| Prefix | Meaning | Examples |
|--------|---------|----------|
| `TugPane*` | Components that render Pane-level chrome | `TugPane`, `TugPaneBanner`, `TugTabBar` |
| `Card*` | Types and hooks for the Card content model (no `Tug` prefix) | `CardState`, `CardStateBag`, `CardHost`, `CardMeta`, `CardLifecycle`, `CardRegistration` |
| `useCard*` | Hooks consumed inside Card content | `useCardData`, `useCardPersistence`, `useCardDirty` |

The `Tug` prefix marks components (things that render JSX). Card-model *types and hooks* drop the prefix — they describe content identity, not chrome.

### Data attributes

| Attribute | Where | Purpose |
|-----------|-------|---------|
| `data-pane-id` | On the Pane frame (`TugPane` root) | Identifies the Pane for drag / resize / activation |
| `data-card-id` | On the `CardHost` wrapper | Identifies the Card for responder routing, lifecycle observers, and save callbacks |
| `data-card-host` | Alongside `data-card-id` on the same element | Marks the element as a `CardHost` (for selection-boundary traversal) |

### CSS custom properties

| Prefix | Meaning |
|--------|---------|
| `--tugx-pane-*` | Pane chrome aliases — frame, title bar, controls, content-dim, accessory, findbar, banner |
| `--tugx-card-*` | **Reserved** for Card-content aliases. None exist today; the prefix is preserved for future tokens that style Card content (not chrome) |
| `--tug7-*` | Seven-slot theme primitives. Untouched by the Deck → Pane → Card vocabulary |

### CSS class names

Class selectors on Pane chrome use the `.tug-pane-*` prefix, matching the component name and the `--tugx-pane-*` token family: `.tug-pane-chrome`, `.tug-pane-title-bar`, `.tug-pane-title`, `.tug-pane-icon`, `.tug-pane-accessory`, `.tug-pane-body`, `.tug-pane-loading`, `.tug-pane-title-bar-controls`.

---

## Wire Contract

The Deck → Pane → Card vocabulary flows through every serialization surface without translation.

### v4 layout blob (tugbank `dev.tugtool.deck.layout`)

```jsonc
{
  "version": 4,
  "cards": [
    { "id": "card-abc", "componentId": "hello", "title": "Hello", "closable": true }
  ],
  "panes": [
    {
      "id": "pane-xyz",
      "position": { "x": 100, "y": 100 },
      "size":     { "width": 400, "height": 300 },
      "cardIds":       ["card-abc"],
      "activeCardId":  "card-abc",
      "title":         "",
      "acceptsFamilies": ["standard"],
      "slot": 1
    }
  ],
  "activePaneId": "pane-xyz",
  "imposition": "three-up"
}
```

`imposition` is a `{ kind?, contentWidth?, sidebars }` record on the deck; `slot` and `widthPreset` are additive-optional on the Pane. An absent `kind` means "no imposition / Pane not imposed", which is exactly the pre-imposer semantics. The value has widened twice without a version bump — first from a bare kind string to the record, then from `{ lens, lensPinned }` to the `sidebars` map — because both times both shapes parsed: a legacy pair reads as `sidebars.lens`, an absent `contentWidth` reads as comfy (which is the width every content card shipped at, so the migration is behavior-preserving), and a Pane's retired `anchor` edge is still read on load — once — to recover the side a pre-record blob left the Lens on. Retired fields are dropped on read rather than honored: a `collapsed` Pane comes back expanded, and a blob from the build whose rails divided vertically loses its `sidebarSplit` and its per-card `order` — reading those back would reinstate a geometry this build cannot paint. A sidebar entry is therefore rebuilt field by field rather than spread, so a blob cannot smuggle a field the code no longer knows about into the record. The rest of the read path is defensive in the same spirit: an unrecognized kind drops the arrangement and every `slot` with it; a `slot` needs a valid kind, a non-negative integer, and a Pane hosting no sidebar card; an out-of-range slot clamps to the kind's last slot. A Pane with a surviving `slot`, and a sidebar Pane, both skip the canvas-fit clamp — their geometry derives at render.

Pre-v4 blobs used `windows` and `activeWindowId` and a different embedded-card shape. `serialization.ts` migrates on read; writes are always v4. The `focusedCardId` pointer for reload focus restoration is stored in a separate tugbank domain (`dev.tugtool.deck.focused`), not inside the layout blob.

### Per-card state (tugbank `dev.tugtool.deck.cardstate/{cardId}`)

One row per Card. The row key is the Card's id. The value is the `CardStateBag` — scroll position, saved selection, content payload.

### IPC actions (Swift ↔ deck)

| Action | Payload | Source | Purpose |
|--------|---------|--------|---------|
| `focus-pane` | `{ paneId }` | Swift menu → web | Activate a Pane by id; promotes its `activeCardId` as first responder |
| `add-card-to-active-pane` | none | Swift menu → web | Add a new card to the currently-active Pane |
| `close` | none | Swift menu → web | Dispatch through the responder chain; resolved by Pane or DeckManager (menu label "Close Card" or "Close Pane" depending on card count) |

### Swift menu vocabulary

`AppDelegate.swift` names menu items to match this model:

- **File ▸ Close Card / Close Pane** — dynamic label. When the active Pane holds more than one card, the label is "Close Card" (closes the active card only). When it holds exactly one, the label is "Close Pane" (closes the last card, removing the Pane).
- **Dev ▸ Add Card to Active Pane** — explicit Pane-scoped action.

A developer changing Swift menu strings must preserve this vocabulary: Card-level gestures say "Card"; Pane-level gestures say "Pane".

---

## The deck is placed, never scrolled

**Every Pane's title bar is on the Deck, and the Deck itself never moves.** A title bar above the Deck's top edge cannot be grabbed, and since nothing in the Deck scrolls there is no gesture that brings it back: the Pane is stranded and the user is stuck with a Card they cannot address. The rule is therefore enforced, not merely intended, and at three independent layers — because the incident that produced it (2026-07-28: one ⌥⌘↑ parked every card's title bar above the window top) came from a layer nobody was watching.

| Layer | The law | Where it lives |
|---|---|---|
| Geometry | No Pane commits with `position.y` above the Deck top | `DeckState` invariant 7 + `clampPanesToDeck`, applied in `DeckManager.notify` — the one commit point every mutation passes through, so restore-from-disk and detach are covered along with drag |
| Structure | The page is not a scroller | `overflow: clip` on the Deck root (`deck-canvas.tsx`) |
| Behavior | A scroller scrolls itself and no ancestor | `SmartScroll.scrollToElement` computes its own delta; `revealFocusTarget` walks scrollports minimally |

The structural layer is the subtle one and worth stating plainly. **The canvas does not scroll — but the page underneath it can.** A Pane parked so its frame reaches past a window edge overflows the Deck root; because `#deck-container` is unpositioned, that overflow resolves against the viewport and lands in `<body>`'s scroll box, which `globals.css` renders invisible (`overflow: hidden`) but leaves perfectly scrollable from script. Anything that walks ancestor scrollports — a stray `scrollIntoView`, a browser focus reveal — can then scroll the *page*, which slides the whole Deck under the window with no scrollbar, no wheel target, and nothing to put it back. `clip` rather than `hidden` is what closes it: it clips at the same box but forms no scroll container, so the range never exists to be spent.

Imposed Panes get the rule twice over, as they should — Tug places them itself. Their frame is derived, pinned a gap below the canvas top in CSS (`imposeStyle`), so the geometry law holds for them by construction rather than by clamp; the structural and behavioral layers protect them exactly as they protect free Panes. Pinned by `at0283-page-not-a-scroller` and `at0284-title-bar-floor`.

---

## Pane-modal vs canvas-overlay surfaces

**A surface that claims pane-modal semantics — "this surface blocks interaction with this pane" — is scoped to the host Pane's stacking context, not to the canvas-overlay tier.** The Pane's outer frame element (`.tug-pane`, exposed via `TugPaneFrameContext` from `tug-pane.tsx`) is its own stacking context: position-absolute with an inline z-index assigned by the deck. Anything portaled into that frame paints inside the Pane's stacking context, so peer Panes z-stacked above paint above the modal panel automatically. Bleed across Panes is structurally impossible.

The visual scrim for pane-modal surfaces lives on the Pane: every Pane carries a built-in scrim layer inside its chrome (`.tug-pane-scrim`), default opacity 0. Modal-class consumers raise it via `useTugPaneScrim()`, a ref-counted hook so multiple consumers compose without fighting. The scrim's chrome containment (`.tug-pane-chrome` is its own stacking context via `isolation: isolate`) means the scrim never paints across pane boundaries either.

| Surface class | Portal target | Scope | Hook | Examples |
|---|---|---|---|---|
| Pane-modal | Pane frame (`TugPaneFrameContext`) | Host pane only | `useTugPaneScrim()` | `TugSheet`, future modal-class surfaces |
| Anchor-relative (transient) | Canvas overlay (`useCanvasOverlay`) | Anchored, may extend past pane | (no scrim) | popovers, tooltips, completion lists |
| App-modal | Canvas overlay (`useCanvasOverlay`) | Whole canvas | (canvas scrim) | `TugAlert` |

The distinction is **the relationship to the host Pane**:

- *"Scoped"* (pane-modal) — the surface blocks interaction with one Pane, paints with the Pane's stacking, moves with the Pane. Portal into the frame.
- *"Anchored"* (transient) — the surface points at a control inside a Pane but may need to extend past the Pane's edges (a popover at the Pane's right edge is allowed to paint over the canvas grid beyond). Portal into canvas overlay.
- *"Whole canvas"* (app-modal) — the surface blocks all interaction across all Panes and the canvas. Portal into canvas overlay.

Modal scope is the Pane stacking context, not the canvas-overlay tier — picking canvas-overlay for a surface that is supposed to be modal-to-one-Pane sets up an entire class of bleed bugs that no amount of measurement-based confinement can fully fix. See [tugplan-tide-picker-redesign §D20 and Step 9.6](../roadmap/tugplan-tide-picker-redesign.md#step-9-6) for the architectural narrative this section formalizes.

---

## Relationship to Other Laws

| Law | Relationship |
|-----|--------------|
| [L09] TugPane composes chrome and owns geometry; Cards never set their own position, size, or z-order | The Pane / Card responsibility split described here. Panes own geometry and chrome; Cards supply content identity |
| [L10] One responsibility per layer | The Pane Model *is* this law applied to the canvas: DeckManager owns the tree, DeckCanvas maps state to Panes, TugPane owns the frame, CardHost owns the content bridge, Card content owns domain logic |
| [L11] Controls emit actions; responders own state | Pane is the responder for Pane-state actions (`close`, `find`, `toggleMenu`). Card is the responder for content-state actions its body implements |
| [L12] Selection stays inside card boundaries | The "card boundary" is the `CardHost` content region — `data-card-id` marks it, `SelectionGuard` clamps at its edges |
| [L23] Internal bookkeeping preserves user-visible state | Cross-Pane moves (detach, merge, reorder) must preserve scroll, selection, focus, and content. This is why `CardHost` portals into the Pane's DOM rather than remounting — React-tree identity is the preservation mechanism |

---

## Files

| File | Role |
|------|------|
| `tugdeck/src/layout-tree.ts` | `DeckState`, `TugPaneState`, `CardState`, `CardStateBag`, `validateDeckState` |
| `tugdeck/src/deck-manager.ts` | Mutation API over `DeckState` — the canonical responder target for layout actions |
| `tugdeck/src/deck-canvas.tsx` | Renders `panes` to `<TugPane>` instances; promotes active-card on mount |
| `tugdeck/src/components/chrome/tug-pane.tsx` | `TugPane` component: frame, chrome, drag, resize, title bar, width popup |
| `tugdeck/src/components/chrome/card-host.tsx` | `CardHost` component: content-factory wrapper + per-card context bridge |
| `tugdeck/src/components/tugways/tug-pane-banner.tsx` | Pane-scoped modal banner (error/status variants) |
| `tugdeck/src/components/tugways/tug-tab-bar.tsx` | Presentational tab strip for multi-card Panes |
| `tugdeck/src/components/tugways/hooks/use-card-data.ts` | `useCardData`, `CardDataProvider`, `CardDataContext` |
| `tugdeck/src/components/tugways/use-card-state-preservation.tsx` | `useCardStatePreservation`, `CardStatePreservationContext`, `CardStatePreservationCallbacks` |
| `tugdeck/src/card-registry.ts` | `registerCard`, `CardMeta`, `CardRegistration` |
| `tugdeck/src/serialization.ts` | v4 ⇄ v3 migration on read; v4 only on write |
| `tugdeck/src/lib/layout-imposer.ts` | Pure imposition geometry: `ImpositionKind`, `slotCount`, `clampSlot`, `slotFraction`, `resolveSpan`, `imposeRect`, `imposeStyle` |
| `tugdeck/src/components/lens/sections/layouts-section.tsx` | The Lens **Layout** section — the arrangement, the deck's content width, and each sidebar's side |
| `tugdeck/src/components/lens/slot-picker.tsx` | `SlotPicker` — the numbered slot buttons on a Lens list row |
| `tugdeck/src/components/tugways/action-vocabulary.ts` | `FOCUS_PANE`, `ADD_CARD_TO_ACTIVE_PANE`, `CLOSE`, ... |
| `tugapp/Sources/AppDelegate.swift` | Swift menu definitions and IPC senders |
| `tugdeck/src/components/tugways/tug-pane.css` | `--tugx-pane-*` token aliases + chrome CSS |
| `tugdeck/src/components/tugways/tug-pane-banner.css` | `--tugx-pane-banner-*` token aliases |
| `tugdeck/src/lib/pane-scrim-registry.ts` | Per-pane-chrome ref-counted scrim toggle (the `data-scrim` attribute) |
| `tugdeck/src/deck-store-selectors.ts` | `bullseyePaneIdOf` — the bullseye derivation, beside `findSidebarPanes` / `slotStackOf` |
| `tests/app-test/at0372-bullseye.test.ts` | Bullseye end to end: entry, the no-write claim, every exit door, rail inertness |
| `tugdeck/src/components/tugways/use-tug-pane-scrim.ts` | `useTugPaneScrim()` hook — pane-modal surfaces request the chrome's built-in scrim layer here |

---

## Cross-Links

- [tuglaws.md](tuglaws.md) — L09 (Pane composes chrome and owns geometry), L10 (layered responsibility), L11 (controls/responders), L12 (selection boundary), L23 (state preservation across bookkeeping)
- [card-state-model.md](card-state-model.md) — the Card boundary referenced throughout
- [state-preservation.md](state-preservation.md) — the [A9] component-state preservation protocol that L23-compliant card content rides; pane-scope keys (`tugbank` `storageKey`) are pane-side, component-scope keys (`data-tug-state-key`, `componentStatePreservationKey`) are card-side
- [lifecycle-delegates.md](lifecycle-delegates.md) — the deck-level `TugCardDelegate` event pipe (`cardWillMove`, `cardDidMove`, `cardWillResize`, `cardDidResize`, `cardWillActivate`, etc.) through which Pane geometry and activation events reach cards
- [responder-chain.md](responder-chain.md) — the chain-walk that makes Pane-state and Card-content actions route to the right layer
- [action-naming.md](action-naming.md) — Pane / Card naming in action vocabulary
- [design-decisions.md](design-decisions.md) — D15, D16, D17, D27, D30, D31, D49, D50, D51, D52, D121 (layout imposition), D131 (bullseye — a presentation over a mode)
