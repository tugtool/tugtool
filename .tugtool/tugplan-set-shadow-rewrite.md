<!-- tugplan-skeleton v2 -->

## Set Shadow Rewrite: Card-Intrinsic Box-Shadow with Clip-Path {#set-shadow-rewrite}

**Purpose:** Replace the separate `.set-shadow` DOM element system with per-card `box-shadow` + `clip-path: inset()` on `.tugcard`, eliminating shadow synchronization complexity during gestures and producing correct shadows at all times with zero time gaps.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways/set-shadow-rewrite |
| Last updated | 2026-03-05 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current set shadow system creates separate `.set-shadow` DOM elements with hull polygon `clip-path` + `filter:drop-shadow`, appended to the container by `updateSetAppearance()`. Every gesture (drag, resize, sash co-resize) requires manual shadow synchronization: the drag handler looks up the `.set-shadow` element by `data-set-card-ids`, stores it in `dragShadowEl`, translates it per-frame, and performs a defensive sweep at drag-start to remove stale shadows. A `gestureActive` flag gates the store subscriber from calling `updateSetAppearance` during gestures to avoid invalidating shadow refs. This complexity causes visual glitches (shadow gaps during break-out, orphaned shadows on rapid close-then-drag) and makes every new gesture type require shadow-aware code.

The new approach gives every card its own `box-shadow` (always the same `--td-card-shadow-active` value). For cards in a set, `clip-path: inset()` on the `.tugcard` element clips shadow on interior edges (sides touching a sibling) while letting shadow show on exterior edges. Shadow automatically moves, resizes, appears, and disappears with the card since it is part of the card's own box model.

#### Strategy {#strategy}

- Add `box-shadow: var(--td-card-shadow-active)` to all `.tugcard` elements unconditionally (remove the focused-only shadow on `.card-frame` and the `data-in-set` shadow suppression).
- Compute which sides of each card are interior vs exterior using `findSharedEdges` and apply `clip-path: inset()` on `.tugcard` with negative extension on exterior edges (to show shadow) and zero on interior edges (to clip shadow).
- Delete all `.set-shadow` DOM element creation/removal code, `dragShadowEl` tracking, the defensive drag-start sweep, `resizeShadowEl` snapshot, `isGestureActive`/`setGestureActive` flag system, and the store subscriber complexity that gates on gesture state.
- Simplify the store subscriber in DeckCanvas to unconditionally call `updateSetAppearance` (which now only sets `data-in-set` and `clip-path` on existing elements, no DOM creation/removal).
- Add per-frame `clip-path` updates in the sash co-resize RAF loop for both the resizing card and its sash neighbor.
- Keep `computeSetHullPolygon` in snap.ts for SVG hull flash use only; keep `findSharedEdges`/`computeSets`/`postActionSetUpdate`/flash animations/z-index reordering unchanged.

#### Success Criteria (Measurable) {#success-criteria}

- No `.set-shadow` or `.set-shadow-shape` elements exist in the DOM at any point during normal operation (verify via `document.querySelectorAll('.set-shadow').length === 0`).
- Every card always has `box-shadow: var(--td-card-shadow-active)` visible on exterior edges, with zero visible gap during drag, break-out, resize, and sash co-resize (manual visual verification).
- The `isGestureActive`/`setGestureActive` functions and `_gestureActive` variable are deleted from card-frame.tsx.
- The store subscriber in deck-canvas.tsx calls `updateSetAppearance` unconditionally (no `isGestureActive()` guard).
- `clip-path: inset()` is applied to `.tugcard` elements (not `.card-frame`), verified by DOM inspection.
- Sash co-resize updates `clip-path` per-frame for both cards involved.

#### Scope {#scope}

1. Rewrite `updateSetAppearance()` to compute and apply `clip-path: inset()` on `.tugcard` elements instead of creating `.set-shadow` DOM elements.
2. Remove all shadow element tracking from drag and resize handlers (`dragShadowEl`, defensive sweep, `resizeShadowEl` snapshot).
3. Remove the `gestureActive` flag system and simplify the store subscriber.
4. Update CSS: unconditional `box-shadow` on all `.tugcard`, remove `.set-shadow`/`.set-shadow-shape` rules, keep `data-in-set` corner squaring.
5. Add `clip-path` update in the sash co-resize per-frame loop.
6. Update break-out detection to recompute `clip-path` instead of removing shadow elements.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the flash animation system (SVG hull flash and card perimeter flash remain unchanged).
- Changing `computeSetHullPolygon` — it stays for flash use.
- Changing `findSharedEdges`, `computeSets`, or `postActionSetUpdate` core logic — only `updateSetAppearance` (which `postActionSetUpdate` calls) changes.
- Changing the z-index reordering algorithm in `updateSetAppearance`.
- Adding new visual effects or design tokens beyond the existing `--td-card-shadow-active`.

#### Dependencies / Prerequisites {#dependencies}

- The existing `findSharedEdges()` function in `snap.ts` correctly identifies which card edges are shared. This is the foundation for determining interior vs exterior edges.
- The `.tugcard` element exists as a child of `.card-frame` and is the visual chrome layer (distinct from `.card-frame` which is the positioning/resize handle layer).

#### Constraints {#constraints}

- Must comply with Rules of Tugways: Rule 4 (appearance changes through CSS/DOM, never React state), Rule 1 (no `root.render()` after mount), Rule 2 (`useSyncExternalStore` for state reads only).
- `clip-path` must target `.tugcard`, not `.card-frame`, so resize handles are never clipped.
- No React state changes for shadow/clip-path updates — all mutations are direct DOM manipulation in `updateSetAppearance()` and the RAF loops.

#### Assumptions {#assumptions}

- The `.set-shadow` creation/removal code, `dragShadowEl`, `resizeShadowEl`, the gesture-active flag system (`isGestureActive`/`setGestureActive`), and the defensive drag-start sweep are all deleted.
- The store subscriber in DeckCanvas is simplified to just call `updateSetAppearance` (which in the new design only sets `data-in-set` and `clip-path: inset()` — no DOM element creation).
- `updateSetAppearance` is retained as the function that computes shared edges and applies CSS properties directly to existing card elements.
- The flash animation system is kept unchanged.
- `postActionSetUpdate` is kept unchanged (it still calls `updateSetAppearance` at the end).
- `computeSetHullPolygon` remains in `snap.ts` for flash SVG hull use but is no longer called by `updateSetAppearance`.
- The z-index reordering logic inside `updateSetAppearance` is kept unchanged.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per skeleton convention. Decisions use d-prefix anchors, steps use step-prefix anchors, and specs use s-prefix anchors. All anchors are kebab-case.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| clip-path rounding causes 1px shadow bleed on interior edges | low | med | Use `0px` (not negative) for interior inset; test at various zoom levels | Visual artifact at non-integer zoom |
| Performance of per-frame updateSetAppearance during sash resize | low | low | Primary cost is forced reflow from getBoundingClientRect, not clip-path; fallback to direct position-based computation if jank observed | Frame drops during sash resize |
| Shadow extension value too small/large for the token's blur radius | med | low | Derive extension from the shadow token's blur radius; tune visually | Shadow looks clipped on exterior edges |

**Risk R01: Clip-path rounding at zoom** {#r01-clip-rounding}

- **Risk:** At non-integer browser zoom levels, the `inset()` boundary may not perfectly align with the card edge, causing a faint shadow line on interior edges.
- **Mitigation:** Use exact `0px` for interior edges (clips at the border-box edge). Test at 90%, 100%, 110%, 125%, and 150% zoom.
- **Residual risk:** Sub-pixel rendering differences across browsers may show a hairline at extreme zoom levels.

**Risk R02: Shadow extension sizing** {#r02-shadow-extension}

- **Risk:** The negative inset values for exterior edges must be large enough to reveal the full shadow blur but not so large that they create visible artifacts.
- **Mitigation:** Use a constant (e.g., `-20px`) derived from the blur radius in `--td-card-shadow-active` (currently `0 2px 8px`). The 20px extension provides generous room for the 8px blur + 2px offset.
- **Residual risk:** If the shadow token is changed to a larger blur, the extension constant must be updated.

---

### Design Decisions {#design-decisions}

#### [D01] All cards always have box-shadow (DECIDED) {#d01-universal-shadow}

**Decision:** Every `.tugcard` always has `box-shadow: var(--td-card-shadow-active)`. The `clip-path: inset()` on `.tugcard` controls which edges show shadow. No conditional shadow application based on focus or set membership. The `.card-frame` has no box-shadow (per [D03]).

**Rationale:**
- Eliminates the need to add/remove shadow DOM elements.
- Shadow moves, resizes, and appears/disappears automatically with the card.
- Simplifies CSS: one shadow rule for all states.

**Implications:**
- The `data-focused="true"` box-shadow rule in chrome.css changes: shadow is always present, not just on focused cards.
- The `data-in-set="true"` `box-shadow: none` rule is removed — clip-path handles interior edge suppression.
- Unfocused cards have shadow too (the dim overlay already visually distinguishes unfocused cards).

#### [D02] Clip-path targets .tugcard, not .card-frame (DECIDED) {#d02-clip-target}

**Decision:** Apply `clip-path: inset()` to the `.tugcard` element (the visual chrome child), not the `.card-frame` element (the positioning/resize handle wrapper).

**Rationale:**
- Resize handles (`.card-frame-resize-*`) extend beyond the card's visual boundary (e.g., `top: -4px`). Clipping `.card-frame` would clip these handles, breaking resize interaction.
- `.tugcard` is the visual chrome layer — clipping it only affects the visual appearance, not interaction.

**Implications:**
- `updateSetAppearance()` must query `.tugcard` elements inside each `.card-frame` to apply clip-path.
- Both `box-shadow` and `clip-path` must be on `.tugcard` so the clip-path controls shadow visibility (see [D03]).

#### [D03] Box-shadow on .tugcard, clip-path on .tugcard (DECIDED) {#d03-shadow-on-tugcard}

**Decision:** Both `box-shadow` and `clip-path: inset()` are applied to the `.tugcard` element. The `.card-frame` has no box-shadow.

**Rationale:**
- `clip-path` on an element clips everything rendered by that element, including its `box-shadow`. For the clip-path to control shadow visibility, the shadow must be on the same element.
- `.card-frame` resize handles are outside `.tugcard`, so they are unaffected.

**Implications:**
- CSS rule: `.tugcard { box-shadow: var(--td-card-shadow-active); }` (always, no condition).
- Remove `box-shadow` from `.card-frame[data-focused="true"]`.
- `clip-path: inset()` on `.tugcard` clips both the card's visual content and its shadow.
- For solo cards, no clip-path is set (or clip-path is removed), so the full shadow is visible on all sides.
- For set members, `clip-path: inset(0 0 0 -20px)` (example) clips top/right/bottom to the edge and extends left by 20px to show shadow.

#### [D04] Inset value convention: 0px clips, negative extends (DECIDED) {#d04-inset-convention}

**Decision:** In `clip-path: inset(top right bottom left)`:
- `0px` on an interior edge clips shadow at the border-box edge (shadow is hidden).
- A negative value (e.g., `-20px`) on an exterior edge extends the clip region beyond the border-box, allowing shadow to show.

**Rationale:**
- `inset(0 0 0 0)` clips exactly at the border-box, hiding all shadow. Negative values expand the visible area.
- This convention maps naturally to the shared-edge computation: shared edge = interior = `0px`, non-shared edge = exterior = negative extension.

**Implications:**
- The shadow extension constant must be large enough to encompass the full shadow blur radius.
- `updateSetAppearance()` builds the inset string from the shared-edge analysis per card.

#### [D05] Delete gesture-active flag system entirely (DECIDED) {#d05-delete-gesture-flag}

**Decision:** Delete `_gestureActive`, `isGestureActive()`, and `setGestureActive()` from card-frame.tsx. The store subscriber in deck-canvas.tsx calls `updateSetAppearance` unconditionally.

**Rationale:**
- The gesture-active flag existed solely to prevent the store subscriber from removing/recreating `.set-shadow` DOM elements while a gesture held a reference to one. With no shadow DOM elements, there is nothing to invalidate.
- `updateSetAppearance` now only reads DOM positions and writes `data-in-set` + `clip-path` to existing elements. This is safe to call at any time, even mid-gesture.

**Implications:**
- All `setGestureActive(true)` calls in drag-start and resize-start are removed.
- All `setGestureActive(false)` calls at gesture-end exit points are removed.
- The store subscriber useEffect in deck-canvas.tsx removes the `isGestureActive()` guard.
- The defensive sweep in drag-start (removing stale `.set-shadow` elements) is deleted.

#### [D06] Sash co-resize updates clip-path per-frame (DECIDED) {#d06-sash-clip-update}

**Decision:** During sash co-resize, update `clip-path: inset()` per-frame in the RAF loop for both the resizing card and its sash neighbor.

**Rationale:**
- During sash resize, the shared edge moves. The inset values for both cards change: the resizing card's interior edge stays at `0px` (still shared), but the sash neighbor's size changes, so its inset values relative to other neighbors may change.
- Per-frame update ensures shadows are always correct during the gesture.

**Implications:**
- The resize RAF loop calls `updateSetAppearance(canvasBounds, containerEl)` once per frame after applying size/position changes to both cards. Since `updateSetAppearance` now only sets attributes and clip-path on existing elements (no DOM creation/removal), it is lightweight enough for per-frame execution.

#### [D07] Break-out uses direct clip-path clear, not updateSetAppearance (DECIDED) {#d07-breakout-clip}

**Decision:** When a card breaks out of a set during drag (snap modifier pressed), directly clear `clip-path` and `data-in-set` on the detached card's DOM elements. Do NOT call `updateSetAppearance` at break-out time. Let the store subscriber handle remaining set members.

**Rationale:**
- Break-out detection runs inside `applyDragFrame` BEFORE `frame.style.left/top` is written. At this point, `getBoundingClientRect` still returns the previous frame's position, so `updateSetAppearance` would incorrectly see the detached card as still adjacent to the set and would not clear its clip-path.
- Direct DOM manipulation on the detached card's `.tugcard` child (`clipPath = ''`, remove `data-in-set`) gives immediate visual correctness without position dependency.
- The `onCardMoved` calls for remaining set members (earlier in the break-out block) trigger the store subscriber, which calls `updateSetAppearance` to recompute their clip-paths with correct positions.

**Implications:**
- The break-out block performs a direct clear on one card (the detached card), not a full recompute.
- Remaining members' clip-path update is deferred to the store subscriber (fires synchronously from `onCardMoved`).

---

### Specification {#specification}

#### Clip-Path Inset Computation {#clip-path-computation}

**Spec S01: Inset value computation per card** {#s01-inset-computation}

For each card in a set, determine which of its four edges are shared (interior) vs non-shared (exterior):

1. From `findSharedEdges(rects)`, collect all `SharedEdge` entries involving this card.
2. For each edge of the card (top, right, bottom, left):
   - If a `SharedEdge` exists on that side → interior → inset value = `0px`.
   - If no `SharedEdge` exists on that side → exterior → inset value = `-SHADOW_EXTEND_PX` (e.g., `-20px`).
3. Build the clip-path string: `clip-path: inset(<top> <right> <bottom> <left>)`.
4. Apply to the `.tugcard` element inside the card's `.card-frame`.

**Mapping from SharedEdge to card side:**
- A `SharedEdge` with `axis: "vertical"` where this card is `cardA` and shares its right edge → this card's right side is interior.
- A `SharedEdge` with `axis: "vertical"` where this card is `cardB` and shares its left edge → this card's left side is interior.
- A `SharedEdge` with `axis: "horizontal"` where this card is `cardA` and shares its bottom edge → this card's bottom side is interior.
- A `SharedEdge` with `axis: "horizontal"` where this card is `cardB` and shares its top edge → this card's top side is interior.

The exact mapping depends on the `findSharedEdges` convention. The implementation must read the `SharedEdge` fields (`cardAId`, `cardBId`, `axis`, `boundaryPosition`) and compare with the card's rect to determine which side of this card the shared edge corresponds to.

**Spec S02: Shadow extension constant** {#s02-shadow-extension}

```typescript
const SHADOW_EXTEND_PX = 20; // px beyond border-box for exterior edges
```

Derived from `--td-card-shadow-active: 0 2px 8px rgba(0, 0, 0, 0.4)`:
- Blur radius: 8px
- Y-offset: 2px
- Extension: 20px provides generous coverage (8px blur * 2 + margin).

#### Updated updateSetAppearance Signature {#update-set-appearance-spec}

**Spec S03: Revised updateSetAppearance** {#s03-revised-update-set-appearance}

```typescript
export function updateSetAppearance(
  canvasBounds: DOMRect | null,
  containerEl: HTMLElement | null,
): void;
```

The signature is unchanged. The behavior changes:

1. Query all `.card-frame[data-card-id]` elements and build rects (unchanged).
2. Call `findSharedEdges(rects)` and `computeSets(ids, sharedEdges)` (unchanged).
3. For each card:
   - If in a set: set `data-in-set="true"` on `.card-frame`, compute `clip-path: inset(...)` per Spec S01, apply to the `.tugcard` child.
   - If solo: remove `data-in-set`, remove `clip-path` (set to empty string) from `.tugcard` child.
4. **Deleted:** All `.set-shadow` creation/removal code.
5. **Kept:** Z-index reordering block (unchanged).
6. **Deleted:** `.set-shadow` z-index assignment block.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SHADOW_EXTEND_PX` | const | `card-frame.tsx` | New constant: `20` (px extension for exterior edges) |
| `updateSetAppearance` | fn | `card-frame.tsx` | Rewritten: applies clip-path instead of creating shadow elements |
| `computeClipPathForCard` | fn | `card-frame.tsx` | New helper: computes `clip-path: inset(...)` string for one card given its shared edges |
| `_gestureActive` | let | `card-frame.tsx` | Deleted |
| `isGestureActive` | fn | `card-frame.tsx` | Deleted |
| `setGestureActive` | fn | `card-frame.tsx` | Deleted |
| `dragShadowEl` | ref | `card-frame.tsx` (inside CardFrame) | Deleted |
| `dragShadowOrigin` | ref | `card-frame.tsx` (inside CardFrame) | Deleted |
| `resizeShadowEl` | local | `card-frame.tsx` (inside resize handler) | Deleted |
| `resizeShadowOriginX` | local | `card-frame.tsx` (inside resize handler) | Deleted |
| `resizeShadowOriginY` | local | `card-frame.tsx` (inside resize handler) | Deleted |

#### CSS changes {#css-changes}

| Selector | Change | File |
|----------|--------|------|
| `.tugcard` | Add `box-shadow: var(--td-card-shadow-active)` | `chrome.css` |
| `.card-frame[data-focused="true"]` | Remove `box-shadow` rule (shadow now on `.tugcard`) | `chrome.css` |
| `.card-frame[data-in-set="true"]` | Remove `box-shadow: none` (clip-path handles this now) | `chrome.css` |
| `.set-shadow` | Delete entire rule | `chrome.css` |
| `.set-shadow-shape` | Delete entire rule | `chrome.css` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Manual visual** | Verify shadow correctness during drag, resize, break-out, sash resize | Every step |
| **DOM inspection** | Verify no `.set-shadow` elements exist, clip-path values are correct | Steps 2, 3 |
| **Regression** | Verify flash animations still work, z-index reordering unchanged | Step 4 |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.**
>
> **References are mandatory:** Every step must cite specific plan artifacts.

#### Step 1: CSS foundation — universal shadow on .tugcard, remove .set-shadow rules {#step-1}

**Commit:** `refactor(tugdeck): move box-shadow to .tugcard, delete .set-shadow CSS`

**References:** [D01] All cards always have box-shadow, [D03] Box-shadow on .tugcard, (#css-changes, #s02-shadow-extension)

**Artifacts:**
- Modified `tugdeck/styles/chrome.css`

**Tasks:**
- [ ] Add `.tugcard { box-shadow: var(--td-card-shadow-active); }` rule.
- [ ] Remove `box-shadow: var(--td-card-shadow-active)` from `.card-frame[data-focused="true"]`. Keep `border-radius` rule.
- [ ] Remove `box-shadow: none` from `.card-frame[data-in-set="true"]`. Keep `border-radius: 0` and the `.tugcard` `border-radius: 0` rules.
- [ ] Delete the `.set-shadow` rule block and its comment.
- [ ] Delete the `.set-shadow-shape` rule block.
- [ ] Delete the "Virtual set hull shadow" comment block above `.set-shadow`.

**Tests:**
- [ ] Visual: all cards show shadow on all edges (including unfocused cards).
- [ ] Visual: set member cards still show shadow on all edges (the old shadow DOM elements still exist at this point from JS but CSS rules are gone — they will be invisible).

**Checkpoint:**
- [ ] `grep -c 'set-shadow' tugdeck/styles/chrome.css` returns 0.
- [ ] `.tugcard` rule includes `box-shadow`.

---

#### Step 2: Rewrite updateSetAppearance to use clip-path: inset() {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): rewrite updateSetAppearance to use clip-path inset on .tugcard`

**References:** [D01] All cards always have box-shadow, [D02] Clip-path targets .tugcard, [D03] Box-shadow on .tugcard, [D04] Inset value convention, Spec S01, Spec S02, Spec S03, (#clip-path-computation, #update-set-appearance-spec)

**Artifacts:**
- Modified `card-frame.tsx`: rewritten `updateSetAppearance()`, new `computeClipPathForCard()` helper, new `SHADOW_EXTEND_PX` constant

**Tasks:**
- [ ] Add `SHADOW_EXTEND_PX = 20` constant near the top of card-frame.tsx.
- [ ] Write `computeClipPathForCard(cardId: string, cardRect: Rect, sharedEdges: SharedEdge[]): string` helper that returns a `clip-path: inset(...)` CSS value string per Spec S01. Returns empty string if the card has no interior edges (all exterior).
- [ ] Rewrite `updateSetAppearance()` per Spec S03:
  - Keep: rect collection, `findSharedEdges`, `computeSets`, set membership lookup, `data-in-set` attribute setting, z-index reordering block.
  - Replace: shadow DOM element creation/removal with per-card clip-path application on `.tugcard` child.
  - For each card in a set: find the `.tugcard` child of the `.card-frame`, set `el.style.clipPath = computeClipPathForCard(...)`.
  - For solo cards: find `.tugcard` child, set `el.style.clipPath = ''` (removes clip-path).
  - Delete: all `.set-shadow` element creation code, all `.set-shadow` element removal code, `.set-shadow` z-index assignment block.
- [ ] Remove the `computeSetHullPolygon` call from `updateSetAppearance`. Keep the import in card-frame.tsx — it is still used by `flashSetPerimeter()`.
- [ ] Update the `updateSetAppearance` JSDoc to reflect the new behavior.

**Tests:**
- [ ] Visual: solo cards show full shadow on all sides.
- [ ] Visual: two snapped cards show shadow on exterior edges only, interior edge shadow is clipped.
- [ ] Visual: three cards in an L-shape show correct clipping per card.
- [ ] DOM inspect: no `.set-shadow` elements in the DOM.
- [ ] DOM inspect: set member `.tugcard` elements have `clip-path: inset(...)` with correct values.

**Checkpoint:**
- [ ] `document.querySelectorAll('.set-shadow').length === 0` in browser console.
- [ ] `document.querySelector('.tugcard').style.clipPath` returns expected inset value for a set member.

---

#### Step 3: Delete gesture-active flag and shadow tracking from drag/resize {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): delete gesture-active flag, dragShadowEl, and resize shadow tracking`

**References:** [D05] Delete gesture-active flag system, [D07] Break-out triggers clip-path removal, (#symbols)

**Artifacts:**
- Modified `card-frame.tsx`: deleted gesture flag system, deleted shadow refs/tracking from drag and resize handlers
- Modified `deck-canvas.tsx`: simplified store subscriber

**Tasks:**
- [ ] Delete `_gestureActive`, `isGestureActive()`, and `setGestureActive()` from card-frame.tsx.
- [ ] Remove `isGestureActive` from the export of card-frame.tsx and from the import in deck-canvas.tsx.
- [ ] Delete the `dragShadowEl` ref and `dragShadowOrigin` ref declarations.
- [ ] Remove all `setGestureActive(true)` calls in `handleDragStart`.
- [ ] Remove all `setGestureActive(false)` calls in `onPointerUp` (drag end, merge path, normal path).
- [ ] Remove the defensive sweep block in `handleDragStart` (the block that removes stale `.set-shadow` elements and rebuilds).
- [ ] Remove the `.set-shadow` lookup-by-`data-set-card-ids` block in `handleDragStart` that sets `dragShadowEl.current`.
- [ ] Remove the `dragShadowEl.current` translation in the set-move branch of `applyDragFrame`. Note: no clip-path update is needed during set-move because all set members translate by the same delta — internal shared edges do not change, so existing clip-path values remain correct throughout the gesture.
- [ ] In the break-out detection block: replace the `dragShadowEl.current.parentNode?.removeChild(...)` with a two-part clip-path update. **Important timing constraint:** break-out detection runs BEFORE `frame.style.left/top` is applied later in `applyDragFrame`, so `getBoundingClientRect` would still see the previous frame's position and incorrectly identify the detached card as still adjacent to the set. Therefore: (1) directly clear the detached card's clip-path and `data-in-set` via DOM manipulation on the `.tugcard` child of `frame` (`tugcardEl.style.clipPath = ''`, `frame.removeAttribute('data-in-set')`), and (2) let the store subscriber handle recomputing clip-paths for the remaining set members — the `onCardMoved` calls earlier in the break-out block commit member positions to the store, which triggers the subscriber, which calls `updateSetAppearance` with correct positions for the remaining members.
- [ ] Remove `dragShadowEl.current = null` resets at all drag-end exit points.
- [ ] In the resize handler: remove `resizeShadowEl`, `resizeShadowOriginX`, `resizeShadowOriginY` local variables.
- [ ] Remove the `.set-shadow` lookup in the resize handler's pointerdown setup.
- [ ] Remove the `resizeShadowEl` translation in the resize RAF loop.
- [ ] Remove all `setGestureActive(true)` and `setGestureActive(false)` calls in the resize handler.
- [ ] In deck-canvas.tsx: remove the `isGestureActive()` guard from the store subscriber callback. The subscriber now unconditionally calls `updateSetAppearance`.
- [ ] In deck-canvas.tsx: remove the `isGestureActive` import from the card-frame import line.
- [ ] Update the store subscriber comment to explain it now unconditionally updates (no gesture gating needed).
- [ ] Remove the `updateSetAppearance` import from deck-canvas.tsx if it is no longer called directly there (check: the `useLayoutEffect` and `useEffect` still call it — keep the import).

**Tests:**
- [ ] Visual: drag a set — all cards move with correct shadows, no gap.
- [ ] Visual: break-out — detached card immediately shows full shadow, remaining members update.
- [ ] Visual: resize a solo card — shadow tracks correctly.
- [ ] Visual: resize a set member — shadow tracks correctly.
- [ ] Verify: `grep -c 'gestureActive\|dragShadowEl\|resizeShadowEl' tugdeck/src/components/chrome/card-frame.tsx` returns 0.
- [ ] Verify: `grep -c 'isGestureActive' tugdeck/src/components/chrome/deck-canvas.tsx` returns 0.

**Checkpoint:**
- [ ] No TypeScript errors (`bun run build` or type-check passes).
- [ ] Drag, break-out, resize all show correct shadows with no visual glitches.

---

#### Step 4: Add clip-path update to sash co-resize RAF loop {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): update clip-path per-frame during sash co-resize`

**References:** [D06] Sash co-resize updates clip-path per-frame, Spec S01, (#clip-path-computation)

**Artifacts:**
- Modified `card-frame.tsx`: sash co-resize block in the resize RAF loop

**Tasks:**
- [ ] In the resize RAF loop, after applying the sash neighbor's new position/size, call `updateSetAppearance(canvasBounds, containerEl)` once per frame. This ensures both the resizing card and the sash neighbor get correct clip-path values that account for the full set context (not just the two sash cards).
- [ ] Obtain the `containerEl` reference: use `frame.parentElement` (already available in the resize closure as the card frame's parent). Obtain `canvasBounds` from the existing `resizeCanvasBounds` local captured at resize-start.
- [ ] **Performance note:** The primary cost of per-frame `updateSetAppearance` is forced synchronous layout reflow from `getBoundingClientRect` on every card, not the `clip-path` computation itself. With typical card counts (under 20), this is acceptable. If performance becomes an issue, the sash resize path could compute clip-path directly from the known positions (already available as local variables in the RAF loop) without calling `getBoundingClientRect`, bypassing the reflow. This optimization is deferred unless jank is observed.

**Tests:**
- [ ] Visual: sash resize — both cards maintain correct shadow clipping as the sash moves.
- [ ] Visual: sash resize then release — shadows are correct at final position.
- [ ] Visual: no frame drops visible during sash resize (performance check).

**Checkpoint:**
- [ ] Sash resize visually correct at various speeds.
- [ ] No TypeScript errors.

---

#### Step 5: Cleanup and integration verification {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] All cards always have box-shadow, [D05] Delete gesture-active flag system, (#success-criteria)

**Tasks:**
- [ ] Verify no `.set-shadow` references remain in card-frame.tsx (except comments about the old system if any — remove those too).
- [ ] Verify no `gestureActive` references remain anywhere in the codebase.
- [ ] Verify `computeSetHullPolygon` is still imported only by flash-related code in card-frame.tsx and tested in snap.test.ts.
- [ ] Verify the `updateSetAppearance` JSDoc and deck-canvas.tsx comments accurately describe the new behavior.
- [ ] Run through the full manual test matrix: drag solo card, drag set, break-out, resize solo, resize set member, sash resize, card close while in set, undo/redo, rapid close-then-drag.

**Tests:**
- [ ] Full visual regression: all gesture types produce correct shadows.
- [ ] Flash animations still work correctly (set join flash, break-out flash).
- [ ] Z-index reordering still works (set members are consecutive in z-order).
- [ ] Store subscriber fires correctly on card close, undo, redo.

**Checkpoint:**
- [ ] `grep -rn 'set-shadow\|gestureActive\|dragShadowEl\|resizeShadowEl' tugdeck/src/ tugdeck/styles/` returns only flash-related or comment references (if any).
- [ ] All gesture scenarios visually verified.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Set shadow system rewritten to use card-intrinsic `box-shadow` with `clip-path: inset()` on `.tugcard`, eliminating all `.set-shadow` DOM elements and gesture-synchronization complexity.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] No `.set-shadow` or `.set-shadow-shape` elements exist in the DOM at any point (verify via DevTools).
- [ ] `isGestureActive`, `setGestureActive`, `_gestureActive`, `dragShadowEl`, `resizeShadowEl` are all deleted from the codebase.
- [ ] Every card displays correct shadow on exterior edges during: solo rest, set rest, drag, set-move, break-out, resize, sash co-resize.
- [ ] Zero visible shadow gaps during any gesture transition.
- [ ] Flash animations (set join, break-out) unchanged and functional.
- [ ] No TypeScript errors, no new warnings.

**Acceptance tests:**
- [ ] Snap two cards together — interior shadow disappears, exterior shadow visible.
- [ ] Drag the set — shadow tracks perfectly, no gaps.
- [ ] Break out with Alt — detached card immediately shows full shadow.
- [ ] Sash resize — shadow updates per-frame for both cards.
- [ ] Close a card in a set — remaining card shows full shadow.
- [ ] Undo the close — set shadow restores correctly.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Derive `SHADOW_EXTEND_PX` dynamically from the computed shadow token value.
- [ ] Consider adding shadow transition animation when a card joins/leaves a set.
- [ ] Investigate whether `clip-path: inset()` can replace the dim overlay for unfocused cards.

| Checkpoint | Verification |
|------------|--------------|
| No shadow DOM elements | `document.querySelectorAll('.set-shadow').length === 0` |
| Gesture flag deleted | `grep -c 'gestureActive' tugdeck/src/` returns 0 |
| Shadows correct at rest | Visual inspection of solo and set cards |
| Shadows correct during drag | Drag a set, verify no gaps |
| Sash resize correct | Sash resize, verify per-frame shadow update |
