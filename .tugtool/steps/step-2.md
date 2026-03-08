# Step 2: Wire migration into tugcast startup

## Files Modified

- `tugcode/crates/tugcast/src/main.rs` — open `DefaultsStore` early, run migration before TCP bind, pass store to `run_server`
- `tugcode/crates/tugcast/src/server.rs` — change `build_app`/`run_server` to accept `Option<Arc<DefaultsStore>>` instead of `Option<PathBuf>`
- `tugcode/crates/tugcast/src/migration.rs` — removed `#[allow(dead_code)]` (function is now called)
- `tugcode/crates/tugcast/src/integration_tests.rs` — updated `build_defaults_test_app` and inline test to open store before calling `build_app`

## Implementation Notes

- `DefaultsStore::open` is called in `main.rs` after `watch_dir` resolution, before any spawned tasks and before TCP bind — ensuring migration completes before the server accepts connections ([D05]).
- On open failure, a `warn!` is logged and `bank_store` is `None`, preserving graceful degradation.
- Migration is skipped when `bank_store` is `None`.
- `build_app` now accepts `Option<Arc<DefaultsStore>>` and directly registers the defaults routes when `Some` — no internal open, no internal error handling.
- Integration tests open the store directly with `DefaultsStore::open(tmp.path())` and wrap in `Arc`.

## Checkpoint 1: Full tugcast test suite

**Command:** `cd tugcode && cargo nextest run -p tugcast`

```
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.88s
────────────
 Nextest run ID 553da8dd-345a-4830-b78a-d62c0eb14243 with nextest profile: default
    Starting 214 tests across 1 binary (4 tests skipped)
────────────
     Summary [   4.564s] 214 tests run: 214 passed, 4 skipped
```

**Result:** PASSED — 214 tests passed, 4 skipped

## Checkpoint 2: Zero warnings

**Command:** `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning`

```
0
```

**Result:** PASSED — 0 warnings
