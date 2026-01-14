# Phase 18B Step 5: Write Amplification + Incremental Updates

## Overview

**Objective:** Complete write amplification measurement, add key-index tracking, enable true partial updates from stored arbors, and add regression protection.

**Closes Requirements:** Reasonable write amp + incremental updates, Performance gates

**Gates:**
- **Gate E**: Updating 1–5% of rows causes write amplification ≤ 1.5× the rewritten batch bytes
  - Ratio formula: `(dict + key_index + batch) / batch` (meta excluded as fixed txn overhead)
  - Enforcement: **Recorded baseline** (track trend, alert on regression, don't fail CI)
- **Gate J**: Repeating identical write txn produces ~0 batch rewrites

---

## Current State Analysis

### Already Implemented ✅

| Component | Status | Location |
|-----------|--------|----------|
| WriteStats instrumentation | ✅ | `lib.rs:455-475` (missing key-index) |
| Digest-based batch skipping | ✅ | `put_with_stats()` logic |
| `test_put_unchanged_arbor_writes_zero_batches` | ✅ Gate J test | `lib.rs:7762-7799` |
| `test_put_single_tree_update_writes_one_batch` | ✅ Gate E test (same arbor) | `lib.rs:7802-7839` |
| `test_put_insert_tree_writes_suffix_only` | ✅ | `lib.rs:7842-7880` |
| `test_put_delete_tree_writes_suffix_only` | ✅ | `lib.rs:7883-7920` |
| `bench_write_amplification` | ✅ Gate J bench (registered in criterion_group) | `arborbase_bench.rs:484-539` |
| `bench_incremental_put_one_tree` | ⚠️ Mislabeled as Gate E (is actually Gate J scenario) | `arborbase_bench.rs:448-480` |
| Python `test_stored_arbor_modify_and_save` | ✅ | `test_arbor_base.py` |

### Gaps to Fill

| Gap | Impact | Priority |
|-----|--------|----------|
| WriteStats missing `key_index_bytes_written` | Under-reports write amp | HIGH |
| Key-index always rewritten (even when dict unchanged) | Unnecessary write amp | HIGH |
| No true "partial update from stored arbor" test | Gate E unvalidated | HIGH |
| No explicit close/reopen in incremental tests | Persistence unvalidated | MEDIUM |
| `bench_incremental_put_one_tree` is mislabeled | Confusing | LOW |

---

## Implementation Plan

### Phase 1: Add Key-Index Instrumentation to WriteStats

**File:** `crates/arbors-base/src/lib.rs`

**1a. Extend WriteStats struct** (around line 455):
```rust
pub struct WriteStats {
    pub dict_bytes_written: usize,
    pub meta_bytes_written: usize,
    pub batch_bytes_written: usize,
    pub batches_written: u32,
    pub batches_skipped: u32,
    pub suffix_batches_deleted: u32,
    pub key_index_bytes_written: usize,  // NEW
}

impl WriteStats {
    pub fn total_bytes_written(&self) -> usize {
        self.dict_bytes_written + self.meta_bytes_written +
        self.batch_bytes_written + self.key_index_bytes_written
    }
}
```

**1b. Conditionally rebuild key-index** (around line 3817):

Skip key-index writes only when ALL conditions met:
- dict unchanged (`dict_bytes_written == 0`)
- key_index_digest matches dict_digest (index is current)
- key index table exists

When dict changes, **delete old entries by dataset prefix first**, then insert new:
```rust
// Determine if key index needs rebuild
let needs_key_index_rebuild = dict_bytes_written > 0
    || !old_meta.key_index_valid()  // key_index_digest != dict_digest
    || !key_index_table_exists;

if needs_key_index_rebuild {
    let mut key_index_table = self.txn.open_table(ARBOR_KEY_INDEX)?;

    // Step 1: Delete old entries for this dataset (by prefix)
    let prefix = encode_key_index_key(name, "");
    let keys_to_delete: Vec<_> = key_index_table
        .range::<&[u8]>(prefix.as_slice()..)
        .filter(|r| r.as_ref().map(|(k, _)| k.value().starts_with(&prefix)).unwrap_or(false))
        .filter_map(|r| r.ok().map(|(k, _)| k.value().to_vec()))
        .collect();
    for key in keys_to_delete {
        let _ = key_index_table.remove(key.as_slice());
    }

    // Step 2: Insert new entries
    let mut key_index_bytes = 0usize;
    for i in 0..dict_v2.len {
        if let Some(key_string) = interner.resolve(InternId(i as u32)) {
            let key = encode_key_index_key(name, key_string);
            let value = encode_key_index_value(InternId(i as u32));
            key_index_bytes += key.len() + value.len();
            key_index_table.insert(key.as_slice(), value.as_slice())?;
        }
    }
    key_index_bytes_written = key_index_bytes;
} else {
    // Dict unchanged AND index valid → skip writes
    key_index_bytes_written = 0;
}
```

**1c. Return key_index_bytes_written in WriteStats** (deletes not counted).

### Phase 2: Add Interner Sharing APIs

**Note:** `Arbor::interner()` already exists and returns `&StringInterner`. The `interner_arc()` method is **optional** (only add if we need Arc sharing for other purposes).

**File:** `crates/arbors-storage/src/lib.rs`

**(Optional)** Add method to expose the Arc:
```rust
impl Arbor {
    /// Returns the shared interner Arc for use in building modified arbors.
    /// Note: `interner()` returning `&StringInterner` is already available.
    pub fn interner_arc(&self) -> Arc<StringInterner> {
        Arc::clone(&self.interner)
    }
}
```

**File:** `crates/arbors-storage/src/interner.rs`

Add constructor to create builder from existing interner:
```rust
impl StringInternerBuilder {
    /// Create a builder from an existing interner, preserving all interned strings.
    /// New strings can be added; existing strings retain their InternId.
    pub fn from_interner(interner: &StringInterner) -> Self {
        let len = interner.len();
        let mut builder = StringBuilder::with_capacity(len, 0);
        let mut lookup = HashMap::with_capacity(len);
        let mut strings_for_collision_check = Vec::with_capacity(len);

        for i in 0..len {
            let id = InternId(i as u32);
            if let Some(s) = interner.resolve(id) {
                builder.append_value(s);
                lookup.insert(hash_string(s), id);
                strings_for_collision_check.push(s.to_string());
            }
        }

        Self {
            builder,
            lookup,
            strings_for_collision_check,
        }
    }
}
```

**File:** `crates/arbors-io/src/builder.rs`

Add constructor that accepts existing interner:
```rust
impl ArborBuilder {
    /// Create a schemaless builder that reuses an existing interner.
    /// This is essential for partial updates where unchanged batches
    /// should have identical digests.
    pub fn new_schemaless_with_interner(interner: &StringInterner) -> Self {
        Self {
            schema: None,
            nodes: Vec::new(),
            roots: Vec::new(),
            interner: StringInternerBuilder::from_interner(interner),
            pools: PrimitivePools::new(),
        }
    }
}
```

### Phase 3: Add True Gate E Test (Partial Update from Stored Arbor)

**File:** `crates/arbors-base/src/lib.rs` (test section)

```rust
#[test]
fn test_partial_update_from_stored_arbor_rewrites_one_batch() {
    use arbors_io::ArborBuilder;

    let tmpdir = tempfile::TempDir::new().unwrap();
    let db_path = tmpdir.path().join("test.arbors");
    let options = ArborStoreOptions::default().with_batch_sizes(5, 5);

    // Create initial arbor: 20 trees → 4 batches
    let arbor = create_test_arbor(20);

    // Store initial and close
    {
        let base = ArborStore::open(&db_path, options.clone()).unwrap();
        let txn = base.begin_write().unwrap();
        txn.put("data", &arbor).unwrap();
        txn.commit().unwrap();
    }

    // Reopen, load, modify, re-put
    {
        let base = ArborStore::open(&db_path, options.clone()).unwrap();

        // Load from DB
        let loaded: Arbor = {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("data").unwrap().unwrap();
            batched.materialize().unwrap()
        };

        // Build modified arbor WITH SAME INTERNER
        let mut builder = ArborBuilder::new_schemaless_with_interner(loaded.interner());
        for i in 0..20 {
            if i == 2 {
                // Modify tree at index 2 (in batch 0)
                let json = format!(r#"{{"id": {}, "name": "MODIFIED{}"}}"#, i, i);
                builder.add_json(json.as_bytes()).unwrap();
            } else {
                let json = format!(r#"{{"id": {}, "name": "item{}"}}"#, i, i);
                builder.add_json(json.as_bytes()).unwrap();
            }
        }
        let modified_arbor = builder.finish();

        // Re-put and check write stats
        let txn = base.begin_write().unwrap();
        let stats = txn.put_with_stats("data", &modified_arbor).unwrap();
        txn.commit().unwrap();

        // Gate E: Only batch 0 should be rewritten (contains modified tree)
        assert_eq!(stats.batches_written, 1, "Gate E: only 1 batch should be rewritten");
        assert_eq!(stats.batches_skipped, 3, "Gate E: 3 batches should be skipped");
        assert_eq!(stats.dict_bytes_written, 0, "Gate E: dict unchanged");
        assert_eq!(stats.key_index_bytes_written, 0, "Gate E: key index unchanged");
    }

    // Reopen and verify data integrity
    {
        let base = ArborStore::open(&db_path, options.clone()).unwrap();
        let txn = base.begin_read().unwrap();
        let batched = txn.get_batched("data").unwrap().unwrap();
        let arbor = batched.materialize().unwrap();

        assert_eq!(arbor.tree_count(), 20);
        // Verify modified tree
        // ... (add specific assertions)
    }
}
```

### Phase 4: Fix Benchmark Methodology and Labeling

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

**4a. Rename `bench_incremental_put_one_tree` to `bench_gate_j_noop_reput`** (it's actually a Gate J scenario).

**4b. Add true Gate E benchmark** (partial update with shared interner):

**CRITICAL:** Use A/B alternation pattern to avoid the "after iteration 1 it's a no-op" problem:
```rust
fn bench_gate_e_partial_update(c: &mut Criterion) {
    // Setup: create and store initial arbor ONCE (outside iter)
    let tmpdir = TempDir::new().unwrap();
    let db_path = tmpdir.path().join("test.arbors");
    let options = ArborStoreOptions::default().with_batch_sizes(1000, 1000);

    // Pre-build two versions: A (original) and B (modified)
    let arbor_a = create_players_arbor(5000);  // 5 batches
    {
        let base = ArborStore::open(&db_path, options.clone()).unwrap();
        let txn = base.begin_write().unwrap();
        txn.put("players", &arbor_a).unwrap();
        txn.commit().unwrap();
    }

    // Load and get interner for building modified arbors
    let base = ArborStore::open(&db_path, options.clone()).unwrap();
    let loaded = {
        let txn = base.begin_read().unwrap();
        let batched = txn.get_batched("players").unwrap().unwrap();
        batched.materialize().unwrap()
    };
    let interner = loaded.interner();

    // Build arbor_b with ~5% modifications using same interner
    let arbor_b = build_modified_arbor_with_interner(5000, 250, interner);

    // Track which version is currently in DB
    let mut is_a = true;

    let mut group = c.benchmark_group("phase18_gate_e");
    group.bench_function("partial_update_5pct_alternating", |b| {
        b.iter(|| {
            // Alternate A→B→A→B to ensure each iteration is a real partial update
            let to_write = if is_a { &arbor_b } else { &arbor_a };
            is_a = !is_a;

            let txn = base.begin_write().unwrap();
            let stats = txn.put_with_stats("players", to_write).unwrap();
            txn.commit().unwrap();

            // Record stats (no hard assert, just for baseline tracking)
            // Gate E ratio = (dict + key_index + batch) / batch
            stats
        });
    });
    group.finish();
}
```

**4c. Fix benchmark setup** to avoid creating TempDir inside `b.iter()`.

### Phase 5: Add Close/Reopen Tests

**File:** `python/tests/test_arbor_base.py`

**Note:** Use `arbors.read_jsonl()` (not `Arbor.from_json()` which doesn't exist in Python API).

```python
import json

class TestIncrementalUpdatesCloseReopen:
    def test_reopen_after_incremental_update_is_correct(self, tmp_path):
        """Verify data integrity after close/reopen cycle."""
        db_path = tmp_path / "incremental.arbors"

        # Create initial data as JSONL bytes
        initial_data = [{"id": i, "name": f"item{i}"} for i in range(100)]
        jsonl_bytes = "\n".join(json.dumps(d) for d in initial_data).encode()
        arbor1 = arbors.read_jsonl(jsonl_bytes)

        base = arbors.ArborStore.open(str(db_path))
        with base.begin_write() as txn:
            txn.put("data", arbor1)
        base.close()  # Explicit close

        # Modify and re-store
        modified_data = initial_data.copy()
        modified_data[50] = {"id": 50, "name": "MODIFIED"}
        jsonl_bytes2 = "\n".join(json.dumps(d) for d in modified_data).encode()
        arbor2 = arbors.read_jsonl(jsonl_bytes2)

        base = arbors.ArborStore.open(str(db_path))  # Reopen
        with base.begin_write() as txn:
            txn.put("data", arbor2)
        base.close()  # Explicit close

        # Reopen and verify
        base = arbors.ArborStore.open(str(db_path))  # Fresh reopen
        with base.begin_read() as txn:
            batched = txn.get("data")
            arbor = batched.materialize()

            assert arbor[0]["id"].value() == 0
            assert arbor[0]["name"].value() == "item0"
            assert arbor[50]["id"].value() == 50
            assert arbor[50]["name"].value() == "MODIFIED"
            assert len(arbor) == 100
        base.close()
```

### Phase 6: Run Gates and Record Results

```bash
# Run all Phase 18 benchmarks
cargo bench -p arbors-base --bench arborbase_bench -- phase18

# Run Rust tests
cargo test -p arbors-base -- incremental

# Run Python tests
.venv/bin/pytest python/tests/test_arbor_base.py -v -k "incremental or close_reopen"
```

Record results in `benchmarks/baselines/phase18.json`.

---

## Test Mapping (Step 5 Requirements → Tests)

| Requirement | Test | Status |
|-------------|------|--------|
| `test_incremental_update_only_rewrites_changed_batches` | `test_put_single_tree_update_writes_one_batch` (existing) + `test_partial_update_from_stored_arbor_rewrites_one_batch` (new) | ✅ existing + NEW |
| `test_noop_write_skips_batch_rewrites` | `test_put_unchanged_arbor_writes_zero_batches` | ✅ existing |
| `test_reopen_after_incremental_update_is_correct` | Python test (new) | NEW |
| Gate E benchmark | `bench_gate_e_partial_update` | NEW (rename existing) |
| Gate J benchmark | `bench_write_amplification` (existing) + `bench_gate_j_noop_reput` (renamed) | ✅ existing + rename |

---

## Critical Files

| File | Changes |
|------|---------|
| `crates/arbors-base/src/lib.rs` | Add `key_index_bytes_written` to WriteStats; skip key-index when dict unchanged; add Gate E test |
| `crates/arbors-storage/src/lib.rs` | Add `Arbor::interner_arc()` |
| `crates/arbors-storage/src/interner.rs` | Add `StringInternerBuilder::from_interner()` |
| `crates/arbors-io/src/builder.rs` | Add `ArborBuilder::new_schemaless_with_interner()` |
| `crates/arbors-base/benches/arborbase_bench.rs` | Rename mislabeled bench; add true Gate E bench; fix methodology |
| `python/tests/test_arbor_base.py` | Add close/reopen test |
| `benchmarks/baselines/phase18.json` | Record Gate E/J results |

---

## Exit Criteria

- [x] Incremental update mechanics implemented (digests + skip-unchanged)
- [x] WriteStats instrumentation (dict/meta/batch)
- [x] Rust tests for unchanged/modified/insert/delete scenarios
- [ ] `key_index_bytes_written` added to WriteStats
- [ ] Key-index writes skipped when dict unchanged AND index valid
- [ ] Key-index stale entries deleted when dict changes (by prefix)
- [ ] `StringInternerBuilder::from_interner()` added
- [ ] `ArborBuilder::new_schemaless_with_interner()` added
- [ ] (Optional) `Arbor::interner_arc()` added if needed
- [ ] Gate E test: partial update from stored arbor rewrites only affected batch
- [ ] Gate E benchmark: A/B alternating pattern, ratio tracked (no hard assert)
- [ ] Gate J benchmark: no-op write produces 0 batch/dict/key-index rewrites
- [ ] Python close/reopen test passes (uses `read_jsonl()`)
- [ ] Gate E/J results recorded in baselines

---

## Execution Summary

| Phase | What | Effort |
|-------|------|--------|
| 1 | Key-index instrumentation + skip logic | Medium - 1 file, ~40 lines |
| 2 | Interner sharing APIs | Medium - 3 files, ~50 lines |
| 3 | True Gate E test | Medium - 1 file, ~60 lines |
| 4 | Fix benchmarks (rename + add + methodology) | Medium - 1 file, ~80 lines |
| 5 | Python close/reopen test | Small - 1 file, ~30 lines |
| 6 | Run gates, record results | Verification only |

**Total estimated effort:** ~260 lines of new/changed code across 6 files
