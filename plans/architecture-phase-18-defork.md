# De-fork arrow-buffer

## Goal

Use upstream `arrow-buffer` (no fork) by replacing `Buffer::from_external` / `scalar_buffer_from_external` with `Buffer::from_custom_allocation` and a local wrapper that keeps `PinnedBytes` alive.

## Background

The fork adds two functions to `arrow-buffer`:
- `Buffer::from_external(owner: Arc<dyn Any + Send + Sync>, ptr, len)`
- `scalar_buffer_from_external<T>(owner, ptr, len)` — with alignment/length validation

Upstream already provides `Buffer::from_custom_allocation(ptr, len, owner: Arc<dyn Allocation>)`, where `Allocation` is blanket-implemented for any `RefUnwindSafe + Send + Sync`. We just need a wrapper to satisfy `RefUnwindSafe`.

## Critical Files

| File | Action |
|------|--------|
| `crates/arbors-base/src/pinned_owner.rs` | NEW — wrapper + helpers (~60 lines) |
| `crates/arbors-base/src/lib.rs` | Modify — 8 call site updates |
| `Cargo.toml` | Modify — remove `[patch.crates-io] arrow-buffer` |
| `docs/FORKS.md` | Modify — mark arrow-buffer as de-forked |
| `forks/arrow-rs/` | Remove (after verification) |

---

## Implementation Steps

### Step 1: Create `pinned_owner.rs` module

**File**: `crates/arbors-base/src/pinned_owner.rs` (NEW, ~60 lines)

```rust
//! Wrapper to use redb::PinnedBytes as Arrow buffer owner via upstream API.

use std::panic::RefUnwindSafe;
use std::ptr::NonNull;
use std::sync::Arc;

use arrow_buffer::alloc::Allocation;
use arrow_buffer::{ArrowNativeType, Buffer, ScalarBuffer};
use redb::PinnedBytes;

/// Wrapper that keeps `PinnedBytes` alive and satisfies `Allocation` bounds.
///
/// `Allocation` requires `RefUnwindSafe + Send + Sync`. PinnedBytes is already
/// Send + Sync; we add RefUnwindSafe here.
#[derive(Clone)]
pub struct PinnedBytesOwner(pub PinnedBytes);

impl RefUnwindSafe for PinnedBytesOwner {}

/// Internal error for buffer construction validation.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PinnedBufferError {
    #[error("pointer not aligned: required {required} bytes, got offset {actual}")]
    Alignment { required: usize, actual: usize },

    #[error("byte length {len} not divisible by element size {size}")]
    Length { size: usize, len: usize },
}

/// Create a raw `Buffer` over pinned bytes. Caller must ensure ptr/len are valid.
pub(crate) fn buffer_from_pinned(
    owner: Arc<PinnedBytesOwner>,
    ptr: NonNull<u8>,
    len: usize,
) -> Buffer {
    // Use unsized coercion (NOT `as` cast) for Arc<dyn Allocation>
    let alloc_owner: Arc<dyn Allocation> = owner;
    // SAFETY: caller guarantees ptr is valid for len bytes within owner's backing memory.
    // Owner (Arc<PinnedBytesOwner>) keeps PinnedBytes alive → memory remains valid.
    unsafe { Buffer::from_custom_allocation(ptr, len, alloc_owner) }
}

/// Create a typed `ScalarBuffer<T>` with alignment and length validation.
pub(crate) fn scalar_buffer_from_pinned<T: ArrowNativeType>(
    owner: Arc<PinnedBytesOwner>,
    ptr: NonNull<u8>,
    len: usize,
) -> Result<ScalarBuffer<T>, PinnedBufferError> {
    let align = std::mem::align_of::<T>();
    let size = std::mem::size_of::<T>();

    // Check alignment using align_offset (matches Arrow's own checks)
    let misalignment = ptr.as_ptr().align_offset(align);
    if misalignment != 0 {
        return Err(PinnedBufferError::Alignment { required: align, actual: misalignment });
    }

    // Check length divisibility
    if size != 0 && (len % size) != 0 {
        return Err(PinnedBufferError::Length { size, len });
    }

    let buffer = buffer_from_pinned(owner, ptr, len);
    let count = if size == 0 { 0 } else { len / size };
    Ok(ScalarBuffer::new(buffer, 0, count))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests will be added in Step 3
}
```

### Step 2: Update call sites in `lib.rs`

**File**: `crates/arbors-base/src/lib.rs`

**2a. Add module and imports**:
```rust
mod pinned_owner;
use pinned_owner::{buffer_from_pinned, scalar_buffer_from_pinned, PinnedBytesOwner};
```

**2b. Replace owner creation** (around line 923):

Before:
```rust
let owner: Arc<dyn Any + Send + Sync> = Arc::new(pinned.clone());
```

After:
```rust
let owner = Arc::new(PinnedBytesOwner(pinned.clone()));
```

**2c. Replace buffer construction calls** (in two duplicated zero-copy constructor blocks):

> **Call-site inventory**: ~8 `Buffer::from_external` + ~2 `scalar_buffer_from_external` calls, appearing in two similar code blocks. Update both blocks consistently.

| Before | After |
|--------|-------|
| `Buffer::from_external(owner.clone(), ptr, len)` | `buffer_from_pinned(owner.clone(), ptr, len)` |
| `scalar_buffer_from_external::<T>(owner.clone(), ptr, len)?` | `scalar_buffer_from_pinned::<T>(owner.clone(), ptr, len).map_err(\|e\| ArborStoreError::BatchCorruption { cause: e.to_string() })?` |

**2d. Remove old imports**:
```rust
// DELETE these lines:
use arrow_buffer::{scalar_buffer_from_external, Buffer};
// KEEP Buffer import, remove scalar_buffer_from_external
```

### Step 3: Add tests

**File**: `crates/arbors-base/src/pinned_owner.rs` (in `#[cfg(test)]` block)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Helper to get real PinnedBytes from a temp DB for testing
    fn get_test_pinned_bytes() -> PinnedBytes {
        // Use ArborStore test infrastructure to create a temp DB with data
        // and retrieve PinnedBytes from a read transaction
        // (Implementation uses existing test helpers)
        todo!("Use existing test infrastructure")
    }

    #[test]
    fn test_alignment_rejection() {
        // Get real PinnedBytes - pointer MUST come from this slice
        let pinned = get_test_pinned_bytes();
        let slice = pinned.as_slice();

        // Create misaligned pointer by offsetting 1 byte into the slice
        let misaligned_ptr = unsafe {
            NonNull::new_unchecked(slice.as_ptr().add(1) as *mut u8)
        };

        let owner = Arc::new(PinnedBytesOwner(pinned));
        let result = scalar_buffer_from_pinned::<i64>(owner, misaligned_ptr, 8);
        assert!(matches!(result, Err(PinnedBufferError::Alignment { .. })));
    }

    #[test]
    fn test_length_rejection() {
        // Get real PinnedBytes - pointer MUST come from this slice
        let pinned = get_test_pinned_bytes();
        let slice = pinned.as_slice();

        let ptr = NonNull::new(slice.as_ptr() as *mut u8).unwrap();
        let owner = Arc::new(PinnedBytesOwner(pinned));

        // 7 bytes is not divisible by size_of::<i64>() = 8
        // Use min(7, slice.len()) to stay within bounds
        let len = std::cmp::min(7, slice.len());
        let result = scalar_buffer_from_pinned::<i64>(owner, ptr, len);
        assert!(matches!(result, Err(PinnedBufferError::Length { .. })));
    }

    #[test]
    fn test_owner_keeps_memory_alive() {
        // Use real temp DB to get actual PinnedBytes
        let pinned = get_test_pinned_bytes();
        let slice = pinned.as_slice();
        let ptr = NonNull::new(slice.as_ptr() as *mut u8).unwrap();
        let len = slice.len();

        let owner = Arc::new(PinnedBytesOwner(pinned));
        let buffer = buffer_from_pinned(owner.clone(), ptr, len);

        // Drop the original owner reference, buffer should still be valid
        drop(owner);

        // Buffer should still be readable (Arc keeps PinnedBytes alive)
        assert_eq!(buffer.len(), len);
        assert!(!buffer.is_empty());
    }
}
```

### Step 4: Remove fork from dependencies

**File**: `Cargo.toml` (root)

```diff
 [patch.crates-io]
 # NOTE: We currently carry small upstream forks under `forks/` to enable ArborStore
 # zero-copy reads. See `docs/FORKS.md` for details and maintenance procedures.
 redb = { path = "forks/redb" }
-arrow-buffer = { path = "forks/arrow-rs/arrow-buffer" }
```

Keep `arrow-buffer` version at 57 to match the rest of the Arrow workspace dependencies.

### Step 5: Update documentation

**File**: `docs/FORKS.md`

Update the arrow-buffer section to note it has been de-forked:

```markdown
## arrow-buffer (DE-FORKED as of YYYY-MM-DD)

Previously forked to add `Buffer::from_external` for zero-copy construction.
Now using upstream `Buffer::from_custom_allocation` with a local
`PinnedBytesOwner` wrapper in `crates/arbors-base/src/pinned_owner.rs`.

No fork maintenance required.
```

### Step 6: Verify and clean up

1. **Build**: `cargo build --all-features`
2. **Test**: `cargo test -p arbors-base`
3. **Benchmark**: Run Gate L to confirm zero-copy path still works
4. **Remove fork directory**: After all tests pass, remove `forks/arrow-rs/` (git submodule if applicable, or just delete)

---

## Soundness Invariants

The following invariants must hold for safe zero-copy buffer construction:

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | `ptr` must point within owner's backing allocation | Caller responsibility; documented in SAFETY comment |
| 2 | `len` must not exceed available bytes from `ptr` | Caller responsibility; documented in SAFETY comment |
| 3 | Allocation owner refcount managed correctly | Rely on `arrow-buffer`'s `Deallocation::Custom` machinery |
| 4 | `T`'s alignment must divide `ptr` | Validated via `align_offset` check in `scalar_buffer_from_pinned` |
| 5 | `len` must be divisible by `size_of::<T>()` | Validated via modulo check in `scalar_buffer_from_pinned` |

---

## Verification Checklist

- [ ] `cargo build --all-features` succeeds
- [ ] `cargo test -p arbors-base` passes (including new pinned_owner tests)
- [ ] `cargo clippy --all-features` clean
- [ ] Gate L benchmark shows same zero-copy performance (~1.8ms materialize)
- [ ] No references to `scalar_buffer_from_external` or forked `from_external` remain
- [ ] `[patch.crates-io] arrow-buffer` removed from Cargo.toml
- [ ] `docs/FORKS.md` updated
- [ ] `forks/arrow-rs/` directory removed

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API difference in upstream | Low | Verified `from_custom_allocation` exists in v54+ |
| Performance regression | Low | Same underlying mechanism; benchmark to confirm |
| Alignment check regression | Low | Local helper preserves exact same validation |
| Build breakage | Low | Single crate affected, clear error messages |

**Overall risk: LOW** — This is a well-understood, minimal-surface-area change.
