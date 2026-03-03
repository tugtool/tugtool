# Step 2: TugcardDataContext and useTugcardData Hook

## Files Created

- `tugdeck/src/components/tugways/hooks/use-tugcard-data.ts`
- `tugdeck/src/__tests__/use-tugcard-data.test.tsx`

## Files Modified

- `tugdeck/src/components/tugways/hooks/index.ts` (added `useTugcardData` export)

## Implementation Notes

- `TugcardDataContext` uses `null` as default value so `useTugcardData()` never throws outside a provider.
- `TugcardDataProvider` uses `React.createElement` (not JSX) since the module is a `.ts` file.
- The hook overloads share one runtime body. The implementation extracts the first entry's value via `feedData.values().next().value` and returns it cast to `T`. For the typed `<T>` single-feed convenience overload this is the correct decoded value. For the no-generic map overload callers receive the same first value.
- Since TypeScript overloads share one runtime body, callers needing the full map for multi-feed access should read `TugcardDataContext` directly. Phase 6 will revise this when real feed subscription is wired.
- `_resetForTest` is not needed; each test renders into a fresh tree so context isolation is automatic.

## Checkpoint Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test use-tugcard-data

bun test v1.3.9 (cf6cdbbb)

 7 pass
 0 fail
 12 expect() calls
Ran 7 tests across 1 file. [113.00ms]
```

## Full Test Suite Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test

 301 pass
 0 fail
 597 expect() calls
Ran 301 tests across 24 files. [7.83s]
```

## TypeScript Check

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bunx tsc --noEmit
(no output -- type check clean)
```
