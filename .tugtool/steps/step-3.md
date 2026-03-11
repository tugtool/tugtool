# Step 3: Card Frame & Title Bar

## Files Created

- `tugdeck/src/components/chrome/card-header.tsx` — CardHeader component extracted from tugcard.tsx; 28px title bar with collapse/expand chevron, horizontal-ellipsis menu, and close button; all three buttons use 2.5D elevation; double-click on header surface toggles collapse; onDragStart forwarded unconditionally so collapsed cards remain draggable [D07]
- `tugdeck/src/components/chrome/card-header.css` — per-component 2.5D elevation tokens for header control buttons; title bar surface stays flat
- `tugdeck/src/__tests__/card-header.test.tsx` — unit tests for CardHeader (chevron, close, double-click, drag, icon, closable=false) and CardFrame collapse behavior (resize handles hidden, frame height), DeckManager.toggleCardCollapse, and serialization round-trip

## Files Modified

- `tugdeck/src/components/tugways/tugcard.tsx` — replaced inline header JSX with CardHeader component; added collapsed/onCollapse props; replaced conditional {!collapsed && ...} unmounting with always-mounted .tugcard-body wrapper (CSS-based hide per [D07]); removed unused handleHeaderPointerDown
- `tugdeck/src/components/tugways/tugcard.css` — added .tugcard-body flex wrapper; added .tugcard--collapsed .tugcard-body { height:0; flex:none } for CSS-based collapse; removed old .tugcard-close-btn rules (moved to card-header.css); added .card-header-controls group
- `tugdeck/src/components/chrome/card-frame.tsx` — imported CARD_TITLE_BAR_HEIGHT; added onCardCollapsed prop; added collapsed/onCollapse to CardFrameInjectedProps; frame height = CARD_TITLE_BAR_HEIGHT+2 when collapsed; resize handles hidden when collapsed; data-gesture="true" set/cleared at drag-start/drag-end and resize-start/resize-end to disable height transition during gesture [D07]
- `tugdeck/src/components/chrome/deck-canvas.tsx` — wired onCardCollapsed to store.toggleCardCollapse; passed injected.collapsed and injected.onCollapse through to Tugcard
- `tugdeck/src/deck-manager.ts` — added toggleCardCollapse stable bound callback; added _toggleCardCollapse() implementation (toggles collapsed field, notifies, schedules save)
- `tugdeck/src/deck-manager-store.ts` — added toggleCardCollapse method to IDeckManagerStore interface
- `tugdeck/src/components/tugways/cards/gallery-card.tsx` — added gallery-title-bar tab to GALLERY_DEFAULT_TABS (now 15 tabs); added GalleryTitleBarContent interactive demo; registered gallery-title-bar card
- `tugdeck/styles/chrome.css` — added .card-frame height transition (--tug-base-motion-duration-moderate + --tug-base-motion-easing-standard); disabled during gesture via .card-frame[data-gesture="true"] { transition: none }
- `tugdeck/src/__tests__/component-gallery.test.tsx` — updated 14→15 tab count assertions
- `tugdeck/src/__tests__/gallery-card.test.tsx` — updated 14→15 tab count assertions
- `tugdeck/src/__tests__/mock-deck-manager-store.ts` — added toggleCardCollapse no-op stub
- `tugdeck/src/__tests__/observable-props-integration.test.tsx` — updated 14→15 tab count assertion

## Implementation Notes

- **[D07] CSS-based collapse, not unmount**: tugcard.tsx wraps accessory+content in `.tugcard-body`. When `.tugcard--collapsed` is set, CSS sets `.tugcard--collapsed .tugcard-body { height:0; flex:none }`. The React subtree stays mounted — terminal sessions, scroll positions, and form values survive collapse/expand.
- **Height transition**: `.card-frame { transition: height … }` in chrome.css animates collapse/expand. The transition is suppressed via `data-gesture="true"` on the frame element during active drag and resize gestures, preventing the browser from interpolating height changes driven by pointer position.
- **Collapsed height**: CardFrame uses `CARD_TITLE_BAR_HEIGHT (28px) + 2px border = 30px` for the frame height when collapsed. The stored `size.height` is preserved and restored on expand.
- **Resize handles hidden when collapsed**: CardFrame conditionally renders the 8 resize handle divs only when `!collapsed`. Drag remains active — the header's onDragStart is wired unconditionally.
- **CARD_TITLE_BAR_HEIGHT exported**: card-header.tsx exports the constant so card-frame.tsx can import it without duplicating the value.
- **gallery-title-bar tab**: added as the 15th tab in GALLERY_DEFAULT_TABS. Tests updated accordingly.
- **Serialization**: collapsed state was already read/written by serialization.ts (established in Phase 5f); no changes needed.

## Checkpoint 1: bun run build

**Command:** `cd tugdeck && bun run build`

```
vite v7.3.1 building client environment for production...
transforming...
✓ 1866 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.90 kB │ gzip:   0.51 kB
dist/assets/index-B7kf3SF2.css   75.80 kB │ gzip:  12.42 kB
dist/assets/vendor-cl_uhV7R.js  204.53 kB │ gzip:  64.67 kB
dist/assets/index-wl1lQq5S.js   750.39 kB │ gzip: 205.85 kB
✓ built in 1.08s
```

**Result:** PASSED — build exits 0, zero errors

## Checkpoint 2: bun test

**Command:** `cd tugdeck && bun test`

```
 1360 pass
 0 fail
 4419 expect() calls
Ran 1360 tests across 60 files. [8.43s]
```

**Result:** PASSED — 1360 tests pass, 0 failures (19 new tests from card-header.test.tsx, 1 additional drag test added during revision)
