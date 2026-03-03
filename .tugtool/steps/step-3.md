# Step 3: Tugcard Composition Component

## Files Created

- `tugdeck/src/components/tugways/tugcard.tsx`
- `tugdeck/src/components/tugways/tugcard.css`
- `tugdeck/src/__tests__/tugcard.test.tsx`

## Files Modified

(none)

## Implementation Notes

- `TugcardMeta` and `TugcardProps` are defined and exported from `tugcard.tsx` per Spec S01.
- `FeedIdValue` is imported from `protocol.ts` for the `feedIds` prop type.
- `useResponder` is called with `close`, `minimize`, `toggleMenu`, `find` actions. `minimize`/`toggleMenu`/`find` are Phase 5 stubs (no-ops). `close` calls the `onClose` prop.
- `TugcardDataProvider` wraps children with an empty feed data map (Phase 6 will wire real subscriptions).
- Accessory height is measured via `useLayoutEffect` + `ResizeObserver`. In happy-dom tests `getBoundingClientRect()` returns 0, so the reported height is `28 + 0 + minContentSize.height`.
- `onMinSizeChange` is reported via `useEffect` whenever `totalMinWidth`, `totalMinHeight`, or the callback changes.
- Close button uses `event.stopPropagation()` to prevent drag initiation via the header handler.
- Phase 5 feed-gating: `feedIds.length === 0` → children mount immediately; `feedIds.length > 0` → shows "Loading..." placeholder.
- CSS uses only verified `--td-*` semantic tokens: `--td-header-active`, `--td-header-inactive`, `--td-text`, `--td-text-soft`, `--td-surface`, `--td-surface-control`, `--td-border`, `--td-border-soft`, `--td-radius-md`, `--td-radius-sm`, `--td-duration-fast`, `--td-easing-standard`.

## Checkpoint Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test src/__tests__/tugcard.test.tsx

bun test v1.3.9 (cf6cdbbb)

 13 pass
 0 fail
 37 expect() calls
Ran 13 tests across 1 file. [118.00ms]
```

## Full Test Suite Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test

 314 pass
 0 fail
 634 expect() calls
Ran 314 tests across 25 files. [7.84s]
```

## TypeScript Check

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bunx tsc --noEmit
(no output -- type check clean)
```
