# Step 1: Add migration module to tugcast

## Files Created

- `tugcode/crates/tugcast/src/migration.rs`

## Files Modified

- `tugcode/crates/tugcast/src/main.rs` — added `mod migration;` declaration

## Implementation Notes

- `migrate_settings_to_tugbank(source_tree, store)` reads `.tugtool/deck-settings.json`, writes `layout` as `Value::Json` to domain `dev.tugtool.deck.layout` and `theme` as `Value::String` to domain `dev.tugtool.app`, then deletes the flat file unconditionally.
- Corrupt/unparseable flat file logs a `warn!` and writes nothing; file is still deleted to prevent repeated warnings on every startup (R01 mitigation).
- Empty JSON `{}` is handled gracefully — no keys written, file deleted.
- Function is marked `#[allow(dead_code)]` because the call site is wired in Step 2.
- All 6 unit tests (T01–T06) are included in `migration.rs`.

## Checkpoint 1: Migration tests

**Command:** `cd tugcode && cargo nextest run -p tugcast --filter-expr 'test(migrate)'`

```
   Compiling tugcast v0.1.0 (crates/tugcast)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.70s
────────────
 Nextest run ID 0b0c082a-9da5-4b6f-90e0-eaeb929e4701 with nextest profile: default
    Starting 6 tests across 1 binary (212 tests skipped)
────────────
     Summary [   0.016s] 6 tests run: 6 passed, 212 skipped
```

**Result:** PASSED — 6 tests passed (T01 through T06)

## Checkpoint 2: Zero warnings

**Command:** `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning`

```
0
```

**Result:** PASSED — 0 warnings
