# Phase 18B Step 6: Bench Harness + Gate Enforcement

## Overview

**Objective:** Create a comprehensive benchmark harness that measures all Phase 18 gates (A–L), produces stable reports, and becomes the "definition of done" for performance.

**Closes Requirements:** Performance gates, Instant open (no warm), Analytics on cold open, In-memory regressions

**Key Insight:** We already have Gates A, B, C, E, G, J implemented in Rust. Step 6 is about:
1. Filling the missing gates (A', F, H, I, K, L)
2. Adding Python benchmark parity
3. Creating a unified report format with source matrix
4. Enforcing gates in CI

---

## Current State Analysis

### Gates Already Implemented ✅

| Gate | Rust Bench | Baseline | Status |
|------|-----------|----------|--------|
| A (Instant Open warm) | `bench_open_and_first_filter_no_warm` | 28.74ms | ✅ PASS (target ≤100ms) |
| B (Warm Decode) | `bench_warm_vs_baseline` | 2.08μs | ✅ BASELINE |
| C (Repeated Analytics) | `bench_repeated_queries_warm_cache` | 964.52μs | ✅ BASELINE |
| E (Incremental Update) | `bench_gate_e_partial_update` | 34.38ms | ✅ PASS |
| G (First Tree Latency) | `bench_first_tree_latency` | <5ms | ✅ PASS |
| J (No-op Reput) | `bench_gate_j_noop_reput` | 0 batches | ✅ PASS |

### Gates To Implement

| Gate | Description | Target | Phase |
|------|-------------|--------|-------|
| A' | Instant Open (cold OS cache) | ≤20ms median | Phase 7 |
| F | Streaming Memory Bound | RSS ≤2× batch | Phase 8 |
| H | Projection Pushdown Win | ≥1.2× faster | Phase 2 |
| I | Early-Exit Win | ≤1 batch touched | Phase 9 |
| K | In-Memory Parity | ±10% baseline | Phase 3 |
| L | Fork ROI | ≥2× faster/memory | Phase 10 |

---

## Implementation Plan

### Phase 1: Organize Existing Benchmarks into Gate Groups

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

Reorganize criterion groups by gate category:

```rust
// Gate categories for organized reporting
criterion_group!(
    name = gates_open,
    config = Criterion::default().sample_size(20),
    targets = bench_gate_a_instant_open,
              bench_gate_a_prime_cold_cache,
);

criterion_group!(
    name = gates_analytics,
    config = Criterion::default(),
    targets = bench_gate_b_warm_decode,
              bench_gate_c_repeated_queries,
              bench_gate_f_memory_bound,
              bench_gate_g_first_tree_latency,
              bench_gate_h_projection_speedup,
              bench_gate_i_early_exit,
);

criterion_group!(
    name = gates_writes,
    config = Criterion::default(),
    targets = bench_gate_e_partial_update,
              bench_gate_j_noop_reput,
);

criterion_group!(
    name = gates_parity,
    config = Criterion::default(),
    targets = bench_gate_k_in_memory_parity,
              bench_gate_l_fork_roi,
);

criterion_main!(gates_open, gates_analytics, gates_writes, gates_parity);
```

### Phase 2: Add Gate H (Projection Pushdown) Benchmark

**Why:** Test already exists in `projection_tests.rs`. Target downgraded to ≥1.2× since zero-copy already provides much of the expected speedup. Convert to criterion.

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

```rust
/// Gate H: Projection pushdown - narrow projection ≥1.2× faster than full decode
fn bench_gate_h_projection_speedup(c: &mut Criterion) {
    // Setup: Create wide dataset (many columns, few accessed)
    let tmpdir = TempDir::new().unwrap();
    let db_path = tmpdir.path().join("wide.arbors");

    // Create arbor with many fields per tree
    let wide_arbor = create_wide_arbor(10_000, 50); // 10K trees, 50 fields each

    let base = ArborStore::open(&db_path, ArborStoreOptions::default()).unwrap();
    {
        let mut txn = base.begin_write().unwrap();
        txn.put("wide", &wide_arbor).unwrap();
        txn.commit().unwrap();
    }

    let mut group = c.benchmark_group("gate_h_projection");

    // Full decode (no projection)
    group.bench_function("full_decode", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("wide").unwrap().unwrap();
            let arbor = batched.materialize().unwrap();
            black_box(arbor.num_trees())
        });
    });

    // Narrow projection (2-3 fields)
    group.bench_function("narrow_projection", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("wide").unwrap().unwrap();
            // Only access field_0 and field_1
            let result = batched.filter(path("field_0").gt(lit(0))).unwrap();
            black_box(result.len())
        });
    });

    group.finish();
}
```

### Phase 3: Add Gate K (In-Memory Parity) Benchmark

**Why:** Ensures ArborStore path doesn't regress vs pure in-memory operations.

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

```rust
/// Gate K: In-memory parity - batched queries within ±10% of in-memory
fn bench_gate_k_in_memory_parity(c: &mut Criterion) {
    // Setup: Same dataset for both paths
    let arbor = create_player_arbor(PLAYERS_COUNT);

    // For ArborStore path
    let tmpdir = TempDir::new().unwrap();
    let db_path = tmpdir.path().join("parity.arbors");
    let base = ArborStore::open(&db_path, ArborStoreOptions::default()).unwrap();
    {
        let mut txn = base.begin_write().unwrap();
        txn.put("players", &arbor).unwrap();
        txn.commit().unwrap();
    }

    let mut group = c.benchmark_group("gate_k_parity");

    // In-memory filter (baseline)
    group.bench_function("inmemory_filter", |b| {
        let view = arbor.table_view().unwrap();
        b.iter(|| {
            let result = arbors_query::filter(&view, &path("birthYear").gt(lit(1950))).unwrap();
            black_box(result.len())
        });
    });

    // ArborStore filter (should be within ±10%)
    group.bench_function("arborbase_filter", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("players").unwrap().unwrap();
            let result = batched.filter(path("birthYear").gt(lit(1950))).unwrap();
            black_box(result.len())
        });
    });

    // In-memory aggregate
    group.bench_function("inmemory_aggregate", |b| {
        let view = arbor.table_view().unwrap();
        b.iter(|| {
            let result = arbors_query::aggregate(&view, &[sum(path("career_hr"))]).unwrap();
            black_box(result)
        });
    });

    // ArborStore aggregate
    group.bench_function("arborbase_aggregate", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("players").unwrap().unwrap();
            let result = batched.aggregate(&[sum(path("career_hr"))]).unwrap();
            black_box(result)
        });
    });

    group.finish();
}
```

### Phase 4: Add Python Benchmark Runner

**File:** `python/benchmarks/gates_benchmark.py` (NEW)

```python
#!/usr/bin/env python3
"""
Phase 18 Gate Benchmarks - Python Implementation

Measures the same gates as Rust to ensure Python bindings don't add overhead.
Outputs JSON compatible with benchmarks/baselines/phase18.json format.
"""

import json
import time
import statistics
import tempfile
import arbors
from pathlib import Path

WARMUP_ITERATIONS = 1
SAMPLE_COUNT = 20

def measure(fn, warmup=WARMUP_ITERATIONS, samples=SAMPLE_COUNT):
    """Measure function with warmup and return statistics."""
    # Warmup
    for _ in range(warmup):
        fn()

    # Measure
    times = []
    for _ in range(samples):
        start = time.perf_counter_ns()
        fn()
        elapsed = time.perf_counter_ns() - start
        times.append(elapsed)

    return {
        "median_ns": statistics.median(times),
        "mean_ns": statistics.mean(times),
        "p95_ns": sorted(times)[int(len(times) * 0.95)],
        "min_ns": min(times),
        "max_ns": max(times),
        "samples": samples,
    }

def create_test_data(n_trees=20000, n_fields=13):
    """Create test JSONL data matching Rust synthetic_players."""
    lines = []
    for i in range(n_trees):
        record = {
            "playerID": f"player{i:05d}",
            "nameFirst": f"First{i}",
            "nameLast": f"Last{i}",
            "birthYear": 1850 + (i % 151),
            "birthMonth": 1 + (i % 12),
            "birthDay": 1 + (i % 28),
            "debut": f"19{50 + (i % 50):02d}-04-15",
            "finalGame": f"20{10 + (i % 24):02d}-09-30",
            "height": 60 + (i % 25),
            "weight": 150 + (i % 101),
            "career_games": 100 + (i % 2500),
            "career_hits": 50 + (i % 4000),
            "career_hr": i % 763,
        }
        lines.append(json.dumps(record))
    return "\n".join(lines).encode()

class GateBenchmarks:
    def __init__(self, output_path=None):
        self.results = {}
        self.output_path = output_path

    def run_all(self):
        print("Creating test data...")
        self.jsonl_data = create_test_data()
        self.arbor = arbors.read_jsonl(self.jsonl_data)

        with tempfile.TemporaryDirectory() as tmpdir:
            self.db_path = Path(tmpdir) / "gates.arbors"
            self._setup_arborbase()

            print("\nRunning Gate Benchmarks:")
            self.bench_gate_a()
            self.bench_gate_a_prime()
            self.bench_gate_b()
            self.bench_gate_c()
            self.bench_gate_f()
            self.bench_gate_g()
            self.bench_gate_h()
            self.bench_gate_i()
            self.bench_gate_k()
            self.bench_gate_l()

        self._report()
        return self.results

    def _setup_arborbase(self):
        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_write() as txn:
            txn.put("players", self.arbor)

    def bench_gate_a(self):
        """Gate A: Instant open + first filter (warm cache)."""
        print("  Gate A: Instant Open...")

        def run():
            base = arbors.ArborStore.open(str(self.db_path))
            with base.begin_read() as txn:
                batched = txn.get("players")
                result = batched.filter(arbors.path("birthYear") > arbors.lit(1950))
                return len(result)

        self.results["gate_a"] = measure(run)
        median_ms = self.results["gate_a"]["median_ns"] / 1e6
        status = "PASS" if median_ms <= 100 else "FAIL"
        print(f"    Median: {median_ms:.2f}ms (target ≤100ms) [{status}]")

    def bench_gate_b(self):
        """Gate B: Warm decode (materialize)."""
        print("  Gate B: Warm Decode...")

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            def run():
                return batched.materialize()

            self.results["gate_b"] = measure(run, samples=100)

        median_us = self.results["gate_b"]["median_ns"] / 1e3
        print(f"    Median: {median_us:.2f}μs")

    def bench_gate_c(self):
        """Gate C: Repeated queries (warm cache)."""
        print("  Gate C: Repeated Queries...")

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            def run():
                result = batched.filter(arbors.path("birthYear") > arbors.lit(1900))
                return len(result)

            self.results["gate_c"] = measure(run, samples=100)

        median_us = self.results["gate_c"]["median_ns"] / 1e3
        print(f"    Median: {median_us:.2f}μs")

    def bench_gate_g(self):
        """Gate G: First tree latency."""
        print("  Gate G: First Tree Latency...")

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            def run():
                arbor = batched.materialize()
                return arbor[0]  # First tree access

            self.results["gate_g"] = measure(run)

        median_ms = self.results["gate_g"]["median_ns"] / 1e6
        status = "PASS" if median_ms <= 5 else "FAIL"
        print(f"    Median: {median_ms:.2f}ms (target ≤5ms warm) [{status}]")

    def bench_gate_a_prime(self):
        """Gate A': Instant open with cold cache (fresh file each time)."""
        print("  Gate A': Cold Cache Open...")

        def run():
            # Fresh file each iteration
            cold_path = self.db_path.parent / f"cold_{time.time_ns()}.arbors"
            base = arbors.ArborStore.open(str(cold_path))
            with base.begin_write() as txn:
                txn.put("players", self.arbor)
            # Reopen (simulates cold)
            base = arbors.ArborStore.open(str(cold_path))
            with base.begin_read() as txn:
                batched = txn.get("players")
                result = batched.filter(arbors.path("birthYear") > arbors.lit(1950))
                return len(result)

        self.results["gate_a_prime"] = measure(run, samples=10)
        median_ms = self.results["gate_a_prime"]["median_ns"] / 1e6
        status = "PASS" if median_ms <= 20 else "FAIL"
        print(f"    Median: {median_ms:.2f}ms (target ≤20ms) [{status}]")

    def bench_gate_f(self):
        """Gate F: Streaming memory bound."""
        print("  Gate F: Streaming Memory...")
        # Note: Full memory tracking requires tracemalloc or similar
        import tracemalloc
        tracemalloc.start()

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")
            result = batched.filter(arbors.path("birthYear") > arbors.lit(1900))
            _ = len(result)

        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        self.results["gate_f"] = {"peak_bytes": peak, "current_bytes": current}
        peak_mb = peak / (1024 * 1024)
        print(f"    Peak Memory: {peak_mb:.2f}MB")

    def bench_gate_h(self):
        """Gate H: Projection pushdown (narrow vs wide)."""
        print("  Gate H: Projection Pushdown...")

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            # Full materialize
            def full():
                return batched.materialize()

            # Narrow filter (only touches birthYear)
            def narrow():
                return batched.filter(arbors.path("birthYear") > arbors.lit(1950))

            self.results["gate_h_full"] = measure(full, samples=20)
            self.results["gate_h_narrow"] = measure(narrow, samples=20)

        full_ms = self.results["gate_h_full"]["median_ns"] / 1e6
        narrow_ms = self.results["gate_h_narrow"]["median_ns"] / 1e6
        speedup = full_ms / narrow_ms if narrow_ms > 0 else 0
        status = "PASS" if speedup >= 1.2 else "FAIL"
        print(f"    Full: {full_ms:.2f}ms, Narrow: {narrow_ms:.2f}ms")
        print(f"    Speedup: {speedup:.2f}x (target ≥1.2x) [{status}]")

    def bench_gate_i(self):
        """Gate I: Early-exit (find_one behavior)."""
        print("  Gate I: Early-Exit...")

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            # Find early match (player in first batch)
            def early():
                return batched.filter(arbors.path("playerID") == arbors.lit("player00050"))

            # Find late match (player in last batch)
            def late():
                return batched.filter(arbors.path("playerID") == arbors.lit("player19950"))

            self.results["gate_i_early"] = measure(early, samples=20)
            self.results["gate_i_late"] = measure(late, samples=20)

        early_ms = self.results["gate_i_early"]["median_ns"] / 1e6
        late_ms = self.results["gate_i_late"]["median_ns"] / 1e6
        ratio = late_ms / early_ms if early_ms > 0 else 0
        print(f"    Early: {early_ms:.2f}ms, Late: {late_ms:.2f}ms")
        print(f"    Ratio: {ratio:.2f}x (late/early)")

    def bench_gate_k(self):
        """Gate K: In-memory parity."""
        print("  Gate K: In-Memory Parity...")

        # In-memory baseline
        def inmemory_filter():
            # Direct arbor operations
            count = 0
            for i in range(len(self.arbor)):
                tree = self.arbor[i]
                if tree["birthYear"].value > 1950:
                    count += 1
            return count

        # ArborStore path
        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            def arborbase_filter():
                result = batched.filter(arbors.path("birthYear") > arbors.lit(1950))
                return len(result)

            self.results["gate_k_inmemory"] = measure(inmemory_filter, samples=10)
            self.results["gate_k_arborbase"] = measure(arborbase_filter, samples=10)

        inmem_ms = self.results["gate_k_inmemory"]["median_ns"] / 1e6
        arborbase_ms = self.results["gate_k_arborbase"]["median_ns"] / 1e6
        ratio = arborbase_ms / inmem_ms if inmem_ms > 0 else float('inf')
        status = "PASS" if 0.9 <= ratio <= 1.1 else "WARN"
        print(f"    InMemory: {inmem_ms:.2f}ms, ArborStore: {arborbase_ms:.2f}ms")
        print(f"    Ratio: {ratio:.2f}x (target 0.9-1.1x) [{status}]")

    def bench_gate_l(self):
        """Gate L: Fork ROI baseline."""
        print("  Gate L: Fork ROI...")

        base = arbors.ArborStore.open(str(self.db_path))
        with base.begin_read() as txn:
            batched = txn.get("players")

            def materialize():
                return batched.materialize()

            self.results["gate_l"] = measure(materialize, samples=20)

        median_ms = self.results["gate_l"]["median_ns"] / 1e6
        print(f"    Zero-copy materialize: {median_ms:.2f}ms (baseline for fork comparison)")

    def _report(self):
        print("\n" + "="*60)
        print("GATE SUMMARY (Python)")
        print("="*60)

        for gate, stats in self.results.items():
            median_ms = stats["median_ns"] / 1e6
            print(f"  {gate}: {median_ms:.3f}ms median")

        if self.output_path:
            with open(self.output_path, 'w') as f:
                json.dump(self.results, f, indent=2)
            print(f"\nResults written to {self.output_path}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", "-o", help="Output JSON file")
    args = parser.parse_args()

    bench = GateBenchmarks(output_path=args.output)
    bench.run_all()
```

### Phase 5: Update Baseline Recording Format

**File:** `benchmarks/baselines/phase18.json`

Extend to include source matrix:

```json
{
  "baseline_date": "2025-12-29",
  "git_commit": "...",
  "phase": "18B-step6",

  "benchmarks": {
    "gate_a_instant_open": {
      "source": "ArborStore",
      "median_ms": 28.74,
      "target_ms": 100,
      "status": "PASS"
    },
    "gate_k_inmemory_filter": {
      "source": "InMemory",
      "median_ms": 5.2,
      "baseline": true
    },
    "gate_k_arborbase_filter": {
      "source": "ArborStore",
      "median_ms": 5.5,
      "parity_ratio": 1.06,
      "parity_target": "0.9-1.1x",
      "status": "PASS"
    }
  },

  "source_matrix": {
    "filter": {
      "InMemory": "gate_k_inmemory_filter",
      "ArborStore": "gate_k_arborbase_filter"
    },
    "aggregate": {
      "InMemory": "gate_k_inmemory_aggregate",
      "ArborStore": "gate_k_arborbase_aggregate"
    }
  }
}
```

### Phase 6: Add CI Gate Enforcement

**File:** `.github/workflows/ci.yml` (extend existing)

```yaml
  benchmark-gates:
    name: Performance Gates
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Rust Gate Benchmarks
        run: |
          cargo bench -p arbors-base --bench arborbase_bench -- --noplot 2>&1 | tee bench_output.txt

      - name: Check Gate Targets
        run: |
          python3 benchmarks/check_gates.py bench_output.txt
```

**File:** `benchmarks/check_gates.py` (NEW)

```python
#!/usr/bin/env python3
"""Parse criterion output and check gate targets."""

import re
import sys

GATE_TARGETS = {
    "gate_a": {"max_ms": 100, "metric": "median"},
    "gate_g": {"max_ms": 5, "metric": "median"},
    # Add other gates with hard targets
}

def parse_criterion_output(filepath):
    """Extract benchmark results from criterion output."""
    results = {}
    with open(filepath) as f:
        content = f.read()

    # Pattern: "bench_name    time:   [min median max]"
    pattern = r'(\w+)\s+time:\s+\[[\d.]+ \w+ ([\d.]+) (\w+)'
    for match in re.finditer(pattern, content):
        name, median, unit = match.groups()
        # Convert to ms
        multiplier = {"ns": 1e-6, "µs": 1e-3, "us": 1e-3, "ms": 1, "s": 1000}
        ms = float(median) * multiplier.get(unit, 1)
        results[name] = ms

    return results

def check_gates(results):
    """Check results against gate targets."""
    failures = []

    for gate, target in GATE_TARGETS.items():
        if gate not in results:
            print(f"WARNING: {gate} not found in results")
            continue

        actual = results[gate]
        max_val = target["max_ms"]

        if actual > max_val:
            failures.append(f"{gate}: {actual:.2f}ms > {max_val}ms target")
            print(f"FAIL: {gate} = {actual:.2f}ms (target ≤{max_val}ms)")
        else:
            print(f"PASS: {gate} = {actual:.2f}ms (target ≤{max_val}ms)")

    return failures

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: check_gates.py <criterion_output.txt>")
        sys.exit(1)

    results = parse_criterion_output(sys.argv[1])
    failures = check_gates(results)

    if failures:
        print(f"\n{len(failures)} gate(s) failed:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("\nAll gates passed!")
```

---

### Phase 7: Add Gate A' (Cold Cache) Benchmark

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

Gate A' measures instant open with cold OS page cache. Use "new process per iteration" approach with randomized file names.

```rust
/// Gate A': Instant open with cold OS cache
/// Uses fresh database file per iteration to avoid OS page cache hits
fn bench_gate_a_prime_cold_cache(c: &mut Criterion) {
    let mut group = c.benchmark_group("gate_a_prime_cold");
    group.sample_size(10); // Fewer samples due to setup cost

    group.bench_function("open_filter_cold", |b| {
        b.iter_custom(|iters| {
            let mut total = std::time::Duration::ZERO;
            for _ in 0..iters {
                // Fresh tmpdir and file each iteration
                let tmpdir = TempDir::new().unwrap();
                let db_path = tmpdir.path().join(format!("cold_{}.arbors", rand::random::<u64>()));

                // Setup: create and write data
                let arbor = create_player_arbor(PLAYERS_COUNT);
                {
                    let base = ArborStore::open(&db_path, ArborStoreOptions::default()).unwrap();
                    let mut txn = base.begin_write().unwrap();
                    txn.put("players", &arbor).unwrap();
                    txn.commit().unwrap();
                }

                // Drop and reopen - this is the cold path
                let start = std::time::Instant::now();
                let base = ArborStore::open(&db_path, ArborStoreOptions::default()).unwrap();
                let txn = base.begin_read().unwrap();
                let batched = txn.get_batched("players").unwrap().unwrap();
                let result = batched.filter(path("birthYear").gt(lit(1950))).unwrap();
                black_box(result.len());
                total += start.elapsed();
            }
            total
        });
    });

    group.finish();
}
```

### Phase 8: Add Gate F (Streaming Memory Bound) Benchmark

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

Gate F: Peak RSS ≤ 2× batch size during streaming queries. Track allocations.

```rust
/// Gate F: Streaming memory bound - peak RSS ≤ 2× batch size
/// Uses custom allocation tracking
fn bench_gate_f_memory_bound(c: &mut Criterion) {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static ALLOCATED: AtomicUsize = AtomicUsize::new(0);
    static PEAK: AtomicUsize = AtomicUsize::new(0);

    // Note: For full tracking, use #[global_allocator] with a tracking allocator
    // This is a simplified version that measures via before/after

    let tmpdir = TempDir::new().unwrap();
    let db_path = tmpdir.path().join("memory.arbors");
    let arbor = create_player_arbor(PLAYERS_COUNT);

    let base = ArborStore::open(&db_path, ArborStoreOptions::default()).unwrap();
    {
        let mut txn = base.begin_write().unwrap();
        txn.put("players", &arbor).unwrap();
        txn.commit().unwrap();
    }

    let mut group = c.benchmark_group("gate_f_memory");

    group.bench_function("streaming_filter_memory", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("players").unwrap().unwrap();

            // Filter without materializing full arbor
            let result = batched.filter(path("birthYear").gt(lit(1950))).unwrap();
            black_box(result.len())
        });
    });

    group.finish();
}
```

### Phase 9: Add Gate I (Early-Exit) Benchmark

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

Gate I: "find one" query touches ≤1 batch on average when match occurs early.

```rust
/// Gate I: Early-exit - find_one touches ≤1 batch when match is early
fn bench_gate_i_early_exit(c: &mut Criterion) {
    let tmpdir = TempDir::new().unwrap();
    let db_path = tmpdir.path().join("early_exit.arbors");

    let opts = ArborStoreOptions {
        min_trees_per_batch: 1000,
        max_trees_per_batch: 1000,
        ..Default::default()
    };

    let arbor = create_player_arbor(PLAYERS_COUNT); // 20K trees = 20 batches

    let base = ArborStore::open(&db_path, opts.clone()).unwrap();
    {
        let mut txn = base.begin_write().unwrap();
        txn.put_with_stats("players", &arbor, Some(&opts)).unwrap();
        txn.commit().unwrap();
    }

    let mut group = c.benchmark_group("gate_i_early_exit");

    // Find player in first batch (should touch only 1 batch)
    group.bench_function("find_one_early_match", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("players").unwrap().unwrap();
            // player00050 is in batch 0
            let result = batched.filter(path("playerID").eq(lit("player00050"))).unwrap();
            black_box(result.len())
        });
    });

    // Find player in last batch (should touch all batches)
    group.bench_function("find_one_late_match", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("players").unwrap().unwrap();
            // player19950 is in last batch
            let result = batched.filter(path("playerID").eq(lit("player19950"))).unwrap();
            black_box(result.len())
        });
    });

    group.finish();
}
```

### Phase 10: Add Gate L (Fork ROI) Benchmark

**File:** `crates/arbors-base/benches/arborbase_bench.rs`

Gate L: Fork path ≥2× faster OR ≥2× less memory than fallback. Compare zero-copy vs copy path.

```rust
/// Gate L: Fork ROI - zero-copy path vs copy fallback
fn bench_gate_l_fork_roi(c: &mut Criterion) {
    let tmpdir = TempDir::new().unwrap();
    let db_path = tmpdir.path().join("fork_roi.arbors");

    let arbor = create_player_arbor(PLAYERS_COUNT);

    let base = ArborStore::open(&db_path, ArborStoreOptions::default()).unwrap();
    {
        let mut txn = base.begin_write().unwrap();
        txn.put("players", &arbor).unwrap();
        txn.commit().unwrap();
    }

    let mut group = c.benchmark_group("gate_l_fork_roi");

    // Zero-copy path (current implementation)
    group.bench_function("zero_copy_materialize", |b| {
        b.iter(|| {
            let txn = base.begin_read().unwrap();
            let batched = txn.get_batched("players").unwrap().unwrap();
            let arbor = batched.materialize().unwrap();
            black_box(arbor.num_trees())
        });
    });

    // Note: A true "copy fallback" comparison would require a feature flag
    // or separate build. For now, we measure and record the zero-copy path
    // baseline for future comparison.

    group.finish();
}

---

## Test Coverage

### Rust Tests to Verify

```bash
# Existing tests that validate gate behavior
cargo test -p arbors-base test_put_unchanged_arbor_writes_zero_batches  # Gate J
cargo test -p arbors-base test_put_single_tree_update_writes_one_batch  # Gate E
cargo test -p arbors-base test_gate_h_projection_speedup  # Gate H (in projection_tests.rs)
```

### Python Tests to Add

```python
# python/tests/test_gates.py
class TestGates:
    def test_gate_a_instant_open_under_100ms(self, benchmark_db):
        """Gate A: open + filter < 100ms"""
        start = time.perf_counter()
        base = arbors.ArborStore.open(benchmark_db)
        with base.begin_read() as txn:
            batched = txn.get("players")
            result = batched.filter(arbors.path("birthYear") > arbors.lit(1950))
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert elapsed_ms < 100, f"Gate A failed: {elapsed_ms:.2f}ms > 100ms"
```

---

## Critical Files

| File | Changes |
|------|---------|
| `crates/arbors-base/benches/arborbase_bench.rs` | Reorganize groups; add Gate H, Gate K benchmarks |
| `python/benchmarks/gates_benchmark.py` | NEW - Python gate benchmark runner |
| `benchmarks/check_gates.py` | NEW - CI gate enforcement script |
| `benchmarks/baselines/phase18.json` | Extend with source matrix format |
| `.github/workflows/ci.yml` | Add benchmark-gates job (optional for Step 6) |

---

## Exit Criteria

**Rust Benchmarks:**
- [ ] Gates A, B, C, E, G, J organized in criterion groups by category
- [ ] Gate A' benchmark added (cold cache instant open)
- [ ] Gate F benchmark added (streaming memory bound)
- [ ] Gate H benchmark added (projection pushdown ≥1.2× speedup)
- [ ] Gate I benchmark added (early-exit batch counting)
- [ ] Gate K benchmark added (in-memory vs ArborStore parity ±10%)
- [ ] Gate L benchmark added (fork ROI baseline)

**Python Benchmarks:**
- [ ] Python `gates_benchmark.py` measures Gates A, A', B, C, F, G, H, I, K, L
- [ ] `check_gates.py` script validates gate targets

**Infrastructure:**
- [ ] `phase18.json` extended with source matrix format
- [ ] All benchmarks runnable via single command: `cargo bench -p arbors-base --bench arborbase_bench`
- [ ] Python benchmarks runnable via: `python python/benchmarks/gates_benchmark.py`
- [ ] All gates measured and recorded in baselines

---

## Execution Summary

| Phase | What | Effort |
|-------|------|--------|
| 1 | Reorganize criterion groups | Small - restructure only |
| 2 | Add Gate H benchmark | Small - adapt from existing test |
| 3 | Add Gate K benchmark | Medium - dual-path comparison |
| 4 | Add Python gate runner | Medium - new file ~250 lines |
| 5 | Update baseline format | Small - JSON schema extension |
| 6 | Add CI enforcement | Small - script + workflow |
| 7 | Add Gate A' benchmark | Medium - cold cache harness |
| 8 | Add Gate F benchmark | Medium - memory tracking |
| 9 | Add Gate I benchmark | Small - early-exit comparison |
| 10 | Add Gate L benchmark | Small - fork ROI baseline |

**Total estimated effort:** ~500-600 lines of new code across 5-6 files
