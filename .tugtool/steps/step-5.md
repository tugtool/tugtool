# Step 5: Remove legacy /api/settings endpoint and settings module

## Files Deleted

- `tugcode/crates/tugcast/src/settings.rs`

## Files Modified

- `tugcode/crates/tugcast/src/main.rs` — removed `mod settings;`
- `tugcode/crates/tugcast/src/server.rs` — removed `use crate::settings::SettingsState;`, removed `settings_path` derivation, `settings_state` creation, `/api/settings` route, and `.layer(Extension(settings_state))` call
- `tugcode/crates/tugcast/src/integration_tests.rs` — removed `build_settings_test_app` helper and all 7 `test_settings_*` test functions

## Implementation Notes

- Deleting `settings.rs` also removed its internal `#[cfg(test)] mod tests` block (10 unit tests for `DeckSettings`, `load_settings`, and `save_settings`).
- Total tests removed: 17 (10 unit + 7 integration). Remaining suite: 197 tests, all passing.
- No unused-import warnings after removal — `server.rs` no longer imports from `settings`.

## Checkpoint 1: Full tugcast test suite

**Command:** `cd tugcode && cargo nextest run -p tugcast`

```
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.18s
────────────
 Nextest run ID 0e5bcb29-e67d-4b31-bdd4-696a17649f59 with nextest profile: default
    Starting 197 tests across 1 binary (4 tests skipped)
────────────
     Summary [   4.578s] 197 tests run: 197 passed, 4 skipped
```

**Result:** PASSED — 197 tests passed, 4 skipped

## Checkpoint 2: Zero warnings

**Command:** `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning`

```
0
```

**Result:** PASSED — 0 warnings
