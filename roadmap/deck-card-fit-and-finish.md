# Deck & Card Fit and Finish

A collection of improvements to bring polish to the deck canvas, card chrome, and Tug.app host.

---

## 1. Startup Spinner with Tug Logo

**Problem:** While Tug.app launches and the web engine loads, the user sees an empty canvas with the correct background color but no activity indicator. The `frontendReady` gate (MainWindow.swift) keeps the WebView hidden until the deck is fully loaded, so this is purely dead time from the user's perspective.

**Approach:** Add a native SwiftUI or AppKit spinner view to MainWindow that displays the Tug logo with a rotation animation. This view sits in the window's content view *behind* the WebView and is visible from launch until `revealWebView()` fires.

**Details:**
- Add a `SpinnerView` (NSView subclass or SwiftUI hosting view) that renders the Tug logo asset with a continuous rotation animation (e.g., `CABasicAnimation` on `transform.rotation`).
- Insert `SpinnerView` into `MainWindow.contentView` at init, behind (lower z-order than) the WebView.
- In `revealWebView()`, after the WebView opacity animation completes, remove/hide the spinner and release its resources.
- The spinner inherits the window's background color, so theme continuity is maintained.
- Consider a subtle fade-out on the spinner concurrent with the WebView fade-in for a smooth handoff.

**Scope:** Swift only (`tugapp/Sources/MainWindow.swift`, new `SpinnerView.swift`). No tugdeck changes.

---

## 2. Card Min/Max/Preferred Sizes

**Problem:** Card sizing is currently governed by a single hardcoded default (400x300) in DeckManager and a per-card minimum (150x100 frame, 100x60 content) reported via `onMinSizeChange`. There is no concept of maximum size or preferred size, and no API for card content to declare its own sizing preferences.

**Approach:** Introduce a `CardSizePolicy` structure that each card type can declare, and wire it through DeckManager and CardFrame for enforcement.

**Details:**

### Data model
```ts
interface CardSizePolicy {
  min:       { width: number; height: number };  // hard floor for resize
  max?:      { width: number; height: number };  // hard ceiling for resize (null = unbounded)
  preferred: { width: number; height: number };  // size for new cards with no saved state
}
```

### Declaration
- Each card component (Tide, Git, Settings, Gallery, Hello) exports a static `sizePolicy` on its factory or registration entry in the card registry.
- Sensible defaults: `min: 250x180`, `max: null`, `preferred: 400x300` (matching current behavior). Individual card types override as needed (e.g., Settings card might have a smaller preferred and a max).

### Enforcement
- **DeckManager.addCard():** When creating a new card with no persisted size, use `sizePolicy.preferred` instead of the current `DEFAULT_CARD_WIDTH/HEIGHT` constants.
- **CardFrame resize clamping:** Currently clamps to `minSizeRef.current`. Extend to also clamp to `max` (when present) on both width and height.
- **Canvas clamping:** If `max` is set, ensure the card never exceeds it even when the canvas resizes.

### API
- `DeckManager.getCardSizePolicy(cardId)` — returns the resolved policy for a card.
- `DeckManager.setCardSize(cardId, { width, height })` — sets size, clamping to policy bounds. Usable from control-frame actions or from card content.
- These are also exposed to card content via the existing card bridge/context so that a card's own UI can trigger resize-to-preferred or resize-to-fit.

**Scope:** tugdeck (`deck-manager.ts`, `card-frame.tsx`, card registry, individual card components).

---

## 3. Relaxed Card Placement (Finder-Style Window Constraining)

**Problem:** Cards are currently hard-clamped to the canvas bounds with a 2px padding (`CANVAS_PADDING`). A card cannot be dragged to overhang any edge. This feels rigid compared to macOS Finder, where windows can extend partially off-screen but the title bar always remains accessible.

**Approach:** Adopt Finder-style constraining rules: a card may extend off any edge of the canvas, but enough of its title bar must remain visible and grabbable.

**Research notes — macOS Finder rules:**
- **Top edge:** The title bar cannot move above the menu bar. In our case, the top of the deck canvas is the equivalent boundary — the card's title bar top must remain at or below `y = 0` (canvas top).
- **Bottom edge:** A minimum grabbable strip of the title bar (~title bar height) must remain visible. The card body can extend below the canvas.
- **Left/right edges:** A minimum horizontal strip (~80-100px) of the title bar must remain visible. The card can otherwise hang off either side.
- **No minimum visible area for the card body** — only the title bar matters for recoverability.

**Details:**
- Replace the current `CANVAS_PADDING`-based clamp in `clampedPosition()` (card-frame.tsx) with Finder-style rules:
  ```
  const TITLE_BAR_VISIBLE_MIN_X = 100;  // px of title bar visible horizontally
  const TITLE_BAR_VISIBLE_MIN_Y = CARD_TITLE_BAR_HEIGHT;  // full title bar height visible vertically
  
  // Clamp so title bar stays reachable:
  clampedX = clamp(x, -(cardWidth - TITLE_BAR_VISIBLE_MIN_X), canvasWidth - TITLE_BAR_VISIBLE_MIN_X);
  clampedY = clamp(y, 0, canvasHeight - TITLE_BAR_VISIBLE_MIN_Y);
  ```
- Same rules apply during resize: the card may grow beyond the canvas edge, but cannot resize such that its title bar leaves the reachable zone.
- The "Arrange" commands (see item 4) serve as the recovery mechanism for cards that get lost off-edge.

**Scope:** tugdeck (`card-frame.tsx` — `clampedPosition` and resize clamping logic).

---

## 4. View Menu

**Problem:** There is no View menu. Card arrangement commands don't exist. The "Show card" items are buried in the Developer menu where they serve double duty as both dev tools and potential user-facing features.

**Approach:** Add a View menu between Edit and Developer (menu position 3, pushing Developer to position 4). It contains card arrangement commands, a card list, and the dev-only show-card items.

**Details:**

### Menu structure
```
View
  ├── Cascade                     ⌃⌥C
  ├── Tile                        ⌃⌥T
  ├── ─────────────────────
  ├── [Card Title 1]              (checkmark if focused)
  ├── [Card Title 2]
  ├── [Card Title 3]
  ├── ─────────────────────       (dev-mode only, below)
  ├── Show Component Gallery      ⌘⌥G    (moved from Developer)
  ├── Show Hello World Card       ⌘⌥1    (moved from Developer)
  └── Show Git Card               ⌘⌥2    (moved from Developer)
```

### Arrangement commands
- **Cascade:** Reposition all visible cards in a diagonal cascade from top-left, each offset by `CASCADE_STEP` (30px). Respects card size policies. Brings all off-canvas cards back into view.
- **Tile:** Arrange all visible cards in a grid that fills the canvas. Compute rows/cols to approximate each card's preferred aspect ratio. Respects min sizes.
- Both commands dispatch a control-frame action (`arrange-cards`) with a `mode` param (`cascade` | `tile`). DeckManager handles the layout computation and commits the new positions.

### Card list
- Dynamically built from DeckManager's current card list.
- Each item shows the card's display title.
- Clicking an item focuses (brings to front) that card.
- A checkmark decorates the currently-focused card.
- Requires dynamic menu population: use `NSMenuDelegate` on the View menu to rebuild the card list section each time the menu opens. The card titles and focus state come from a JS bridge query (`evaluateJavaScript` to call a deck-manager accessor).

### Dev-mode items
- Move "Show Component Gallery", "Show Hello World Card", and "Show Git Card" from the Developer menu to the bottom of the View menu.
- These items are only visible when `devModeEnabled` is true (same gating as the current Developer menu).
- The Developer menu retains: Reload, Show JavaScript Console, Add Tab To Active Card, Source Tree.

### Action routing
- Cascade/Tile: Swift menu action -> `sendControl("arrange-cards", { mode: "cascade" })` -> DeckManager handles it.
- Card list focus: Swift menu action -> `sendControl("focus-card", { cardId: "..." })`.
- Show-card items: same mechanism as today, just moved to a different menu.

**Scope:** Swift (`AppDelegate.swift` menu setup), tugdeck (`deck-manager.ts` for arrange logic, `deck-canvas.ts` for action handling).

---

## 5. Bug Fix: Option-Key-Only Set Snapping

**Problem:** Cards sometimes snap together into a set purely due to proximity — if two cards happen to end up within `SNAP_THRESHOLD_PX` (8px) of each other, `findSharedEdges()` detects a shared edge and `computeSets()` groups them. On the next drag, the card moves as a set member even though the user never held Option to intentionally snap them.

The root cause: set membership is determined by geometric proximity alone (`findSharedEdges`), but it should only form when the user explicitly snapped cards together using the Option key.

**Approach:** Introduce explicit set membership tracking. Sets form only through intentional snap gestures (Option+drag landing within threshold), not from coincidental proximity.

**Details:**

### Explicit set membership
- Add a `sets` field to the persisted deck state in DeckManager: an array of `{ cardIds: string[] }` groups.
- Sets are created/modified only through snap gestures:
  - When a user completes an Option+drag and the card lands within snap threshold of another card (or set), commit a set membership change in DeckManager.
  - When a user breaks out of a set (Option during set-move), remove the card from the set in DeckManager.
- `findSharedEdges` and `computeSets` continue to be used for *visual* purposes during Option+drag (snap guides, edge detection), but they no longer determine behavioral set membership.

### Migration path
- `updateSetAppearance()` reads set membership from DeckManager instead of computing it geometrically from current positions.
- At drag-start, `dragSetMembers` is populated from DeckManager's explicit sets, not from `findSharedEdges` on current positions.
- `postActionSetUpdate()` updates DeckManager's set state based on the snap result, then calls `updateSetAppearance()`.

### Edge cases
- Cards manually moved apart after snapping: they remain in a set until explicitly broken out (Option+drag away). This matches the behavior of macOS window tabs — grouping is intentional and sticky.
- Closing a card that's in a set: remove it from the set. If the set drops to 1 member, dissolve the set.
- Card resize that breaks geometric adjacency: the set persists (it's explicit, not geometric). Visual appearance (clip-path, squared corners) updates to reflect the actual geometry — if cards drift apart, corners round again, but set-move behavior persists until explicit break-out.

**Scope:** tugdeck (`snap.ts`, `card-frame.tsx`, `deck-manager.ts`).

---

## 5.5. Set Snapping Hardening

Follow-up improvements to the option-key-only snapping implementation (5). The core design is correct; these items tighten the code, add missing test coverage, and reduce maintenance burden.

### 5.5a. Unit tests for set management methods

`_joinSet`, `_removeFromSet`, and `_getCardSet` have non-trivial logic — union-find merging, dissolution when fewer than 2 members remain, cleanup on card removal — and none of it is tested. The test updates for item 5 only added `sets: []` stubs to make existing tests compile.

Add tests in `deck-manager.test.ts` covering:
- Basic `joinSet` of two solo cards.
- `joinSet` that merges two existing sets (card bridges them).
- `joinSet` with cards already in the same set (idempotent).
- `removeFromSet` that leaves a set with 2+ members (set persists, reduced).
- `removeFromSet` that drops a set below 2 members (set dissolves).
- `getCardSet` for a member (returns full set including self) vs. non-member (returns `[]`).
- `removeCard` cleaning up set membership (card removed from set, set dissolved if < 2 remain).

### 5.5b. Make `store` required in `updateSetAppearance` and `postActionSetUpdate`

Both functions accept `store?` as optional. When omitted, they fall back to geometry-only set detection — the exact behavior we just fixed. Every real call site passes the store, so the fallback is dead code that preserves the old bug as a silent reintroduction path. Remove the optional marker: make `store: IDeckManagerStore` required. Delete the fallback branch.

### 5.5c. Extract shared-edge filtering helper

The same logic block — iterate `snapshot.sets`, filter rects to each set's members, call `findSharedEdges` per set, concat results — appears identically in `updateSetAppearance` and `postActionSetUpdate`. Extract into a helper:

```ts
function findSharedEdgesWithinExplicitSets(
  rects: { id: string; rect: Rect }[],
  store: IDeckManagerStore,
): SharedEdge[]
```

Both call sites reduce to a one-liner. A bug fix in one automatically applies to the other.

### 5.5d. Eliminate double `updateSetAppearance` on snap-drop

When `store.joinSet()` fires at drop time, `notify()` triggers the DeckCanvas store subscriber, which calls `updateSetAppearance`. Then `postActionSetUpdate` calls `updateSetAppearance` again. Two full DOM traversals with `querySelectorAll`, `getBoundingClientRect`, `findSharedEdges`, and z-index reordering on every snap-drop for no benefit.

Fix: either skip `updateSetAppearance` inside `postActionSetUpdate` when the caller already triggered it via a store mutation, or gate the DeckCanvas subscriber to skip during active gestures. The simplest approach is to have `postActionSetUpdate` be the sole `updateSetAppearance` caller on the drop path, since it runs after all store mutations are complete, and suppress the subscriber-driven call during gestures.

### 5.5e. Narrow snap-on-drop set formation to snapped-to cards only

Currently, after a snap-mode drop, `findSharedEdges` runs on ALL cards and joins every card sharing an edge with the dropped card into a set. If you snap card A to card B's right edge, but card A's bottom also happens to be within 8px of card C, the result is {A, B, C} — even though you only intentionally targeted B.

Fix: use the snap result to identify which specific card(s) the user snapped to, and only join those. `computeSnap` returns the guide positions and deltas but not the target card ID. Either extend `SnapResult` to include the target card ID for each axis, or post-filter the shared edges to only those on the axis/edge that was actually snapped.

### 5.5f. Enforce single-set invariant on deserialize

The data model (`string[][]`) doesn't structurally prevent a card from appearing in two sets. `joinSet` prevents this in practice, but a corrupted or hand-edited layout blob could violate it. Add a deduplication pass in `deserialize`: if a card ID appears in multiple sets, merge those sets. This is cheap defensive code that prevents silent behavioral inconsistency from `_getCardSet` returning only the first match.

**Scope:** tugdeck (`card-frame.tsx`, `deck-manager.ts`, `deck-manager.test.ts`, `snap.ts`, `serialization.ts`).

---

## Implementation Order

Suggested sequencing based on dependencies and risk:

1. **Option-key-only snapping (5)** — bug fix, highest user-facing impact, and the explicit-set-membership model is a prerequisite for reliable arrange commands. Done.
2. **Set snapping hardening (5.5)** — tests, cleanup, and tightening of the explicit-set implementation. Do this now while the code is fresh.
3. **Card size policies (2)** — foundational for arrange commands and for relaxed placement (need to know minimum sizes to enforce title-bar visibility).
4. **Relaxed placement (3)** — depends on size policies for safety; straightforward once those exist.
5. **View menu (4)** — depends on size policies (for tile/cascade) and explicit sets (for correct card list). Largest scope item.
6. **Startup spinner (1)** — fully independent, can be done at any point. Saved for last since it's cosmetic and low-risk.
