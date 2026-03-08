# Step 7: Final Integration Checkpoint

## Checkpoint 1: cargo nextest run (all packages)

**Command:** `cd tugcode && cargo nextest run`

```
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.82s
────────────
 Nextest run ID fdc9a904-948c-4eaf-b5f3-34b102f71b04 with nextest profile: default
    Starting 868 tests across 15 binaries (9 tests skipped)
────────────
     Summary [   4.816s] 868 tests run: 868 passed, 9 skipped
```

**Result:** PASSED — 868 tests passed, 9 skipped

Note: an initial run showed 1 failure in `tugrelaunch::tests::test_kqueue_wait_for_short_lived_process`. This is a pre-existing timing-sensitive kqueue test that also fails intermittently on `main`. A second run passed cleanly (confirmed identical behavior on `main`). The failure is unrelated to this phase.

## Checkpoint 2: cargo fmt --all --check

**Command:** `cd tugcode && cargo fmt --all --check`

```
(no output — formatting is clean)
```

**Result:** PASSED — zero formatting issues

## Checkpoint 3: bun run check (TypeScript)

**Command:** `cd tugdeck && bun run check`

```
$ bunx tsc --noEmit
(no output — zero TypeScript errors)
```

**Result:** PASSED — zero TypeScript errors

## Checkpoint 4: curl /api/settings returns 404

**Result:** DEFERRED — requires a running tugcast server

## Checkpoint 5: curl /api/defaults/dev.tugtool.deck.layout/layout returns tagged JSON

**Result:** DEFERRED — requires a running tugcast server

## Checkpoint 6: curl /api/defaults/dev.tugtool.app/theme returns tagged string

**Result:** DEFERRED — requires a running tugcast server
