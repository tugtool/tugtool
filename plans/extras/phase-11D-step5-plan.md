## Phase 11D Step 5: MRO-Based Attribute Lookup - Detailed Implementation Plan

**Purpose:** Correct the path resolution architecture and implement MRO-based attribute lookup that works correctly across file boundaries.

---

### Plan Metadata

| Field | Value |
|------|-------|
| Owner | Implementation team |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-28 |
| Prior context | Phase 11D Steps 1-4 complete |

---

### Problem Statement {#problem-statement}

The current implementation has a fundamental architectural mismatch that causes cross-file MRO resolution to fail.

#### The Observed Failure

When running `test_mro_attr_multi_hop_cross_file`, the debug output shows:

```
Base import target: ImportTarget { file_path: "base.py", kind: FromImport { ... } }
```

The import target stores a **relative path** (`"base.py"`), but `CrossFileTypeCache::get_or_analyze` is called with an **absolute path** (`/var/folders/.../base.py`). The cache uses absolute paths as keys, so when MRO resolution tries to look up the file by its relative path, it fails to find the cached context.

#### Root Cause Analysis

1. **`build_import_targets_from_cst`** (line 565-641) calls `resolve_module_to_file` which returns relative paths like `"base.py"`
2. These relative paths are stored directly in `ImportTarget.file_path`
3. **`CrossFileTypeCache::get_or_analyze`** (line 321-362) is called with absolute paths and uses them as cache keys
4. **`compute_mro_in_file`** (line 389-508) calls `cache.get_or_analyze(file_path, ...)` using the path from `resolve_base_class`
5. **`resolve_base_class`** (line 525-587) returns `target.file_path` directly, which is relative

The mismatch: **relative paths stored in ImportTarget** vs **absolute paths used as cache keys**.

---

### 1. Architecture Decisions {#architecture-decisions}

#### [D01] Single Source of Truth: Workspace-Relative Paths (DECIDED) {#d01-relative-paths}

**Decision:** Use workspace-relative paths as the canonical path representation throughout the cross-file resolution system.

**Rationale:**
- `workspace_files` (from analyze) stores relative paths like `"base.py"`, `"pkg/handler.py"`
- `resolve_module_to_file()` returns relative paths (it works against `workspace_files`)
- Relative paths are portable and don't break when the workspace moves
- The existing import resolution infrastructure already uses relative paths

**Implications:**
- `CrossFileTypeCache` keys must be normalized to relative paths
- `ImportTarget.file_path` already stores relative paths (correct)
- When calling `get_or_analyze`, paths must be converted to relative form
- Absolute paths are only needed when reading files from disk

#### [D02] Path Normalization Strategy (DECIDED) {#d02-path-normalization}

**Decision:** Normalize all paths to relative form at cache boundaries using `strip_prefix(workspace_root)`.

**Algorithm:**
```rust
fn normalize_path_to_relative(file_path: &Path, workspace_root: &Path) -> PathBuf {
    file_path
        .strip_prefix(workspace_root)
        .unwrap_or(file_path)
        .to_path_buf()
}

fn normalize_path_to_absolute(relative_path: &Path, workspace_root: &Path) -> PathBuf {
    workspace_root.join(relative_path)
}
```

**Where normalization occurs:**
- **Cache key lookup**: Always use relative paths
- **File reading**: Convert relative to absolute before `std::fs::read_to_string`
- **ImportTarget storage**: Already stores relative paths (no change needed)

#### [D03] File Path Contract (DECIDED) {#d03-path-contract}

**Decision:** Establish a clear contract for file path formats.

| Location | Format | Example |
|----------|--------|---------|
| `workspace_files` | Relative | `"base.py"`, `"pkg/handler.py"` |
| `ImportTarget.file_path` | Relative | `"base.py"` |
| `CrossFileTypeCache.contexts` keys | Relative | `PathBuf::from("base.py")` |
| `resolve_module_to_file` return | Relative | `"base.py"` |
| `resolve_base_class` return | Relative | `PathBuf::from("base.py")` |
| `get_or_analyze` file_path param | Either | Normalized internally to relative |
| File I/O operations | Absolute | `workspace_root.join("base.py")` |

#### [D04] MRO Computation Data Flow (DECIDED) {#d04-mro-flow}

**Decision:** MRO computation follows this data flow:

```
attribute_type_of_with_mro(class_name, attr_name)
    |
    v
lookup_attr_in_mro(class_name, attr_name, ctx, cache, workspace_root)
    |
    v
compute_mro_cross_file(class_name, ctx, cache, workspace_root)
    |
    v
resolve_base_class(base_name, ctx) -> Option<(class_name, relative_file_path)>
    |                                           ^
    |                                           | Returns RELATIVE path
    v
compute_mro_in_file(class_name, relative_file_path, cache, workspace_root, depth)
    |
    v
cache.get_or_analyze(relative_file_path, workspace_root)
    |                      ^
    |                      | Normalizes internally and uses relative as key
    v                      | Joins with workspace_root for file I/O
Returns &FileTypeContext
```

**Key invariants:**
1. `resolve_base_class` returns relative paths (as stored in `ImportTarget.file_path`)
2. `get_or_analyze` accepts either relative or absolute paths and normalizes internally
3. Cache keys are always relative paths
4. File reading always uses `workspace_root.join(relative_path)`

---

### 2. Required Code Changes {#required-changes}

#### 2.1 CrossFileTypeCache::get_or_analyze (Priority: P0) {#change-get-or-analyze}

**File:** `crates/tugtool-python/src/cross_file_types.rs`
**Lines:** 321-362

**Current Issue:** Uses `file_path.to_path_buf()` directly as cache key without normalization.

**Required Changes:**

```rust
pub fn get_or_analyze(
    &mut self,
    file_path: &Path,
    workspace_root: &Path,
) -> TypeResolutionResult<&FileTypeContext> {
    // Normalize path to relative form for consistent cache key
    let relative_path = file_path
        .strip_prefix(workspace_root)
        .unwrap_or(file_path)
        .to_path_buf();

    // Fast path: check if already cached using RELATIVE key
    if self.contexts.contains_key(&relative_path) {
        return Ok(self.contexts.get(&relative_path).unwrap());
    }

    // Check for cycles using RELATIVE key
    if self.in_progress.contains(&relative_path) {
        return Err(TypeResolutionError::CircularImport(relative_path));
    }

    // Mark as in progress using RELATIVE key
    self.in_progress.insert(relative_path.clone());

    // Analyze the file using ABSOLUTE path for I/O
    let absolute_path = workspace_root.join(&relative_path);
    let result = self.analyze_file(&absolute_path, workspace_root);

    // Always remove from in_progress, even on error
    self.in_progress.remove(&relative_path);

    // Handle analysis result
    let ctx = result?;

    // Cache eviction if needed
    if self.contexts.len() >= self.max_size {
        self.evict_oldest();
    }

    // Store in cache using RELATIVE key
    self.access_order.push_back(relative_path.clone());
    self.contexts.insert(relative_path.clone(), ctx);

    Ok(self.contexts.get(&relative_path).unwrap())
}
```

**Key changes:**
1. Add `relative_path` extraction at entry point
2. Use `relative_path` for all cache operations
3. Use `workspace_root.join(&relative_path)` for file I/O

#### 2.2 CrossFileTypeCache::cache_mro and get_cached_mro (Priority: P1) {#change-mro-cache}

**File:** `crates/tugtool-python/src/cross_file_types.rs`
**Lines:** 411-439

**Current Issue:** Uses `file_path` directly without normalization.

**Required Changes:**

```rust
pub fn cache_mro(&mut self, file_path: &Path, class_name: &str, mro: Vec<String>) -> bool {
    // Note: Caller should provide relative path, but normalize just in case
    // This method doesn't have workspace_root, so assume relative path is provided
    if let Some(ctx) = self.contexts.get_mut(file_path) {
        if let Some(hierarchy) = ctx.class_hierarchies.get_mut(class_name) {
            hierarchy.mro = Some(mro);
            return true;
        }
    }
    false
}

pub fn get_cached_mro(&self, file_path: &Path, class_name: &str) -> Option<&Vec<String>> {
    // Note: Caller should provide relative path
    self.contexts
        .get(file_path)?
        .class_hierarchies
        .get(class_name)?
        .mro
        .as_ref()
}
```

**Note:** These methods already work correctly IF the caller provides a relative path. The fix is in the callers.

#### 2.3 compute_mro_in_file (Priority: P0) {#change-compute-mro-in-file}

**File:** `crates/tugtool-python/src/mro.rs`
**Lines:** 389-508

**Current Issue:**
- Line 405: `cache.get_cached_mro(file_path, class_name)` - must use relative path
- Line 412-414: `cache.get_or_analyze(file_path, workspace_root)` - path must be relative or normalized

**Required Changes:**

The callers of `compute_mro_in_file` already pass paths from `resolve_base_class`, which returns relative paths from `ImportTarget.file_path`. So the function should work correctly once `get_or_analyze` normalizes paths.

However, we should add an assertion or documentation clarifying that `file_path` is expected to be relative.

```rust
/// Compute MRO for a class in a specific file.
///
/// # Arguments
///
/// * `class_name` - Name of the class to compute MRO for
/// * `file_path` - **Relative** path to the file containing the class
/// * `cache` - Cross-file type cache
/// * `workspace_root` - Root directory for converting to absolute paths
/// * `depth` - Current recursion depth for depth limiting
fn compute_mro_in_file(
    class_name: &str,
    file_path: &Path,  // Expected to be relative
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
    depth: usize,
) -> MROResult<Vec<String>> {
    // ... rest of implementation
}
```

#### 2.4 resolve_base_class Return Value (Priority: P1) {#change-resolve-base-class}

**File:** `crates/tugtool-python/src/mro.rs`
**Lines:** 525-587

**Current behavior:** Returns `target.file_path.clone()` which is already relative.

**Verification needed:** Confirm that `ImportTarget.file_path` is always relative. Looking at `build_import_targets_from_cst`:

```rust
// Line 587-601
let mut file_path = PathBuf::from(&resolved_file);  // resolved_file is relative
...
let target = ImportTarget {
    file_path,  // Stores relative path
    kind: ...
};
```

**Conclusion:** This is already correct. `resolve_base_class` returns relative paths.

#### 2.5 lookup_attr_in_mro_class (Priority: P0) {#change-lookup-attr}

**File:** `crates/tugtool-python/src/mro.rs`
**Lines:** 652-720

**Issue:** Line 700 calls `cache.get_or_analyze(&file_path, workspace_root)` with `file_path` from `ImportTarget.file_path` which is relative.

**Required verification:** This should work once `get_or_analyze` normalizes paths. No changes needed here.

---

### 3. Test Strategy {#test-strategy}

#### 3.1 Unit Tests for Path Normalization {#test-path-normalization}

**File:** `crates/tugtool-python/src/cross_file_types.rs`

```rust
#[test]
fn test_get_or_analyze_normalizes_absolute_path() {
    // Test that absolute paths are normalized to relative for cache key
    let temp_dir = TempDir::new().unwrap();
    let workspace_root = temp_dir.path();
    let test_py = workspace_root.join("test.py");
    std::fs::write(&test_py, "class Foo: pass").unwrap();

    let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
    let mut cache = CrossFileTypeCache::new(workspace_files, HashSet::new());

    // Call with absolute path
    cache.get_or_analyze(&test_py, workspace_root).unwrap();

    // Verify cache uses relative key
    assert!(cache.is_cached(Path::new("test.py")));
    assert!(!cache.is_cached(&test_py)); // Should NOT be cached under absolute path
}

#[test]
fn test_get_or_analyze_handles_relative_path() {
    // Test that relative paths work directly
    let temp_dir = TempDir::new().unwrap();
    let workspace_root = temp_dir.path();
    std::fs::write(workspace_root.join("test.py"), "class Foo: pass").unwrap();

    let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
    let mut cache = CrossFileTypeCache::new(workspace_files, HashSet::new());

    // Call with relative path
    cache.get_or_analyze(Path::new("test.py"), workspace_root).unwrap();

    // Verify cache uses relative key
    assert!(cache.is_cached(Path::new("test.py")));
}

#[test]
fn test_cache_hit_after_normalization() {
    // Test that absolute path lookup finds relative-key cache entry
    let temp_dir = TempDir::new().unwrap();
    let workspace_root = temp_dir.path();
    let test_py = workspace_root.join("test.py");
    std::fs::write(&test_py, "class Foo: pass").unwrap();

    let workspace_files: HashSet<String> = ["test.py".to_string()].into_iter().collect();
    let mut cache = CrossFileTypeCache::new(workspace_files, HashSet::new());

    // First call with relative path
    cache.get_or_analyze(Path::new("test.py"), workspace_root).unwrap();
    assert_eq!(cache.len(), 1);

    // Second call with absolute path should hit cache
    cache.get_or_analyze(&test_py, workspace_root).unwrap();
    assert_eq!(cache.len(), 1); // No new entry
}
```

#### 3.2 Integration Test: Multi-Hop Cross-File MRO {#test-multi-hop}

The existing `test_mro_attr_multi_hop_cross_file` test should pass after the fix. No changes to the test are needed.

**Expected behavior after fix:**
1. `mid.py` is analyzed with absolute path, cached with key `"mid.py"`
2. MRO lookup for `Mid` finds base class `"Base"` in hierarchies
3. `resolve_base_class("Base", ctx)` returns `("Base", PathBuf::from("base.py"))` (relative)
4. `compute_mro_in_file("Base", Path::new("base.py"), cache, ...)` is called
5. `cache.get_or_analyze(Path::new("base.py"), workspace_root)` normalizes and reads file
6. Repeat for `Root` class
7. `Root.root` method return type found

#### 3.3 Edge Case Tests {#test-edge-cases}

```rust
#[test]
fn test_nested_directory_path_normalization() {
    // Test paths like "pkg/subpkg/module.py"
    let temp_dir = TempDir::new().unwrap();
    let workspace_root = temp_dir.path();
    let pkg_dir = workspace_root.join("pkg").join("subpkg");
    std::fs::create_dir_all(&pkg_dir).unwrap();
    let module_path = pkg_dir.join("module.py");
    std::fs::write(&module_path, "class Handler: pass").unwrap();

    let workspace_files: HashSet<String> =
        ["pkg/subpkg/module.py".to_string()].into_iter().collect();
    let mut cache = CrossFileTypeCache::new(workspace_files, HashSet::new());

    // Call with absolute path
    cache.get_or_analyze(&module_path, workspace_root).unwrap();

    // Verify relative cache key
    assert!(cache.is_cached(Path::new("pkg/subpkg/module.py")));
}

#[test]
fn test_path_outside_workspace_fails() {
    // Paths that don't strip_prefix properly should fail gracefully
    let temp_dir = TempDir::new().unwrap();
    let workspace_root = temp_dir.path().join("workspace");
    std::fs::create_dir_all(&workspace_root).unwrap();

    let outside_file = temp_dir.path().join("outside.py");
    std::fs::write(&outside_file, "class Foo: pass").unwrap();

    let workspace_files: HashSet<String> = HashSet::new();
    let mut cache = CrossFileTypeCache::new(workspace_files, HashSet::new());

    // This should fail to analyze (file not in workspace_files)
    let result = cache.get_or_analyze(&outside_file, &workspace_root);
    // ... verify appropriate error
}
```

---

### 4. Implementation Steps {#implementation-steps}

#### Step 5.1: Fix Path Normalization in get_or_analyze {#step-5-1}

**Commit:** `fix(python): normalize paths to relative form in CrossFileTypeCache`

**Tasks:**
- [ ] Modify `get_or_analyze` to normalize paths at entry point
- [ ] Use relative path for all cache operations (lookup, insert, in_progress)
- [ ] Use `workspace_root.join(relative_path)` for file I/O
- [ ] Add `is_cached` method that takes relative path for testing

**Tests:**
- [ ] `test_get_or_analyze_normalizes_absolute_path`
- [ ] `test_get_or_analyze_handles_relative_path`
- [ ] `test_cache_hit_after_normalization`
- [ ] `test_nested_directory_path_normalization`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python cross_file_types::tests`

#### Step 5.2: Update MRO Cache Methods {#step-5-2}

**Commit:** `fix(python): ensure MRO cache uses relative paths`

**Tasks:**
- [ ] Document that `cache_mro` and `get_cached_mro` expect relative paths
- [ ] Verify callers in `compute_mro_in_file` pass relative paths
- [ ] Add debug assertions if needed

**Tests:**
- [ ] Existing MRO tests continue to pass

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python mro::tests`

#### Step 5.3: Verify Multi-Hop Cross-File Test Passes {#step-5-3}

**Commit:** `test(python): verify multi-hop cross-file MRO resolution`

**Tasks:**
- [ ] Remove debug eprintln statements from test (cleanup)
- [ ] Run `test_mro_attr_multi_hop_cross_file` and confirm it passes
- [ ] Add additional test cases if gaps found

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python test_mro_attr_multi_hop`
- [ ] `cargo nextest run -p tugtool-python test_mro_attr` (all MRO attribute tests)

#### Step 5.4: Add Documentation {#step-5-4}

**Commit:** `docs(python): document path handling contract for cross-file resolution`

**Tasks:**
- [ ] Add module-level documentation to `cross_file_types.rs` explaining path contract
- [ ] Document path expectations on public functions
- [ ] Update CLAUDE.md if needed

**Checkpoint:**
- [ ] `cargo doc -p tugtool-python --no-deps`

---

### 5. Risk Assessment {#risk-assessment}

#### Risk R01: Path Separator Issues on Windows {#r01-path-separator}

**Risk:** Path normalization uses `strip_prefix` which should be cross-platform, but Windows uses backslashes.

**Mitigation:**
- Use `PathBuf` consistently (handles platform differences)
- Test on CI with Windows if available
- Paths in `workspace_files` should use forward slashes on all platforms

**Residual risk:** Windows edge cases may require future fixes.

#### Risk R02: Symlinks and Canonicalization {#r02-symlinks}

**Risk:** Symlinked files might have different paths before/after normalization.

**Mitigation:**
- For Phase 11D, assume no symlinks (documented limitation)
- Canonicalization could be added later if needed

**Residual risk:** Symlinked workspaces may have cache misses.

#### Risk R03: Empty or Invalid Paths {#r03-invalid-paths}

**Risk:** `strip_prefix` could return empty path or fail in edge cases.

**Mitigation:**
- Use `unwrap_or(file_path)` to fall back to original path
- Add validation that paths are non-empty before use

---

### 6. Verification Matrix {#verification-matrix}

| Scenario | Expected Path Flow | Test |
|----------|-------------------|------|
| Single file, absolute path input | `/workspace/test.py` -> `"test.py"` (key) | `test_get_or_analyze_normalizes_absolute_path` |
| Single file, relative path input | `"test.py"` -> `"test.py"` (key) | `test_get_or_analyze_handles_relative_path` |
| Nested directory | `/workspace/pkg/mod.py` -> `"pkg/mod.py"` (key) | `test_nested_directory_path_normalization` |
| Cache hit after normalize | First: relative, Second: absolute -> same entry | `test_cache_hit_after_normalization` |
| Cross-file MRO chain | `mid.py` -> `base.py` -> `root.py` all relative | `test_mro_attr_multi_hop_cross_file` |
| MRO with imported base | `Handler` -> `"handler.py"` (relative) | Existing fixture tests |

---

### 7. Summary {#summary}

The core fix is simple: **normalize all paths to relative form at the cache boundary**. The `get_or_analyze` function should:

1. Convert any input path (absolute or relative) to relative form using `strip_prefix(workspace_root)`
2. Use the relative path for all cache operations
3. Convert back to absolute for file I/O using `workspace_root.join(relative_path)`

This maintains the invariant that `workspace_files`, `ImportTarget.file_path`, and cache keys all use the same path format: **workspace-relative paths**.

After this fix, the existing multi-hop cross-file MRO test should pass, confirming that the path architecture is now consistent throughout the system.
