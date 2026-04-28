# Pane Model

*The canonical hierarchy for the tugdeck canvas: Deck → Pane → Card. This document formalizes what each concept is, what it owns, and the naming rules that encode it everywhere — code, CSS, DOM, wire format, and menus.*

---

## The Rule

**A Deck holds Panes; a Pane holds Cards; a Card holds one content component.** Position, size, z-order, drag, resize, and chrome are Pane responsibilities. Content identity — `componentId`, `title`, `state` — is a Card responsibility. Multi-card Panes surface a tab strip; a single-card Pane does not. Tabs are a UI affordance for switching among a Pane's Cards, not a separate data concept.

Everything else in this document explains how that rule manifests in code.

---

## Three Concepts

### Deck

The top-level canvas. Owns the layout tree: the set of all Panes, the ordered `cardIds` inside each Pane, and the currently-active Pane. A Deck is a flat state: `{ cards: Card[], panes: Pane[], activePaneId?: string }` — not a tree. Cards and Panes live in two flat arrays, and every card belongs to exactly one Pane's `cardIds` list.

| Owner | Responsibility |
|-------|---------------|
| `DeckManager` | Mutations on the layout tree, invariant validation, subscription surface (`useSyncExternalStore`) |
| `DeckCanvas` | Renders the Panes, promotes the active Pane's active Card as first responder on mount |
| `DeckState` (type) | `{ cards, panes, activePaneId? }` — the full shape of the tree |

**Deck invariants** (enforced by `validateDeckState`):
1. Every `pane.cardIds` entry references a real `state.cards[].id`.
2. Each card appears in exactly one pane's `cardIds` (no orphans, no duplicates).
3. No pane has `cardIds.length === 0` — closing the last card closes the Pane.
4. Every `pane.activeCardId` is a member of that Pane's `cardIds`.
5. `state.activePaneId`, when set, references a real Pane.

### Pane

The visual container. A rectangular frame on the canvas with chrome (title bar, optional tab bar, close/collapse controls) and a content region. Panes own **position**, **size**, **z-order** (implicit in array order within `deckState.panes`), **collapsed** state, **acceptsFamilies**, and the ordered `cardIds` list of the Cards they host.

| Owner | Responsibility |
|-------|---------------|
| `TugPane` (component) | Renders the frame; handles drag, resize, title bar, collapse, snap, tab bar |
| `TugPaneBanner` (component) | Renders the pane-scoped modal banner (error/status overlays) |
| `TugPaneState` (type) | `{ id, position, size, cardIds, activeCardId, title, acceptsFamilies, collapsed? }` |

A Pane is a **responder** (per [L11]) for actions on Pane state: `close`, `find`, `toggleMenu`. A Pane is **not** responsible for Card content — it delegates to the active Card's `CardHost`.

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

Class selectors on Pane chrome use the `.tug-pane-*` prefix, matching the component name and the `--tugx-pane-*` token family: `.tug-pane-chrome`, `.tug-pane-title-bar`, `.tug-pane-title`, `.tug-pane-icon`, `.tug-pane-accessory`, `.tug-pane-body`, `.tug-pane-loading`, `.tug-pane-title-bar-controls`, `.tug-pane-chrome--collapsed`.

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
      "acceptsFamilies": ["standard"]
    }
  ],
  "activePaneId": "pane-xyz"
}
```

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
| `tugdeck/src/components/chrome/tug-pane.tsx` | `TugPane` component: frame, chrome, drag, resize, title bar, collapse |
| `tugdeck/src/components/chrome/card-host.tsx` | `CardHost` component: content-factory wrapper + per-card context bridge |
| `tugdeck/src/components/tugways/tug-pane-banner.tsx` | Pane-scoped modal banner (error/status variants) |
| `tugdeck/src/components/tugways/tug-tab-bar.tsx` | Presentational tab strip for multi-card Panes |
| `tugdeck/src/components/tugways/hooks/use-card-data.ts` | `useCardData`, `CardDataProvider`, `CardDataContext` |
| `tugdeck/src/components/tugways/use-card-state-preservation.tsx` | `useCardStatePreservation`, `CardStatePreservationContext`, `CardStatePreservationCallbacks` |
| `tugdeck/src/card-registry.ts` | `registerCard`, `CardMeta`, `CardRegistration` |
| `tugdeck/src/serialization.ts` | v4 ⇄ v3 migration on read; v4 only on write |
| `tugdeck/src/components/tugways/action-vocabulary.ts` | `FOCUS_PANE`, `ADD_CARD_TO_ACTIVE_PANE`, `CLOSE`, ... |
| `tugapp/Sources/AppDelegate.swift` | Swift menu definitions and IPC senders |
| `tugdeck/src/components/tugways/tug-pane.css` | `--tugx-pane-*` token aliases + chrome CSS |
| `tugdeck/src/components/tugways/tug-pane-banner.css` | `--tugx-pane-banner-*` token aliases |

---

## Cross-Links

- [tuglaws.md](tuglaws.md) — L09 (Pane composes chrome and owns geometry), L10 (layered responsibility), L11 (controls/responders), L12 (selection boundary), L23 (state preservation across bookkeeping)
- [card-state-model.md](card-state-model.md) — the Card boundary referenced throughout
- [state-preservation.md](state-preservation.md) — the [A9] component-state preservation protocol that L23-compliant card content rides; pane-scope keys (`tugbank` `storageKey`) are pane-side, component-scope keys (`data-tug-state-key`, `componentStatePreservationKey`) are card-side
- [lifecycle-delegates.md](lifecycle-delegates.md) — the deck-level `TugCardDelegate` event pipe (`cardWillMove`, `cardDidMove`, `cardWillResize`, `cardDidResize`, `cardWillActivate`, etc.) through which Pane geometry and activation events reach cards
- [responder-chain.md](responder-chain.md) — the chain-walk that makes Pane-state and Card-content actions route to the right layer
- [action-naming.md](action-naming.md) — Pane / Card naming in action vocabulary
- [design-decisions.md](design-decisions.md) — D15, D16, D17, D27, D30, D31, D49, D50, D51, D52
