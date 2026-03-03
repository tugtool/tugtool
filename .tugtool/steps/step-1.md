# Step 1: Card Registry Module

## Files Created

- `tugdeck/src/card-registry.ts`
- `tugdeck/src/__tests__/card-registry.test.ts`

## Files Modified

(none)

## Implementation Notes

- `CardFrameInjectedProps` is defined inline in `card-registry.ts` since `card-frame.tsx` does not exist until a later step. The comment notes it should be imported from there once created.
- `getAllRegistrations()` returns `Map<string, CardRegistration>` per Spec S03.
- `_resetForTest()` uses `registry.clear()` for test isolation; called in `beforeEach` in the test file.

## Checkpoint Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test card-registry

bun test v1.3.9 (cf6cdbbb)

 6 pass
 0 fail
 14 expect() calls
Ran 6 tests across 1 file. [53.00ms]
```

## Full Test Suite Output

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bun test

 294 pass
 0 fail
 585 expect() calls
Ran 294 tests across 23 files. [7.83s]
```

## TypeScript Check

```
$ cd /Users/kocienda/Mounts/u/src/tugtool/.tugtree/tugplan__tugways-phase-5-tugcard-20250303-034857/tugdeck && bunx tsc --noEmit
(no output -- type check clean)
```
