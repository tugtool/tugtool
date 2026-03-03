# Step 5: DeckManager Rebuild

## Files Created

- `tugdeck/src/__tests__/deck-manager.test.ts`

## Files Modified

- `tugdeck/src/deck-manager.ts` (rebuilt: addCard, removeCard, moveCard, focusCard, cascade, stable callbacks, removed deckCanvasRef)
- `tugdeck/src/serialization.ts` (buildDefaultLayout now returns empty DeckState)
- `tugdeck/src/__tests__/layout-tree.test.ts` (updated 4 tests: T28/T29 and non-overlapping test)
- `tugdeck/src/components/chrome/deck-canvas.tsx` (DeckCanvasProps extended with optional Spec S06 props)

## Implementation Notes

- `buildDefaultLayout` now returns `{ cards: [] }`. The old five-card layout used componentIds not registered in Phase 5.
- `deckCanvasRef` and the `DeckCanvasHandle` import are removed from DeckManager. DeckManager now drives DeckCanvas via props.
- Callbacks bound once in constructor: `handleCardMoved`, `handleCardClosed`, `handleCardFocused`. `render()` never creates new function objects.
- Each state-mutating method assigns `this.deckState = { ...this.deckState }` before calling `render()` so React sees a new object reference.
- Cascade positioning: `cascadeIndex` increments on each `addCard`. When `x + DEFAULT_CARD_WIDTH > canvasWidth` OR `y + DEFAULT_CARD_HEIGHT > canvasHeight`, cascadeIndex resets to 0 and returns (0,0).
- `DeckCanvasProps` updated with optional `deckState`, `onCardMoved`, `onCardClosed`, `onCardFocused` (Spec S06). All new props are optional so existing test call sites passing only `connection={null}` continue to work.
- `localStorage` stubbed in deck-manager.test.ts because happy-dom workers don't provide it by default.
- T35 cascade reset test detects wrap-around by checking for a card whose x < predecessor's x, rather than relying on exact canvas dimensions.

## Checkpoint Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test src/__tests__/deck-manager.test.ts

bun test v1.3.9 (cf6cdbbb)

 17 pass
 0 fail
 54 expect() calls
Ran 17 tests across 1 file. [112.00ms]

$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test src/__tests__/layout-tree.test.ts

bun test v1.3.9 (cf6cdbbb)

 17 pass
 0 fail
 61 expect() calls
Ran 17 tests across 1 file. [53.00ms]

$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun run build

vite v7.3.1 building client environment for production...
✓ 1760 modules transformed.
✓ built in 719ms (zero warnings, zero errors)
```

## Full Test Suite Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test

 341 pass
 0 fail
 691 expect() calls
Ran 341 tests across 27 files. [7.84s]
```

## TypeScript Check

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bunx tsc --noEmit
(no output -- type check clean)
```
