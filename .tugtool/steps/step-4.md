# Step 4: CardFrame Component

## Files Created

- `tugdeck/src/components/chrome/card-frame.tsx`
- `tugdeck/src/__tests__/card-frame.test.tsx`

## Files Modified

(none)

## Implementation Notes

- `CardFrameInjectedProps` and `CardFrameProps` are exported from `card-frame.tsx` per Spec S04. `card-registry.ts` retains its compatible local re-declaration to avoid a forward-dependency; the two are structurally identical.
- Drag and resize both use the RAF + ref appearance-zone pattern: inner `onPointerMove` functions schedule RAF frames; `onPointerUp` commits final geometry to DeckState via `onCardMoved`.
- `setPointerCapture` is called via `event.nativeEvent.pointerId` on the frame element, not the synthetic event, per Spec S04.
- `minSizeRef` holds the latest min-size so resize closures always read the current value without needing to be re-created when `minSize` state updates.
- `handleResizeStart` calls `event.stopPropagation()` to avoid double-firing `onCardFocused` from the resize handle, since the frame's `onPointerDown` also fires on bubble.
- `onCardClosed` is NOT injected via `CardFrameInjectedProps`. The `renderContent` factory (from the card registry) is responsible for binding `onClose` → `onCardClosed(id)`. CardFrame calls `renderContent(injected)` exactly once.
- TypeScript: inner closures over `frame` need an explicit non-null typed `const` (`const frame: HTMLDivElement = frameRef.current!`) because TypeScript doesn't preserve narrowing across inner function definitions.
- 8 resize handles use CSS classes from `chrome.css`: `card-frame-resize`, `card-frame-resize-{n,s,e,w,nw,ne,sw,se}`.

## Checkpoint Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test src/__tests__/card-frame.test.tsx

bun test v1.3.9 (cf6cdbbb)

 10 pass
 0 fail
 28 expect() calls
Ran 10 tests across 1 file. [121.00ms]
```

## Full Test Suite Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test

 324 pass
 0 fail
 662 expect() calls
Ran 324 tests across 26 files. [7.83s]
```

## TypeScript Check

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bunx tsc --noEmit
(no output -- type check clean)
```
