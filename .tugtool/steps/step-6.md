# Step 6: Add integration tests for migration and new flow

## Files Modified

- `tugcode/crates/tugcast/src/integration_tests.rs` — added `build_migration_test_app` helper, `write_flat_settings` helper, and 5 new tests (T13–T17)

## Implementation Notes

- `build_migration_test_app(store)` accepts a pre-opened `Arc<DefaultsStore>` so migration tests can share the same store between the direct migration call and the HTTP layer.
- `write_flat_settings(source_tree, contents)` creates `.tugtool/deck-settings.json` under a temp dir for migration test setup.
- T13 (`test_migration_writes_layout_and_theme_to_tugbank`): calls migration directly then verifies both keys via `/api/defaults/` GET — layout returns `{"kind":"json","value":{"version":5,...}}`, theme returns `{"kind":"string","value":"brio"}`.
- T14 (`test_migration_deletes_flat_file`): asserts file exists before migration, absent after.
- T15 (`test_migration_noop_when_no_flat_file`): no flat file created; both defaults GET endpoints return 404.
- T16 (`test_defaults_layout_put_then_get`): PUT `{"kind":"json","value":{...}}` to `dev.tugtool.deck.layout/layout`, GET back and verify round-trip.
- T17 (`test_defaults_theme_put_then_get`): PUT `{"kind":"string","value":"bluenote"}` to `dev.tugtool.app/theme`, GET back and verify.
- Total tests after step: 202 (up from 197).

## Checkpoint 1: Full tugcast test suite

**Command:** `cd tugcode && cargo nextest run -p tugcast`

```
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.94s
────────────
 Nextest run ID e25bdd68-b82e-40d7-a314-a2d66fab057d with nextest profile: default
    Starting 202 tests across 1 binary (4 tests skipped)
────────────
     Summary [   4.575s] 202 tests run: 202 passed, 4 skipped
```

**Result:** PASSED — 202 tests passed, 4 skipped

## Checkpoint 2: Zero warnings

**Command:** `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning`

```
0
```

**Result:** PASSED — 0 warnings
