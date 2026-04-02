//! Multi-thread writer contention integration tests for tugbank-core.
//!
//! Each test opens the same database file from two separate `DefaultsStore`
//! instances (each with its own SQLite connection). Stores are opened
//! sequentially on the main thread so WAL initialisation completes before
//! the threads begin — this avoids a transient `SQLITE_BUSY` that can occur
//! when two connections race to set up WAL at the exact same moment.
//! After both stores exist, they are wrapped in `Arc` and moved into threads,
//! exploiting `DefaultsStore: Send + Sync`.

use std::sync::{Arc, Barrier};

use tempfile::NamedTempFile;
use tugbank_core::{DefaultsStore, SetOutcome, Value};

// ── T39 & T40: concurrent set() from two threads, all keys present ────────────

/// T39: concurrent `set()` from two threads to the same domain completes
/// without errors.
///
/// T40: after both threads join, all 100 keys (50 per thread) are present.
#[test]
fn test_concurrent_set_completes_and_all_keys_present() {
    let tmp = NamedTempFile::new().expect("temp file");

    // Open both stores sequentially so WAL initialisation is complete before
    // the threads start. Both connections share the same underlying file.
    let store_a = Arc::new(DefaultsStore::open(tmp.path()).expect("store A open"));
    let store_b = Arc::new(DefaultsStore::open(tmp.path()).expect("store B open"));

    let handle_a = {
        let store = Arc::clone(&store_a);
        std::thread::spawn(move || {
            let h = store.domain("shared").expect("domain");
            for i in 0u32..50 {
                h.set(&format!("a-key-{i}"), Value::I64(i as i64))
                    .expect("thread A set");
            }
        })
    };

    let handle_b = {
        let store = Arc::clone(&store_b);
        std::thread::spawn(move || {
            let h = store.domain("shared").expect("domain");
            for i in 0u32..50 {
                h.set(&format!("b-key-{i}"), Value::I64(i as i64))
                    .expect("thread B set");
            }
        })
    };

    handle_a.join().expect("thread A panicked");
    handle_b.join().expect("thread B panicked");

    // T40: verify all 100 keys are present via a fresh read on store_a.
    let h = store_a.domain("shared").expect("domain");
    for i in 0u32..50 {
        assert_eq!(
            h.get(&format!("a-key-{i}")).expect("get a"),
            Some(Value::I64(i as i64)),
            "missing a-key-{i}"
        );
        assert_eq!(
            h.get(&format!("b-key-{i}")).expect("get b"),
            Some(Value::I64(i as i64)),
            "missing b-key-{i}"
        );
    }
}

// ── T41 & T42: set_if_generation contention ───────────────────────────────────

/// T41: two threads both read `generation()`, synchronize at a `Barrier(2)`,
/// then both attempt `set_if_generation` with the same stale generation value.
/// Exactly one gets `Written` and the other gets `Conflict`.
///
/// T42: the thread that got `Conflict` re-reads generation and retries
/// `set_if_generation` successfully.
#[test]
fn test_set_if_generation_contention_exactly_one_wins() {
    let tmp = NamedTempFile::new().expect("temp file");

    // Seed the domain so both stores start from a known generation.
    let seed_store = DefaultsStore::open(tmp.path()).expect("seed open");
    {
        let h = seed_store.domain("cas-domain").expect("domain");
        h.set("seed", Value::Bool(true)).expect("seed set");
        assert_eq!(h.generation().expect("generation"), 1);
    }
    drop(seed_store);

    // Open both stores sequentially before threading.
    let store_a = Arc::new(DefaultsStore::open(tmp.path()).expect("store A open"));
    let store_b = Arc::new(DefaultsStore::open(tmp.path()).expect("store B open"));

    // Barrier ensures both threads read generation before either writes.
    let barrier = Arc::new(Barrier::new(2));

    let handle_a = {
        let store = Arc::clone(&store_a);
        let bar = Arc::clone(&barrier);
        std::thread::spawn(move || -> SetOutcome {
            let h = store.domain("cas-domain").expect("domain");
            let g = h.generation().expect("read generation");
            bar.wait(); // both threads hold the same g before proceeding
            h.set_if_generation("cas-key", Value::I64(100), g)
                .expect("set_if_generation A")
        })
    };

    let handle_b = {
        let store = Arc::clone(&store_b);
        let bar = Arc::clone(&barrier);
        std::thread::spawn(move || -> SetOutcome {
            let h = store.domain("cas-domain").expect("domain");
            let g = h.generation().expect("read generation");
            bar.wait(); // both threads hold the same g before proceeding
            h.set_if_generation("cas-key", Value::I64(200), g)
                .expect("set_if_generation B")
        })
    };

    let outcome_a = handle_a.join().expect("thread A panicked");
    let outcome_b = handle_b.join().expect("thread B panicked");

    // Exactly one must be Written; the other must be Conflict.
    let (_winner, loser) = match (&outcome_a, &outcome_b) {
        (SetOutcome::Written, SetOutcome::Conflict { .. }) => (&outcome_a, &outcome_b),
        (SetOutcome::Conflict { .. }, SetOutcome::Written) => (&outcome_b, &outcome_a),
        _ => panic!(
            "expected exactly one Written and one Conflict, \
             got: {outcome_a:?} and {outcome_b:?}"
        ),
    };

    assert!(
        matches!(loser, SetOutcome::Conflict { current_generation: g } if *g > 1),
        "loser Conflict should carry a generation > 1, got: {loser:?}"
    );

    // T42: re-read generation and retry — must succeed.
    let h = store_a.domain("cas-domain").expect("domain");
    let current_g = h.generation().expect("retry read generation");
    let retry = h
        .set_if_generation("cas-key", Value::I64(999), current_g)
        .expect("retry set_if_generation");
    assert_eq!(
        retry,
        SetOutcome::Written,
        "retry after Conflict should succeed"
    );
    assert_eq!(
        h.get("cas-key").expect("final get"),
        Some(Value::I64(999)),
        "retry value should be present"
    );
}
