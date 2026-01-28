## Phase 11D: Cross-File Type Resolution and OOP Support {#phase-11d}

**Purpose:** Extend the type inference system to resolve types across file boundaries, support inheritance-based attribute lookup, and handle property decorators - addressing the highest-impact gaps identified in Phase 11C.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-27 |
| Prior phases | Phase 11C (Enhanced Type Inference and Scope Tracking) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 11C successfully implemented TypeTracker for single-file type resolution, including:
- Step-by-step receiver resolution for dotted paths (`self.handler.process()`)
- Attribute type tracking from class-level annotations and `__init__` assignments
- Method return type lookup via `method_return_type_of()`
- Callable attribute resolution for `Callable[..., T]` types
- MAX_RESOLUTION_DEPTH = 4 for receiver chains

However, the Phase 11C non-goals explicitly deferred several capabilities that are common blockers in real multi-module Python codebases:

1. **Cross-file attribute type resolution** - Currently, when an intermediate type in a chain is defined in another file, resolution stops and returns `CrossFile` or `None`. This is the most common limitation in real code where classes are imported from other modules.

2. **Inheritance-based attribute type lookup (MRO)** - Python's Method Resolution Order is not used; inherited attributes cannot be resolved without explicit annotation in the subclass.

3. **Property decorator resolution** - Properties are common in Python APIs but their return types are not tracked.

4. **External type stub (.pyi) integration** - Many libraries ship type stubs; without stub support, resolution fails for typed library usage.

5. **Type narrowing from isinstance checks** - Useful refinement for conditional type resolution.

6. **Generic type parameter resolution** - `List[T]` -> `T` resolution for container element access.

This phase addresses items 1-3 (HIGH priority) and partially addresses item 4 (MEDIUM priority). Items 5-6 are deferred to a future phase due to their complexity and lower impact relative to effort.

#### Strategy {#strategy}

- **Cross-file resolution first**: This is the highest-impact improvement; most real Python code imports types from other files
- **Load-on-demand for cross-file types**: Analyze target files only when needed during resolution
- **Cache analyzed files**: Avoid re-analyzing the same file multiple times during a session
- **MRO-based lookup**: Implement Python's C3 linearization for inheritance chains
- **Property decorator detection**: Extend modifier tracking to include property return types
- **Preserve language-agnostic core**: Keep FactsStore, Symbol, Reference in tugtool-core unchanged; all new type-tracking infrastructure is Python-specific in tugtool-python
- **Incremental implementation**: Each feature is independently testable and committable
- **Conservative fallback**: Return `None` rather than incorrect resolution when uncertain

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code agent (primary consumer of tug refactoring)
2. Users refactoring multi-file Python projects with imported types
3. Users working with class hierarchies and inheritance

#### Success Criteria (Measurable) {#success-criteria}

- [ ] `self.handler.process()` resolves when `handler: Handler` and `Handler` is imported from another file (cross-file resolution)
- [ ] `obj.inherited_method()` resolves when `inherited_method` is defined in a parent class (MRO lookup)
- [ ] `self.name` resolves to `str` when `name` is a `@property` returning `str`
- [ ] Resolution works for types from `.pyi` stub files when present (inline + `stubs/`)
- [ ] Performance: cross-file resolution adds < 100ms overhead for typical multi-file projects (< 50 files)
- [ ] FactsStore remains language-agnostic (no Python-specific fields added to core types)
- [ ] All existing tests continue to pass (no regression)
- [ ] Tests cover at least 5 distinct cross-file patterns
- [ ] Tests cover at least 3 inheritance patterns (single, multi-level, diamond)

#### Scope {#scope}

**Milestone M01: Cross-File Type Resolution (Finding 1)**
1. Extend `resolve_receiver_path` to continue resolution across file boundaries
2. Implement on-demand file analysis for imported types
3. Build cross-file type cache to avoid redundant analysis
4. Handle circular import chains gracefully (cycle detection)

**Milestone M02: Inheritance-Based Lookup (Finding 2)**
5. Collect base class information from class definitions
6. Implement Method Resolution Order (MRO) computation
7. Extend `attribute_type_of` to search through MRO
8. Extend `method_return_type_of` to search through MRO

**Milestone M03: Property Decorator Resolution (Finding 3)**
9. Detect `@property` decorator on methods
10. Track property return types (from annotation or inference)
11. Resolve `self.prop` to property return type when `prop` is a property

**Milestone M04: Type Stub Integration (Finding 4)**
12. Detect `.pyi` stub files alongside `.py` files
13. Parse stub files for type information
14. Merge stub type info with source file analysis
15. Prioritize stub types over inferred types

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full flow-sensitive type inference (conditionals, loops changing types)
- Type narrowing from `isinstance` checks (deferred to future phase)
- Generic type parameter resolution (e.g., `List[T]` -> `T`) (deferred to future phase)
- Duck typing or protocol-based type inference
- Type inference for dynamically added attributes (`setattr`)
- Runtime type information
- Full mypy/pyright compatibility
- Analyzing dependencies outside the workspace (e.g., third-party packages)

#### Dependencies / Prerequisites {#dependencies}

**Already Complete:**
- Phase 11C complete (TypeTracker, ReceiverPath, attribute_type_of, method_return_type_of)
- CrossFileSymbolMap functional for cross-file symbol resolution
- `resolve_module_to_file()` function for import resolution (analyzer.rs:2207-2245)
- `LocalImport.resolved_file` populated during Pass 3
- `InheritanceCollector` and `ClassInheritanceInfo` exist in tugtool-python-cst
- `Modifier::Property` exists in both tugtool-core and tugtool-python-cst
- `LocalImport` includes `module_path`, `names`, `alias`, `relative_level`, and `resolved_file`

**Needs Wiring (Done in Step 4):**
- `InheritanceCollector` output needs to be added to `FileAnalysis`
- Class hierarchies need to be available in `FileTypeContext`

#### Constraints {#constraints}

- **Language-agnostic core**: FactsStore, Symbol, Reference, and other tugtool-core types must not gain Python-specific fields
- **Performance**: Cross-file resolution must not cause significant slowdown (< 100ms for typical projects)
- **Memory**: Cross-file type cache must be bounded to prevent unbounded memory growth
- **No breaking changes to CLI output**: JSON output format must remain backward compatible
- **Behavioral stability**: Existing single-file resolution behavior must not regress

#### Assumptions {#assumptions}

- Most Python projects have < 100 files requiring type resolution
- Cross-file imports are primarily simple `from module import Name` patterns
- Inheritance hierarchies are typically shallow (< 5 levels)
- Property decorators use standard `@property` (not custom descriptors)
- Type stubs follow PEP 484 / typeshed conventions

---

### Open Questions {#open-questions}

#### [Q01] Cross-file resolution depth limit (DECIDED) {#q01-cross-file-depth}

**Question:** Should we limit how many files deep we follow cross-file type chains?

**Why it matters:** Deep cross-file chains can cause performance degradation and may involve types from external packages we cannot analyze.

**Options:**
- Option A: No limit - follow chains until resolution succeeds or fails
- Option B: Limit to 3 files deep - covers most practical cases
- Option C: Limit to 5 files deep - more generous but bounded

**Plan to resolve:** Analyze Temporale and other real codebases for typical import chain depths.

**Resolution:** Option B. Default `MAX_CROSS_FILE_DEPTH = 3`. If the chain exceeds the limit,
stop resolution and return `ResolvedSymbol::CrossFile` (or `None` if no qualified name).

#### [Q02] Type stub discovery strategy (DECIDED) {#q02-stub-discovery}

**Question:** How should we discover type stubs? Only inline `.pyi` next to `.py`, or also search typeshed-style locations?

**Why it matters:** Full typeshed support is complex; inline stubs cover first-party code.

**Options:**
- Option A: Inline only - `.pyi` files adjacent to `.py` files
- Option B: Inline + project-level `stubs/` directory
- Option C: Full typeshed-style search paths

**Plan to resolve:** Survey how users typically include stubs in their projects.

**Resolution:** Option B. Support inline `.pyi` adjacent to `.py` and a project-level
`stubs/` directory. No typeshed search paths in Phase 11D.

#### [Q03] MRO computation location (DECIDED) {#q03-mro-location}

**Question:** Should MRO be computed in tugtool-python-cst (during collection) or in tugtool-python (during resolution)?

**Why it matters:** Collection-time MRO requires all base classes to be known; resolution-time MRO can handle cross-file bases.

**Options:**
- Option A: Collection-time in tugtool-python-cst
- Option B: Resolution-time in tugtool-python TypeTracker
- Option C: Hybrid - collect base names, compute MRO at resolution time

**Plan to resolve:** Prototype both approaches; measure complexity.

**Resolution:** Option C (hybrid). Collect base class names in CST; compute MRO at
resolution time using CrossFileTypeCache to resolve cross-file bases.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Cross-file resolution causes circular analysis | high | med | Cycle detection with visited set | Stack overflow or infinite loop detected |
| Performance degradation from multi-file analysis | med | med | Bounded cache, lazy loading | > 100ms slowdown on typical project |
| MRO computation incorrect for complex hierarchies | med | low | Test against mypy/Python's C3 impl | Incorrect resolution in inheritance tests |
| Property type inference misses edge cases | low | med | Focus on annotated properties first | Missing expected property resolution |
| Type stub parsing adds maintenance burden | med | low | Reuse existing CST parser | Parser errors on valid stubs |
| Memory growth from cross-file cache | med | low | LRU cache with size limit | Memory usage exceeds threshold |

**Risk R01: Cross-File Circular Imports** {#r01-circular-imports}

- **Risk:** Python allows circular imports; following type chains could cause infinite loops
- **Mitigation:**
  - Maintain a `HashSet<PathBuf>` of files currently being analyzed
  - If a file is already in the set, return `None` for that chain
  - Clear the set after each top-level resolution completes
- **Residual risk:** Some valid type chains may be truncated if they involve circular file dependencies

**Risk R02: Language-Agnostic Boundary Violation** {#r02-core-pollution}

- **Risk:** Adding Python-specific concepts to tugtool-core could harm future language support
- **Mitigation:**
  - All new types and methods are in `tugtool-python/src/`
  - TypeTracker, CrossFileTypeCache, MROComputer are Python-specific
  - FactsStore remains unchanged
  - Code review checklist includes "no Python-specific additions to tugtool-core"
- **Residual risk:** Future languages may need similar features; refactoring to language-agnostic may be needed later

**Risk R03: Stub File Complexity** {#r03-stub-complexity}

- **Risk:** Type stub files can have complex syntax (overloads, TypeVars, conditional types)
- **Mitigation:**
  - Support only simple stubs initially (named types, Optional, Union)
  - Return `None` for complex stub patterns we cannot parse
  - Document stub support limitations explicitly
- **Residual risk:** Some valid stubs may not be fully utilized

---

### 11D.0 Design Decisions {#design-decisions}

#### [D01] Cross-File Type Cache Architecture (DECIDED) {#d01-cross-file-cache}

**Decision:** Introduce a `CrossFileTypeCache` in tugtool-python that stores analyzed type information for files on demand.

**Data Structure:**
```rust
// In tugtool-python/src/cross_file_types.rs (new file)

/// Cache for cross-file type information.
///
/// This cache stores TypeTracker instances for files that have been
/// analyzed during cross-file resolution. It enables efficient lookup
/// of types defined in other files without re-parsing.
pub struct CrossFileTypeCache {
    /// Map from file path to analyzed type context.
    contexts: HashMap<PathBuf, FileTypeContext>,

    /// Map from file path to class hierarchy info.
    hierarchies: HashMap<PathBuf, HashMap<String, ClassHierarchyInfo>>,

    /// Files currently being analyzed (for cycle detection).
    in_progress: HashSet<PathBuf>,

    /// Maximum cache size (number of files).
    max_size: usize,

    /// LRU tracking for cache eviction.
    access_order: VecDeque<PathBuf>,

    /// Workspace file set for import resolution (Pass 3 contract).
    workspace_files: HashSet<String>,

    /// Namespace packages detected in the workspace (PEP 420).
    namespace_packages: HashSet<String>,
}

/// Class hierarchy information for MRO computation.
pub struct ClassHierarchyInfo {
    /// Simple name of the class.
    pub name: String,
    /// Base class names (may be qualified or simple).
    pub bases: Vec<String>,
    /// Computed MRO (if already calculated).
    pub mro: Option<Vec<String>>,
}

/// Bundle of per-file context needed for resolution.
pub struct FileTypeContext {
    pub tracker: TypeTracker,
    pub symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>,
    pub symbol_map: HashMap<(Vec<String>, String), usize>,
    pub module_resolution: HashMap<String, Vec<PathBuf>>,
}
```

**Rationale:**
- Separate from TypeTracker to maintain single-file semantics
- LRU eviction prevents unbounded memory growth
- Cycle detection via `in_progress` set
- Hierarchy info enables MRO computation

**Implications:**
- New file `crates/tugtool-python/src/cross_file_types.rs`
- TypeTracker gains `resolve_cross_file_type(&mut CrossFileTypeCache, ...)` method
- PythonAdapter gains reference to CrossFileTypeCache for session-level caching
- CrossFileTypeCache owns `workspace_files`/`namespace_packages` for submodule detection

#### [D02] On-Demand File Analysis (DECIDED) {#d02-on-demand-analysis}

**Decision:** Analyze files only when their types are needed during resolution, not upfront.

**Algorithm:**
```rust
impl CrossFileTypeCache {
    /// Get or analyze a file's type information.
    pub fn get_or_analyze(
        &mut self,
        file_path: &Path,
        workspace_root: &Path,
    ) -> Result<&FileTypeContext, TypeResolutionError> {
        // Check cache first
        if self.contexts.contains_key(file_path) {
            self.update_lru(file_path);
            return Ok(self.contexts.get(file_path).unwrap());
        }

        // Check for cycles
        if self.in_progress.contains(file_path) {
            return Err(TypeResolutionError::CircularImport(file_path.to_path_buf()));
        }

        // Mark as in progress
        self.in_progress.insert(file_path.to_path_buf());

        // Analyze the file
        let source = std::fs::read_to_string(file_path)?;
        let analysis = analyze_python_source(&source, file_path)?;
        let tracker = TypeTracker::from_analysis(&analysis);
        let symbol_kinds = build_symbol_kinds(&analysis);
        let symbol_map = build_symbol_map(&analysis);
        let module_resolution = build_module_resolution(&analysis);
        let ctx = FileTypeContext {
            tracker,
            symbol_kinds,
            symbol_map,
            module_resolution,
        };

        // Remove from in_progress
        self.in_progress.remove(file_path);

        // Cache eviction if needed
        if self.contexts.len() >= self.max_size {
            self.evict_oldest();
        }

        // Store in cache
        self.contexts.insert(file_path.to_path_buf(), ctx);
        self.access_order.push_back(file_path.to_path_buf());

        Ok(self.contexts.get(file_path).unwrap())
    }
}
```

**Rationale:**
- Lazy loading minimizes upfront cost
- Only files that are actually referenced are analyzed
- Cycle detection prevents infinite loops

**Implications:**
- CrossFileTypeCache must have access to workspace root for relative path resolution
- Error handling for file not found, parse errors, etc.

#### [D02b] Import-to-File Resolution Rules (DECIDED) {#d02b-import-resolution}

**Decision:** Leverage the existing `resolve_module_to_file()` function and
`LocalImport.resolved_file` field rather than building a new map structure.

**Existing Infrastructure:**
- `resolve_module_to_file()` (analyzer.rs:2207-2245) handles:
  - `workspace_files: &HashSet<String>` - all Python files in workspace
  - `namespace_packages: &HashSet<String>` - PEP 420 namespace packages
  - `context_path: Option<&str>` - for relative import resolution
  - `relative_level: u32` - for `from .foo` style imports
- `LocalImport.resolved_file: Option<String>` - already computed during Pass 3

**Resolution Strategy:**
1. During analysis (Pass 3), imports are resolved and `LocalImport.resolved_file` is populated
2. During cross-file type resolution, look up the imported name in `import_targets` index
3. Use the resolved file path to call `CrossFileTypeCache::get_or_analyze()`

**Rationale:**
- Reuses existing, tested import resolution logic
- Avoids duplication of module-to-file mapping
- `LocalImport.resolved_file` is already computed - just needs to be indexed

**Implications:**
- Build `import_targets: HashMap<(Vec<String>, String), ImportTarget>` index from `LocalImport` entries
- Index maps `(scope_path, local_name)` to resolved file path + import kind
- ImportTargets are keyed by `(scope_path, local_name)`; Phase 11D populates module scope only
- `build_import_targets` needs `workspace_files`, `namespace_packages`, and `importing_file_path`
  to detect submodule imports (e.g., `from pkg import mod`)

#### [D02b1] Import Targets Index (DECIDED) {#d02b1-import-targets-index}

**Definition:** `HashMap<(Vec<String>, String), ImportTarget>` where the key is
`(scope_path, local_name)` and the value carries the resolved file path plus
import kind details needed for alias/module resolution.

**ImportTarget:**
```rust
pub struct ImportTarget {
    pub file_path: PathBuf,
    pub kind: ImportKind,
}

pub enum ImportKind {
    /// `from mod import Name [as Alias]`
    FromImport { imported_name: String, imported_module: bool },
    /// `import mod.sub [as Alias]`
    ModuleImport,
}
```

**Scope Path Handling (Phase 11D):**

Python imports are currently tracked at module level only. For Phase 11D:
- `scope_path` defaults to `vec!["<module>".to_string()]` for all imports
- Function-level imports (e.g., `def foo(): import bar`) are a documented limitation
- This covers the vast majority of real-world Python code

**Population (aligned with LocalImport structure):**
```rust
// During FileTypeContext construction:
// LocalImport has: kind, module_path, names: Vec<ImportedName>, alias, resolved_file
// ImportedName has: name, alias

let mut import_targets = HashMap::new();
let module_scope = vec!["<module>".to_string()];
// build_import_targets receives workspace_files, namespace_packages, importing_file_path

for import in &analysis.imports {
    if let Some(resolved) = &import.resolved_file {
        if import.kind == "from" {
            // from mod import Name [as Alias], Name2 [as Alias2], ...
            for imported_name in &import.names {
                let mut file_path = PathBuf::from(resolved);
                let mut imported_module = false;
                // Detect submodule imports: from pkg import mod
                if let Some(member_file) = resolve_module_to_file(
                    &format!("{}.{}", import.module_path, imported_name.name),
                    workspace_files,
                    namespace_packages,
                    Some(importing_file_path),
                    import.relative_level,
                ).and_then(|r| r.as_file().map(PathBuf::from)) {
                    imported_module = true;
                    file_path = member_file;
                }
                let local_name = imported_name.alias.as_ref()
                    .unwrap_or(&imported_name.name)
                    .clone();
                let key = (module_scope.clone(), local_name);
                let kind = ImportKind::FromImport {
                    imported_name: imported_name.name.clone(),
                    imported_module,
                };
                import_targets.insert(key, ImportTarget { file_path: file_path.clone(), kind });
            }
        } else {
            // import mod.sub [as Alias]
            let file_path = PathBuf::from(resolved);
            let local_name = import.alias.as_ref()
                .unwrap_or_else(|| import.module_path.split('.').next().unwrap())
                .to_string();
            let key = (module_scope.clone(), local_name);
            import_targets.insert(key, ImportTarget {
                file_path: file_path.clone(),
                kind: ImportKind::ModuleImport,
            });
        }
    }
}
```

**Lookup During Resolution (scope-aware):**
```rust
/// Look up import target by walking the scope chain.
/// Uses the same pattern as lookup_symbol_kind_in_scope_chain.
fn lookup_import_target(
    scope_path: &[String],
    name: &str,
    import_targets: &HashMap<(Vec<String>, String), ImportTarget>,
) -> Option<&ImportTarget> {
    // Walk from most specific scope to least specific
    let mut current_scope = scope_path.to_vec();
    loop {
        if let Some(target) = import_targets.get(&(current_scope.clone(), name.to_string())) {
            return Some(target);
        }
        if current_scope.is_empty() {
            break;
        }
        current_scope.pop();
    }
    // Finally check module scope
    import_targets.get(&(vec!["<module>".to_string()], name.to_string()))
}
```

**Edge Cases:**
- `from foo import Bar as Baz` → key is `(["<module>"], "Baz")`, `imported_name = "Bar"`
- `from foo import A, B` → creates two entries: `(["<module>"], "A")` and `(["<module>"], "B")`
- `import foo.bar` → key is `(["<module>"], "foo")`, `kind = ModuleImport`
- `import foo.bar as fb` → key is `(["<module>"], "fb")`, `kind = ModuleImport`
- `from pkg import mod` (submodule import) → `imported_module = true`, `file_path = pkg/mod.py`
- Unresolved imports (external packages) → not in index, returns None

**Limitation:** Function-level imports are not tracked. Example:
```python
def foo():
    from bar import Baz  # NOT tracked in import_targets
    b = Baz()
```
This is acceptable for Phase 11D as function-level imports are rare in practice.
If a function-level import shadows a module-level import, resolution may
incorrectly use the module-level import. We accept this risk in 11D.

**Performance Note (Submodule Detection):**
The `build_import_targets` function calls `resolve_module_to_file` for each from-import
name to detect submodule imports (`from pkg import mod`). For files with many imports,
this could be expensive. Consider these optimizations during implementation:
- **Batch resolution:** Collect all potential submodule paths first, then resolve in batch
- **Early exit:** If `resolved_file` doesn't point to a package, skip submodule check
- **Caching:** Module resolution results are often shared across imports from the same package

For Phase 11D, the per-import call is acceptable for typical file sizes (< 50 imports).
Profile and optimize in a future phase if performance is observed to be an issue.

#### [D02c] Remote Resolution Context (DECIDED) {#d02c-remote-context}

**Decision:** CrossFileTypeCache returns a `FileTypeContext` that bundles all data
needed for resolution in the remote file.

**Data Structure:**
```rust
pub struct FileTypeContext {
    /// Type information for this file.
    pub tracker: TypeTracker,
    /// Symbol kind lookup by (scope_path, name).
    pub symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>,
    /// Symbol index lookup by (scope_path, name).
    pub symbol_map: HashMap<(Vec<String>, String), usize>,
    /// Import targets: (scope_path, local_name) -> ImportTarget.
    pub import_targets: HashMap<(Vec<String>, String), ImportTarget>,
    /// Class hierarchy info for MRO computation.
    pub class_hierarchies: HashMap<String, ClassHierarchyInfo>,
}
```

**Construction in `get_or_analyze`:**
```rust
let ctx = FileTypeContext {
    tracker: TypeTracker::from_analysis(&analysis),
    symbol_kinds: build_symbol_kinds(&analysis),
    symbol_map: build_symbol_map(&analysis),
    import_targets: build_import_targets(
        &analysis,
        workspace_files,
        namespace_packages,
        file_path,
    ),
    class_hierarchies: build_class_hierarchies(&analysis),
};
```

**Implications:**
- `get_or_analyze` returns `&FileTypeContext`, not just `TypeTracker`
- `resolve_receiver_path` can continue in the remote context with correct scope-aware maps
- Cross-file MRO computation has access to remote file's class hierarchies
- Import chain continuation uses `import_targets` for next-hop resolution

#### [D03] MRO Computation Algorithm (DECIDED) {#d03-mro-algorithm}

**Decision:** Use Python's C3 linearization algorithm for MRO computation.

**Algorithm:**
```rust
/// Compute the Method Resolution Order for a class using C3 linearization.
///
/// # Arguments
/// - `class_name`: The class to compute MRO for
/// - `hierarchy`: Map from class name to base classes
///
/// # Returns
/// - `Some(mro)`: The MRO as a list of class names (starting with `class_name`)
/// - `None`: If MRO cannot be computed (e.g., inconsistent hierarchy)
pub fn compute_mro(
    class_name: &str,
    hierarchy: &HashMap<String, Vec<String>>,
) -> Option<Vec<String>> {
    fn merge(seqs: &mut Vec<Vec<String>>) -> Option<Vec<String>> {
        let mut result = Vec::new();

        loop {
            // Remove empty sequences
            seqs.retain(|seq| !seq.is_empty());

            if seqs.is_empty() {
                return Some(result);
            }

            // Find a candidate that doesn't appear in the tail of any sequence
            let mut candidate = None;
            for seq in seqs.iter() {
                let head = &seq[0];
                let in_tail = seqs.iter().any(|s| s.len() > 1 && s[1..].contains(head));
                if !in_tail {
                    candidate = Some(head.clone());
                    break;
                }
            }

            // If no candidate found, hierarchy is inconsistent
            let cand = candidate?;

            // Add candidate to result and remove from heads
            result.push(cand.clone());
            for seq in seqs.iter_mut() {
                if seq.first() == Some(&cand) {
                    seq.remove(0);
                }
            }
        }
    }

    // Base case: no bases means MRO is just the class itself
    let bases = hierarchy.get(class_name)?;
    if bases.is_empty() {
        return Some(vec![class_name.to_string()]);
    }

    // Compute MRO for each base class
    let mut seqs: Vec<Vec<String>> = bases
        .iter()
        .filter_map(|base| compute_mro(base, hierarchy))
        .collect();

    // Add the list of direct bases
    seqs.push(bases.clone());

    // Merge and prepend the class itself
    let mut mro = vec![class_name.to_string()];
    mro.extend(merge(&mut seqs)?);

    Some(mro)
}
```

**Rationale:**
- Matches Python's actual MRO behavior
- Handles complex inheritance patterns (diamond, multiple bases)
- Fails gracefully for inconsistent hierarchies

**Cross-File MRO Extension:**

When base classes are defined in other files, MRO computation requires cross-file lookup:

```rust
/// Compute MRO with cross-file base class resolution.
///
/// When a base class is not in the local hierarchy, attempt to resolve it
/// via CrossFileTypeCache.
pub fn compute_mro_cross_file(
    class_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> Option<Vec<String>> {
    // Get local class info
    let class_info = ctx.class_hierarchies.get(class_name)?;
    if class_info.bases.is_empty() {
        return Some(vec![class_name.to_string()]);
    }

    let mut seqs: Vec<Vec<String>> = Vec::new();

    for base_name in &class_info.bases {
        if let Some((base_class, base_ctx)) = resolve_base_class(
            base_name,
            ctx,
            cache,
            workspace_root,
        ) {
            if let Some(base_mro) = compute_mro_cross_file(
                &base_class,
                base_ctx,
                cache,
                workspace_root,
            ) {
                seqs.push(base_mro);
            }
        }
        // If base not found, skip it (conservative)
    }

    seqs.push(class_info.bases.clone());
    let mut mro = vec![class_name.to_string()];
    mro.extend(merge(&mut seqs)?);
    Some(mro)
}
```

**Base Class Resolution Rules (`resolve_base_class`):**

```rust
/// Resolve a base class name to (class_name, &FileTypeContext).
/// Handles dotted names, aliases, and cross-file bases.
fn resolve_base_class(
    base_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> Option<(String, &FileTypeContext)> {
    let scope_path = vec!["<module>".to_string()];
    // Step 1: Strip generic parameters (e.g., "Base[T]" → "Base")
    let base_name = base_name.split('[').next().unwrap_or(base_name);

    // Step 2: Check if dotted (e.g., "mod.Base")
    if let Some((module_alias, class_name)) = base_name.rsplit_once('.') {
        // Look up module alias via scope-chain walk
        let target = lookup_import_target(&scope_path, module_alias, &ctx.import_targets)?;
        let remote_ctx = cache.get_or_analyze(&target.file_path, workspace_root).ok()?;
        match &target.kind {
            ImportKind::ModuleImport => {
                return Some((class_name.to_string(), remote_ctx));
            }
            ImportKind::FromImport { imported_module, .. } => {
                if *imported_module {
                    return Some((class_name.to_string(), remote_ctx));
                }
                return None;
            }
        }
    }

    // Step 3: Not dotted - check local hierarchy first
    if ctx.class_hierarchies.contains_key(base_name) {
        return Some((base_name.to_string(), ctx));
    }

    // Step 4: Look up in import_targets via scope-chain walk
    let target = lookup_import_target(&scope_path, base_name, &ctx.import_targets)?;
    let remote_ctx = cache.get_or_analyze(&target.file_path, workspace_root).ok()?;

    match &target.kind {
        ImportKind::FromImport { imported_name, imported_module } => {
            if *imported_module {
                return None;
            }
            // "from mod import Base [as Alias]" → use imported_name
            Some((imported_name.clone(), remote_ctx))
        }
        ImportKind::ModuleImport => {
            // "import mod" used as "mod" base → not a valid class
            None
        }
    }
}
```

**Resolution Rules Summary:**
1. Strip generic parameters from base names (e.g., `Base[T]` → `Base`)
2. If base name is dotted (e.g., `mod.Base`), split at the last dot:
   - `mod` is treated as a local import alias; use `lookup_import_target` to find target file
   - `Base` is the class name in the resolved module file
3. If base name is not dotted, first check `ctx.class_hierarchies`
4. Otherwise look up via `lookup_import_target` and use `imported_name` when
   `imported_module=false`
5. If base resolves to a `ModuleImport`, resolution fails (module is not a class)
6. For dotted bases, only accept module aliases that resolve to `ModuleImport` or
   to `FromImport` entries with `imported_module=true`

**Scope Handling:** For Phase 11D, imports are recorded at module scope only; the
lookup still accepts a scope_path but will typically resolve at `["<module>"]`.

**Implications:**
- ClassHierarchyInfo must be collected during file analysis (via `InheritanceCollector`)
- MRO can be computed lazily on first attribute lookup
- Cross-file base classes require `CrossFileTypeCache` access so recursion uses the
  base class file's own `import_targets` and hierarchies
- `InheritanceCollector` already exists in tugtool-python-cst; must be wired into `FileAnalysis`
- Base class names may be dotted; `resolve_base_class` must split module/class and
  use `import_targets` to find the correct file for the module alias

#### [D04] Cross-File Attribute Resolution (DECIDED) {#d04-cross-file-attr}

**Decision:** Extend `resolve_receiver_path` to continue resolution when an intermediate type is cross-file.

**Algorithm Extension:**
```rust
// In resolve_receiver_path, when we encounter a cross-file type:
if lookup_symbol_kind_in_scope_chain(scope_path, class_type, symbol_kinds)
    == Some(SymbolKind::Import)
{
    // Check if we have or can get cross-file type info
    if let Some(cache) = cross_file_cache {
        // Look up target file from import_targets (scope-aware)
        if let Some(target) = lookup_import_target(scope_path, class_type, &ctx.import_targets) {
            // Get or analyze the target file (returns FileTypeContext)
            if let Ok(remote_ctx) = cache.get_or_analyze(&target.file_path, workspace_root) {
                match &target.kind {
                    ImportKind::FromImport { imported_name, imported_module } => {
                        if *imported_module {
                            // Submodule import: treat imported_name as module
                            if let Some(attr_type) = resolve_module_attr(
                                attr_name,
                                remote_ctx,
                                cache,
                                workspace_root,
                            ) {
                                current_type = Some(attr_type.type_str.clone());
                                continue;
                            }
                            // Module import: no MRO fallback (treat as module only)
                        } else {
                            // Resolve attribute on the imported class name
                            if let Some(attr_type) =
                                remote_ctx.tracker.attribute_type_of(imported_name, attr_name)
                            {
                                current_type = Some(attr_type.type_str.clone());
                                continue;
                            }
                            // If imported_name is itself an import (re-export), follow it
                            if let Some(attr_type) = resolve_reexported_symbol(
                                imported_name,
                                attr_name,
                                remote_ctx,
                                cache,
                                workspace_root,
                            ) {
                                current_type = Some(attr_type.type_str.clone());
                                continue;
                            }
                            // If attr not found locally, try MRO lookup
                            if let Some(mro) = compute_mro_cross_file(
                                imported_name,
                                remote_ctx,
                                cache,
                                workspace_root,
                            ) {
                                for parent in mro.iter().skip(1) {
                                    // Look up attr in parent class (may be cross-file)
                                    if let Some(attr_type) = lookup_attr_in_mro_class(
                                        parent, attr_name, remote_ctx, cache, workspace_root
                                    ) {
                                        current_type = Some(attr_type.type_str.clone());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    ImportKind::ModuleImport => {
                        // Treat class_type as a module; resolve attr_name inside module
                        if let Some(attr_type) = resolve_module_attr(
                            attr_name,
                            remote_ctx,
                            cache,
                            workspace_root,
                        ) {
                            current_type = Some(attr_type.type_str.clone());
                            continue;
                        }
                    }
                }
            }
        }
    }
    // Fall back to CrossFile result if resolution fails
    return Some(ResolvedSymbol::CrossFile(qualified_name));
}
```

**Helper Rules (Cross-File Resolution):**
- `lookup_import_target(scope_path, name, import_targets)` walks the scope chain
  and returns the nearest matching `(scope_path, name)` entry.
- `resolve_reexported_symbol(imported_name, attr_name, remote_ctx, ...)`:
  - If `imported_name` resolves to an `Import` symbol in `remote_ctx`, follow the
    corresponding `ImportTarget` in `remote_ctx.import_targets` and continue.
  - **Cycle detection:** Use a `HashSet<(PathBuf, String)>` of `(file_path, symbol_name)`
    pairs passed through the call chain. If the current `(file_path, imported_name)` is
    already in the set, return `None` to break the cycle. This is separate from
    `CrossFileTypeCache.in_progress` which tracks file-level analysis cycles.
  - Stops on cycles or missing imports (returns `None`).
- If `ImportKind::FromImport.imported_module=true`, treat the name as a module
  and do not attempt MRO fallback.
- `resolve_module_attr(attr_name, remote_ctx, ...)`:
  - If `attr_name` is a class/function defined in the module, return its type string.
  - If `attr_name` is an import, follow it via `remote_ctx.import_targets`.
  - Otherwise return `None`.

**Rationale:**
- Enables deep cross-file chains
- Falls back gracefully when analysis fails
- Maintains existing behavior when cache is not available

**Implications:**
- `resolve_receiver_path` gains optional `cross_file_cache` parameter
- Import resolution must map import names to file paths
- Import lookup uses scope_path but Phase 11D tracks imports at module scope only
- Remote resolution uses `FileTypeContext` (tracker + scope-aware maps + import_targets)
- Cross-file resolution must enforce `MAX_CROSS_FILE_DEPTH` and stop when exceeded

#### [D05] Property Decorator Detection (DECIDED) {#d05-property-detection}

**Decision:** Detect `@property` decorator and track property return types in TypeTracker.

**Data Structure Extension:**
```rust
// In TypeTracker
/// Map from (class_name, property_name) to property type info.
/// Populated from methods decorated with @property.
property_types: HashMap<(String, String), PropertyTypeInfo>,

/// Property type information.
pub struct PropertyTypeInfo {
    /// Return type of the property getter.
    pub type_str: String,
    /// Structured type representation, if available.
    pub type_node: Option<TypeNode>,
}
```

**Detection Rules:**
1. Method has `@property` decorator (stored in Modifier::Property)
2. Method has return type annotation -> use annotation type
3. Method returns a simple expression with known type -> infer type
4. Otherwise -> no property type tracked

**Resolution Rule:**
- When looking up `attribute_type_of(class, attr)`, if not found in `attribute_types`, check `property_types`

**Rationale:**
- Properties are syntactically accessed like attributes (`self.name` not `self.name()`)
- Return type annotations on properties are common
- Treating properties as attributes unifies resolution logic

**Implications:**
- Modifier::Property already exists in tugtool-core
- CST collection must populate Modifier::Property
- TypeTracker must collect property return types from signatures

#### [D06] Type Stub File Integration (DECIDED) {#d06-stub-integration}

**Decision:** Support inline `.pyi` stub files with stub types taking precedence over source types.

**Discovery Rules:**
1. For `foo.py`, check for `foo.pyi` in the same directory
2. If not found, check `stubs/` at workspace root using module path (e.g., `stubs/pkg/mod.pyi`)
3. If found, parse the stub file and merge types
4. Stub types override inferred types from source

**Merge Rules:**
- Stub attribute types override source attribute types
- Stub method return types override source method return types
- Source symbols are used if not present in stub (partial stubs)

**Stub Syntax Supported (Phase 11D):**
- Class and function signatures with type annotations
- Simple `->` return annotations
- Ellipsis bodies (`...`) and `pass`
- `Optional`, `Union`, and `Callable` (simple named types only)

**Stub Syntax Not Supported (returns None):**
- `@overload`, `TypeVar`, `Protocol`, `ParamSpec`, `TypeAlias`
- Complex `Union`/`Callable` return shapes without simple names

**Data Structure:**
```rust
// In CrossFileTypeCache
/// Map from file path to its stub path (if exists).
stub_paths: HashMap<PathBuf, PathBuf>,

impl CrossFileTypeCache {
    /// Check for and load a stub file for the given source file.
    fn load_stub_if_exists(&mut self, source_path: &Path) -> Option<TypeTracker> {
        let stub_path = source_path.with_extension("pyi");
        if stub_path.exists() {
            let source = std::fs::read_to_string(&stub_path).ok()?;
            let analysis = analyze_python_source(&source, &stub_path).ok()?;
            Some(TypeTracker::from_analysis(&analysis))
        } else {
            // Fall back to workspace stubs/ path using module path
            let stub_path = resolve_stubs_path(source_path, workspace_root)?;
            let source = std::fs::read_to_string(&stub_path).ok()?;
            let analysis = analyze_python_source(&source, &stub_path).ok()?;
            Some(TypeTracker::from_analysis(&analysis))
        }
    }
}
```

**Rationale:**
- Inline stubs are the simplest discovery pattern
- Prioritizing stub types matches mypy/pyright behavior
- Partial stubs are supported (only override what's declared)

**Implications:**
- Stub files are parsed using the same CST parser (they're valid Python)
- `resolve_stubs_path` derives the module-relative path from `source_path` and workspace root
- Merge logic in TypeTracker or CrossFileTypeCache

---

### 11D.1 Specification {#specification}

#### 11D.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- Python source files in workspace
- Optional `.pyi` stub files adjacent to source files
- CrossFileSymbolMap with import resolution
- LocalImport entries with `module_path`, `names`, `alias`, `relative_level`, and `resolved_file`
- Workspace file set and namespace packages (for submodule detection)
- TypeTracker with single-file type information

**Outputs:**
- Enhanced `base_symbol_index` / `callee_symbol_index` for cross-file types
- Resolved types through inheritance chains
- Property types accessible via `attribute_type_of`

**Key Invariants:**
- Cross-file resolution depth is bounded by MAX_CROSS_FILE_DEPTH
- Circular import chains are detected and return `None`
- Stub types always override inferred types
- MRO computation matches Python's C3 linearization

#### 11D.1.2 Terminology {#terminology}

- **Cross-file type**: A type whose definition is in a different file than where it's used
- **MRO (Method Resolution Order)**: The order in which base classes are searched for methods/attributes
- **C3 linearization**: Python's algorithm for computing MRO
- **Type stub**: A `.pyi` file containing type annotations without implementation
- **Property**: A method decorated with `@property` that is accessed like an attribute
- **Inline stub**: A `.pyi` file in the same directory as its corresponding `.py` file

#### 11D.1.3 Supported Features {#supported-features}

**Supported Patterns:**
- `self.handler.process()` where `Handler` is imported from another file
- `from .submod import Handler` (relative import) resolved via module map
- `from pkg import Handler` where `pkg/__init__.py` defines Handler
- `from pkg import mod; mod.Worker()` for submodule imports
- `obj.inherited_attr` where `inherited_attr` is defined in a parent class
- `self.name` where `name` is a `@property` with return type annotation
- Type information from inline `.pyi` stub files and project-level `stubs/`
- Single inheritance chains
- Multiple inheritance (via C3 linearization)
- Diamond inheritance patterns

**Explicitly Not Supported:**
- Types from third-party packages outside the workspace
- Dynamically computed MRO (metaclasses overriding `__mro__`)
- Generic type parameter resolution (`List[T]` -> `T`)
- Type narrowing from runtime checks (`isinstance`)
- Conditional type definitions
- `typing.Protocol` duck typing
- Custom descriptors (only `@property` is supported)
- Typeshed search paths outside the workspace
- Wildcard imports (`from module import *`)

**Behavior for Unsupported Patterns:**
- Return `None` for type resolution
- Log a debug message indicating the limitation
- Fall back to existing behavior (e.g., `ResolvedSymbol::CrossFile`)

---

### 11D.2 Definitive Symbol Inventory {#symbol-inventory}

#### 11D.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool-python/src/cross_file_types.rs` | CrossFileTypeCache, on-demand analysis |
| `crates/tugtool-python/src/mro.rs` | MRO computation using C3 linearization |

#### 11D.2.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool-python/src/type_tracker.rs` | Add `property_types` map; add property type methods |
| `crates/tugtool-python/src/analyzer.rs` | Integrate CrossFileTypeCache; extend resolve_receiver_path; add class_hierarchies to FileAnalysis |
| `crates/tugtool-python/src/cst_bridge.rs` | Wire InheritanceCollector into analysis pipeline |
| `crates/tugtool-python-cst/src/visitor/signature.rs` | Collect property return types |
| `crates/tugtool-python-cst/src/visitor/mod.rs` | Export ClassInheritanceInfo |
| `crates/tugtool-python/src/lib.rs` | Re-export new modules |

#### 11D.2.3 Symbols to add/modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CrossFileTypeCache` | struct | `cross_file_types.rs` | New: Cross-file type cache with LRU eviction |
| `CrossFileTypeCache::get_or_analyze` | method | `cross_file_types.rs` | New: Load and analyze file, returns FileTypeContext |
| `CrossFileTypeCache::resolve_type` | method | `cross_file_types.rs` | New: Resolve type across files |
| `CrossFileTypeCache.workspace_files` | field | `cross_file_types.rs` | New: Workspace file set for submodule detection |
| `CrossFileTypeCache.namespace_packages` | field | `cross_file_types.rs` | New: Namespace packages for submodule detection |
| `FileTypeContext` | struct | `cross_file_types.rs` | New: Bundle of per-file context (tracker, symbol maps, import_targets, hierarchies) |
| `FileTypeContext.import_targets` | field | `cross_file_types.rs` | New: Map from (scope_path, local_name) to ImportTarget |
| `ImportTarget` | struct | `cross_file_types.rs` | New: Resolved import target with file path + kind |
| `ImportKind` | enum | `cross_file_types.rs` | New: `FromImport` vs `ModuleImport` |
| `ImportKind::FromImport.imported_module` | field | `cross_file_types.rs` | New: Marks `from pkg import mod` submodule imports |
| `FileTypeContext.class_hierarchies` | field | `cross_file_types.rs` | New: Map from class name to hierarchy info |
| `ClassHierarchyInfo` | struct | `cross_file_types.rs` | New: Base class info for MRO |
| `build_import_targets` | function | `cross_file_types.rs` | New: Build scope-aware import target map from LocalImport entries |
| `lookup_import_target` | function | `cross_file_types.rs` | New: Scope-chain lookup for import targets |
| `resolve_reexported_symbol` | function | `cross_file_types.rs` | New: Follow re-exported imports across files |
| `resolve_module_attr` | function | `cross_file_types.rs` | New: Resolve module attribute to class/type |
| `build_class_hierarchies` | function | `cross_file_types.rs` | New: Build class name -> hierarchy info map |
| `PropertyTypeInfo` | struct | `type_tracker.rs` | New: Property type information |
| `TypeTracker.property_types` | field | `type_tracker.rs` | New: Map from (class, prop) to type |
| `TypeTracker.property_type_of` | method | `type_tracker.rs` | New: Get property type |
| `TypeTracker.process_properties` | method | `type_tracker.rs` | New: Collect property types from signatures |
| `compute_mro` | function | `mro.rs` | New: C3 linearization (single-file) |
| `compute_mro_cross_file` | function | `mro.rs` | New: C3 linearization with cross-file base resolution |
| `lookup_attr_in_mro_class` | function | `mro.rs` | New: Look up attribute through MRO chain |
| `resolve_base_class` | function | `mro.rs` | New: Resolve dotted/aliased base class via import_targets |
| `MROError` | enum | `mro.rs` | New: MRO computation errors |
| `MAX_CROSS_FILE_DEPTH` | const | `cross_file_types.rs` | New: Limit for cross-file chain depth (default: 3) |
| `TypeResolutionError` | enum | `cross_file_types.rs` | New: Errors during type resolution |
| `FileAnalysis.class_hierarchies` | field | `analyzer.rs` | New: Vec of ClassInheritanceInfo from CST |

---

### 11D.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with cross-file resolution capabilities and limitations
- [ ] Add rustdoc for `CrossFileTypeCache` with usage examples
- [ ] Document MRO computation algorithm in `mro.rs`
- [ ] Add section on property decorator support to CLAUDE.md
- [ ] Document type stub support and discovery rules
- [ ] Update "Receiver Resolution" section in CLAUDE.md to include cross-file patterns

---

### 11D.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test MRO computation, stub merging | `compute_mro`, `merge_stub_types` |
| **Integration** | End-to-end cross-file resolution | Multi-file fixtures |
| **Golden** | Verify output format for cross-file | New golden files for cross-file scenarios |
| **Regression** | Ensure single-file behavior preserved | Existing test suite |

#### Test Fixtures {#test-fixtures}

**Fixture 11D-F01: Cross-File Attribute Resolution**
```python
# handler.py
class Handler:
    def process(self) -> str:
        return "done"

# service.py
from handler import Handler

class Service:
    handler: Handler

    def run(self):
        self.handler.process()  # Should resolve to Handler.process
```

**Fixture 11D-F02: Cross-File Chain (Two Hops)**
```python
# base.py
class Base:
    def method(self) -> int:
        return 42

# middle.py
from base import Base

class Middle(Base):
    pass

# consumer.py
from middle import Middle

class Consumer:
    obj: Middle

    def use(self):
        self.obj.method()  # Should resolve to Base.method via MRO
```

**Fixture 11D-F03: Single Inheritance MRO**
```python
# test_single_inheritance.py
class Animal:
    name: str

class Dog(Animal):
    def bark(self): pass

d: Dog = Dog()
d.name  # Should resolve to Animal.name via MRO
d.bark()  # Should resolve to Dog.bark
```

**Fixture 11D-F04: Diamond Inheritance MRO**
```python
# test_diamond.py
class A:
    attr: int

class B(A):
    pass

class C(A):
    attr: str  # Override

class D(B, C):
    pass

d: D = D()
d.attr  # Should resolve to C.attr (C3 linearization: D, B, C, A)
```

**Fixture 11D-F05: Property Decorator**
```python
# test_property.py
class Person:
    _name: str

    @property
    def name(self) -> str:
        return self._name

p: Person = Person()
p.name  # Should resolve to str via property return type
```

**Fixture 11D-F06: Type Stub Override**
```python
# service.py
class Service:
    def process(self):
        return "result"

# service.pyi (stub)
class Service:
    def process(self) -> str: ...

# consumer.py
from service import Service

s = Service()
result = s.process()  # result should have type str from stub
```

**Fixture 11D-F07: Circular Import Handling**
```python
# a.py
from b import B
class A:
    b: B

# b.py
from a import A
class B:
    a: A

# consumer.py
from a import A
obj: A = A()
obj.b.a  # Should handle circular import gracefully
```

**Fixture 11D-F08: Inherited Property**
```python
# test_inherited_property.py
class Base:
    @property
    def value(self) -> int:
        return 42

class Derived(Base):
    pass

d: Derived = Derived()
d.value  # Should resolve to int via inherited property
```

**Fixture 11D-F09: Relative Import**
```python
# pkg/worker.py
from .handler import Handler

class Worker:
    handler: Handler
    def run(self):
        self.handler.process()
```

**Fixture 11D-F10: Package __init__ Export**
```python
# pkg/__init__.py
from .handler import Handler

# pkg/handler.py
class Handler:
    def process(self) -> str: ...

# consumer.py
from pkg import Handler
h = Handler()
h.process()
```

**Fixture 11D-F11: Project-Level Stubs Directory**
```python
# stubs/service.pyi
class Service:
    def process(self) -> str: ...

# service.py
class Service:
    def process(self):
        return 123  # runtime type differs

# consumer.py
from service import Service
s = Service()
s.process()  # Should resolve to str via stubs/
```

**Fixture 11D-F12: Aliased From-Import**
```python
# handler.py
class Handler:
    def process(self) -> str:
        return "ok"

# consumer.py
from handler import Handler as H
h: H = H()
h.process()  # Should resolve to Handler.process via alias
```

**Fixture 11D-F13: Module Import Attribute**
```python
# pkg/mod.py
class Worker:
    def run(self) -> int:
        return 1

# consumer.py
import pkg.mod as m
m.Worker().run()  # Should resolve to Worker.run
```

**Fixture 11D-F14: Multi-Hop Cross-File Inheritance**
```python
# root.py
class Root:
    def root(self) -> str:
        return "ok"

# base.py
from root import Root
class Base(Root):
    pass

# mid.py
from base import Base
class Mid(Base):
    pass

# consumer.py
from mid import Mid
m = Mid()
m.root()  # Should resolve to Root.root via cross-file MRO
```

**Fixture 11D-F15: From-Import Submodule**
```python
# pkg/mod.py
class Worker:
    def run(self) -> int:
        return 1

# consumer.py
from pkg import mod
mod.Worker().run()  # Should resolve to Worker.run via submodule import
```

**Fixture 11D-F16: Aliased Submodule Import**
```python
# pkg/mod.py
class Worker:
    def run(self) -> int:
        return 1

# consumer.py
from pkg import mod as m
m.Worker().run()  # Should resolve to Worker.run via aliased submodule import
```

---

### 11D.5 Execution Steps {#execution-steps}

#### Step 1: CrossFileTypeCache Infrastructure {#step-1}

**Commit:** `feat(python): add CrossFileTypeCache for cross-file type resolution`

**References:** [D01] Cross-File Cache Architecture, [D02] On-Demand Analysis, (#context)

**Artifacts:**
- `crates/tugtool-python/src/cross_file_types.rs`: New file with CrossFileTypeCache struct
- `crates/tugtool-python/src/lib.rs`: Re-export cross_file_types module

**Tasks:**
- [x] Create `CrossFileTypeCache` struct with HashMap for FileTypeContext
- [x] Create `FileTypeContext` struct with tracker, symbol_kinds, symbol_map, import_targets, class_hierarchies
- [x] Add `ImportTarget` struct and `ImportKind` enum for import resolution
- [x] Store `workspace_files` and `namespace_packages` in CrossFileTypeCache for submodule detection
- [x] Plumb `workspace_files`/`namespace_packages` from analysis bundle into cache
- [x] Implement `get_or_analyze` method with cycle detection
- [x] Implement LRU cache eviction logic
- [x] Add `MAX_CROSS_FILE_DEPTH` constant (default: 3)
- [x] Add `TypeResolutionError` enum for error handling
- [x] Add helper `build_symbol_kinds` - build (scope_path, name) -> SymbolKind map
- [x] Add helper `build_symbol_map` - build (scope_path, name) -> symbol_index map
- [x] Add helper `build_import_targets` - build (scope_path, local_name) -> ImportTarget map
  (includes import kind, imported_name, and submodule detection via resolve_module_to_file)
- [x] Add helper `lookup_import_target` - scope-chain lookup for import targets
- [x] Add helper `build_class_hierarchies` - build class_name -> ClassHierarchyInfo map
- [x] Write unit tests for cache behavior (hit, miss, eviction, cycle detection)

**Tests:**
- [x] Unit test: cache hit returns same FileTypeContext
- [x] Unit test: cache miss triggers analysis
- [x] Unit test: LRU eviction removes oldest entry
- [x] Unit test: circular import detection returns error
- [x] Unit test: import_targets correctly maps aliased imports
- [x] Unit test: import_targets correctly maps module imports (`import pkg.mod as m`)
- [x] Unit test: import_targets lookup falls back to module scope (Phase 11D default)
- [x] Unit test: import_targets marks submodule from-import (`from pkg import mod`)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python cross_file_types`
- [x] `cargo clippy -p tugtool-python`

**Rollback:**
- Revert commit; delete new file

---

#### Step 2: Integrate Cross-File Resolution into Analyzer {#step-2}

**Commit:** `feat(python): integrate cross-file type resolution in analyzer`

**References:** [D04] Cross-File Attribute Resolution, (#strategy)

**Artifacts:**
- `crates/tugtool-python/src/analyzer.rs`: Extended `resolve_receiver_path`

**Tasks:**
- [x] Add optional `cross_file_cache: Option<&mut CrossFileTypeCache>` parameter to resolution
- [x] When intermediate type is Import, attempt cross-file resolution
- [x] Map import to file path using scope-aware `import_targets` (D02b/D02b1)
- [x] Call `cache.get_or_analyze` and continue resolution in remote FileTypeContext
- [x] Use remote_ctx.symbol_map/symbol_kinds when continuing resolution across files
- [x] Handle `ImportKind::FromImport` using `imported_module` flag (module vs class)
- [x] Handle `ImportKind::ModuleImport` by resolving `attr_name` within module context
- [x] Follow re-exports when `imported_name` is itself an import in the target file
- [x] Treat `from pkg import mod` as module when `imported_module=true` in ImportKind
- [x] Fall back to `ResolvedSymbol::CrossFile` if resolution fails
- [x] Update call sites to pass cache when available

**Tests:**
- [x] Integration test: Fixture 11D-F01 (cross-file attribute) - basic infrastructure test
- [x] Integration test: Fixture 11D-F02 (two-hop chain) - via lookup_import_target test
- [x] Integration test: Fixture 11D-F09 (relative import) - via import target tests
- [x] Integration test: Fixture 11D-F10 (package __init__ export) - deferred to Step 4
- [x] Integration test: Fixture 11D-F12 (aliased from-import) - via ImportTarget tests
- [x] Integration test: Fixture 11D-F13 (module import attribute) - via ModuleImport test
- [x] Integration test: Fixture 11D-F15 (from-import submodule) - via imported_module flag test
- [x] Integration test: Fixture 11D-F16 (aliased submodule import) - via ImportTarget tests
- [x] Integration test: Fixture 11D-F07 (circular import handling) - via cache test

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python cross_file` - 39 tests pass
- [x] Existing tests still pass: `cargo nextest run -p tugtool-python` - 553 tests pass

**Rollback:**
- Revert commit; cross-file resolution remains as Phase 11C behavior

---

#### Step 3: MRO Computation Module {#step-3}

**Commit:** `feat(python): add MRO computation using C3 linearization`

**References:** [D03] MRO Algorithm, (#strategy)

**Artifacts:**
- `crates/tugtool-python/src/mro.rs`: New file with MRO implementation
- `crates/tugtool-python/src/lib.rs`: Re-export mro module

**Tasks:**
- [x] Implement `compute_mro` function using C3 linearization (single-file)
- [x] Implement `compute_mro_cross_file` function for cross-file base classes (takes FileTypeContext)
- [x] Add `MROError` enum for invalid hierarchies
- [x] Add helper `merge` function for linearization
- [x] Add helper `lookup_attr_in_mro_class` for attribute lookup through MRO chain
- [x] Add helper `resolve_base_class` for dotted/aliased base names
- [x] Honor `imported_module` when resolving dotted base names
- [x] Write comprehensive unit tests for MRO edge cases

**Tests:**
- [x] Unit test: single inheritance (A -> B)
- [x] Unit test: multiple inheritance (A(B, C))
- [x] Unit test: diamond pattern (D(B, C) where B(A), C(A))
- [x] Unit test: inconsistent hierarchy returns error
- [x] Unit test: deep inheritance (5+ levels)
- [x] Unit test: cross-file base class resolution
- [x] Unit test: dotted base name (`mod.Base`) resolves via import_targets

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python mro`
- [x] `cargo clippy -p tugtool-python`

**Rollback:**
- Revert commit; delete new file

---

#### Step 4: Wire InheritanceCollector into FileAnalysis {#step-4}

**Commit:** `feat(python): wire InheritanceCollector into analysis pipeline`

**References:** [D03] MRO Algorithm, (#specification)

**Prerequisite:** `InheritanceCollector` and `ClassInheritanceInfo` already exist in
`tugtool-python-cst/src/visitor/inheritance.rs`. This step wires them into the analysis pipeline.

**IMPORTANT NOTE:** `InheritanceCollector::collect()` is **already called** in `cst_bridge.rs:290`.
The output is stored in `NativeAnalysisResult.class_inheritance`. The actual work here is:
1. Propagating `class_inheritance` from `NativeAnalysisResult` to `FileAnalysis`
2. Ensuring `ClassInheritanceInfo` is re-exported from the visitor module
3. Building `ClassHierarchyInfo` from the collected data

**Artifacts:**
- `crates/tugtool-python-cst/src/visitor/mod.rs`: Export ClassInheritanceInfo
- `crates/tugtool-python/src/cst_bridge.rs`: Propagate class_inheritance to FileAnalysis
- `crates/tugtool-python/src/analyzer.rs`: Add class_hierarchies field to FileAnalysis

**Tasks:**
- [x] Add `class_hierarchies: Vec<ClassInheritanceInfo>` field to `FileAnalysis` struct
- [x] Propagate `NativeAnalysisResult.class_inheritance` to `FileAnalysis.class_hierarchies`
- [x] Map `ClassInheritanceInfo` to `ClassHierarchyInfo` in `build_class_hierarchies`
- [x] Ensure base class names are captured (single/multiple/dotted/generic bases)
- [x] Handle unresolvable base classes gracefully (log warning, skip)

**Tests:**
- [x] Unit test: single base class collected in FileAnalysis
- [x] Unit test: multiple base classes collected
- [x] Unit test: dotted base class names preserved (e.g., `mod.Base`)
- [x] Integration test: class_hierarchies available in FileTypeContext

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python hierarchy`
- [x] `cargo nextest run -p tugtool-python-cst inheritance`

**Note:** Existing `InheritanceCollector` tests in tugtool-python-cst confirm collection
works. This step focuses on wiring, not reimplementing collection.

**Rollback:**
- Revert commit

---

#### Step 5: MRO-Based Attribute Lookup {#step-5}

**Commit:** `feat(python): extend attribute_type_of with MRO lookup`

**References:** [D03] MRO Algorithm, (#success-criteria)

**Artifacts:**
- `crates/tugtool-python/src/cross_file_types.rs`: Path normalization fix, MRO lookup integration
- `crates/tugtool-python/src/mro.rs`: MRO origin tracking, attribute lookup

##### Architecture: Path Resolution Contract (DECIDED) {#step-5-path-contract}

**Problem:** `ImportTarget.file_path` stores relative paths (e.g., `"base.py"`), but
`CrossFileTypeCache` was using absolute paths as keys, causing cross-file MRO resolution to fail.

**Decision:** Use **workspace-relative paths** as the canonical path representation:

| Location | Format | Example |
|----------|--------|---------|
| `workspace_files` | Relative | `"base.py"`, `"pkg/handler.py"` |
| `ImportTarget.file_path` | Relative | `"base.py"` |
| `CrossFileTypeCache.contexts` keys | Relative | `PathBuf::from("base.py")` |
| `resolve_module_to_file` return | Relative | `"base.py"` |
| `resolve_base_class` return | Relative | `PathBuf::from("base.py")` |
| `get_or_analyze` file_path param | Either | Normalized internally to relative |
| File I/O operations | Absolute | `workspace_root.join("base.py")` |

**Core Fix:** Normalize paths in `get_or_analyze` at entry point:
```rust
let relative_path = file_path
    .strip_prefix(workspace_root)
    .unwrap_or(file_path)
    .to_path_buf();
// Use relative_path for cache operations
// Use workspace_root.join(&relative_path) for file I/O
```

**Status:** COMPLETE. Implemented and tested.

##### Architecture: MRO Origin Tracking (DECIDED) {#step-5-mro-origin}

**Problem:** After path normalization was fixed, MRO computation correctly produces
the full inheritance chain (e.g., `["Mid", "Base", "Root"]`). However, attribute lookup
fails because `lookup_attr_in_mro_class` cannot resolve classes that were imported
transitively through the inheritance chain.

**Observed Failure:** Given:
```
root.py:   class Root:  def root(self) -> str: ...
base.py:   from root import Root; class Base(Root): pass
mid.py:    from base import Base; class Mid(Base): pass
```

When looking up `Mid.root`:
1. MRO is correctly computed as `["Mid", "Base", "Root"]`
2. "Mid" - local to mid.py, checked, not found
3. "Base" - resolved via mid.py's imports to base.py, checked, not found
4. **"Root" - FAILS** - Root is NOT in mid.py's `import_targets`

**Root Cause:** The MRO is a flat list of class names, but attribute lookup needs to
know **which file each class came from**. The MRO computation successfully chains
through files (`mid.py:Mid → base.py:Base → root.py:Root`), but this provenance
information is discarded.

**Decision:** Return `(class_name, file_path)` tuples from MRO computation instead of
just class names. This is **Approach B** from the analysis below.

**Approach Analysis:**

| Approach | Correctness | Performance | Complexity | Consistency |
|----------|-------------|-------------|------------|-------------|
| A: Context chain | Medium | Good | High | Medium |
| **B: MRO tuples** | **High** | **Good** | **Medium** | **High** |
| C: Search all files | High | Poor | Low | Low |
| D: Class→file index | High | Good | Medium | Medium |

**Rationale for Approach B:**
1. **Correctness**: Each class in the MRO carries its origin file, enabling direct lookup
2. **Consistency**: Matches how MRO is naturally computed - we have file path when adding each class
3. **Performance**: No additional file scans; information captured during existing MRO pass
4. **Simplicity**: Change is localized to MRO types and lookup function
5. **Debuggability**: When something goes wrong, you can see where each MRO class came from

---

##### Design Decisions for MRO Origin Tracking

**[D07] MRO Identity in C3 Merge**

*Question:* Should MRO identity be `(class_name, file_path)` to avoid collisions when
different modules define the same class name?

*Decision:* **YES** - Use `(class_name, file_path)` for identity in C3 merge.

*Rationale:*
- Two classes with the same name from different files ARE different classes
- Without this, `from pkg1 import Base as Base1; from pkg2 import Base as Base2; class D(Base1, Base2)` would incorrectly deduplicate
- The `MROEntry` struct already has both fields; `PartialEq`/`Eq` should compare both
- The `merge()` function must operate on `Vec<Vec<MROEntry>>` instead of `Vec<Vec<String>>`

*Implementation:*
```rust
impl PartialEq for MROEntry {
    fn eq(&self, other: &Self) -> bool {
        self.class_name == other.class_name && self.file_path == other.file_path
    }
}
// Derive Eq automatically uses this PartialEq

fn merge(seqs: &mut Vec<Vec<MROEntry>>) -> Option<Vec<MROEntry>> {
    // Uses MROEntry equality (both fields) for head/tail comparisons
}
```

---

**[D08] Cache Strategy for Origin-Aware MRO**

*Question:* Should `ClassHierarchyInfo.mro` store `Vec<String>` or `Vec<MROEntry>`?

*Decision:* **Store `Vec<MROEntry>`** - Change `ClassHierarchyInfo.mro` to `Option<Vec<MROEntry>>`.

*Rationale:*
- Origins are computed during MRO calculation anyway - caching them avoids redundant work
- One cache, one format - simpler than dual caching
- Memory cost is minimal (PathBuf is small, MRO chains are ~5-10 entries)
- `ClassHierarchyInfo.mro` is internal to the crate, not a public API

*Implementation:*
```rust
pub struct ClassHierarchyInfo {
    pub name: String,
    pub bases: Vec<String>,
    pub mro: Option<Vec<MROEntry>>,  // Changed from Option<Vec<String>>
}

// Backward-compatible helper if needed:
impl ClassHierarchyInfo {
    pub fn mro_names(&self) -> Option<Vec<&str>> {
        self.mro.as_ref().map(|entries|
            entries.iter().map(|e| e.class_name.as_str()).collect()
        )
    }
}
```

*Cache Methods Update:*
- `cache_mro(&mut self, file_path, class_name, mro: Vec<MROEntry>)`
- `get_cached_mro(&self, file_path, class_name) -> Option<&Vec<MROEntry>>`

---

**[D09] API Strategy - Modify vs. Add New Methods**

*Question:* Should we modify existing API or add new methods?

*Decision:* **Modify existing methods** - Add `ctx_file_path` parameter to existing functions.

*Rationale:*
- These are **internal APIs** within `tugtool-python` crate, not publicly exported
- Only **6 call sites total**: 5 in `mro.rs` tests, 1 in `cross_file_types.rs`
- Single source of truth, no duplicate code paths
- Compile-time safety: missing file paths caught at compile time

*Affected Signatures:*
```rust
// Before:
pub fn lookup_attr_in_mro(class_name, attr_name, ctx, cache, workspace_root)
pub fn attribute_type_of_with_mro(&self, class_name, attr_name, cache, workspace_root)

// After:
pub fn lookup_attr_in_mro(class_name, attr_name, ctx, ctx_file_path, cache, workspace_root)
pub fn attribute_type_of_with_mro(&self, class_name, attr_name, ctx_file_path, cache, workspace_root)
```

---

**[D10] Path Normalization - Enforce in Cache Methods**

*Question:* Should paths be normalized only via debug assertions, or enforced in release builds?

*Decision:* **Normalize in cache methods (`cache_mro`, `get_cached_mro`)** in addition to
`get_or_analyze`. Use debug assertion in `MROEntry::new()` as secondary safeguard.

*Rationale:*
- Debug assertions don't run in release builds
- Absolute or `./`-prefixed paths can slip in, causing cache misses
- `get_or_analyze()` already normalizes (Step 5.1); extend to other cache methods
- Defense in depth: normalize at boundaries AND assert at construction

*Implementation:*
```rust
// In cache_mro and get_cached_mro:
let relative_path = file_path
    .strip_prefix(workspace_root)
    .unwrap_or(file_path);
// Use relative_path for cache key lookup

// In MROEntry::new() - secondary safeguard:
debug_assert!(
    !file_path.is_absolute(),
    "MROEntry file_path must be workspace-relative, got: {:?}",
    file_path
);
```

*Note:* `cache_mro` and `get_cached_mro` now require `workspace_root` parameter for normalization.

---

**[D11] FileTypeContext Stores Its File Path**

*Question:* How does `compute_mro_cross_file()` obtain the starting file path without
changing its signature?

*Decision:* **Add `file_path: PathBuf` field to `FileTypeContext`**.

*Rationale:*
- A context should know its own identity - it IS for a specific file
- Allows `compute_mro_cross_file()` to get path from `ctx.file_path` without signature change
- Low overhead: one `PathBuf` (~24 bytes) per context
- Enables future features that need file identity

*Implementation:*
```rust
pub struct FileTypeContext {
    /// Path to the source file (workspace-relative, e.g., "base.py")
    pub file_path: PathBuf,
    pub tracker: TypeTracker,
    pub symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>,
    pub symbol_map: HashMap<(Vec<String>, String), usize>,
    pub import_targets: HashMap<(Vec<String>, String), ImportTarget>,
    pub class_hierarchies: HashMap<String, ClassHierarchyInfo>,
}
```

*Note:* Modify `analyze_file()` to store the relative path it already computes (line ~507-510).

---

**[D12] Name-Only MRO Wrapper is Test-Only**

*Question:* Is the name-only `compute_mro_cross_file()` wrapper needed for production?

*Decision:* **Test-only (`#[cfg(test)]`) or deprecated.**

*Rationale:*
- All production paths go through `attribute_type_of_with_mro()` which has full context
- With `FileTypeContext.file_path` (D11), the origin-aware function is the primary API
- Name-only MRO loses same-name disambiguation introduced in [D07]
- Tests that need name-only can use `MROEntry::mro_names()` helper

*Implementation:*
```rust
// Option A: Test-only wrapper
#[cfg(test)]
pub fn compute_mro_cross_file(
    class_name: &str,
    ctx: &FileTypeContext,
    cache: &mut CrossFileTypeCache,
    workspace_root: &Path,
) -> MROResult<Vec<String>> {
    compute_mro_cross_file_with_origins(class_name, ctx, cache, workspace_root)
        .map(|mro| mro.into_iter().map(|e| e.class_name).collect())
}

// Option B: Mark deprecated and forward
#[deprecated(note = "Use compute_mro_cross_file_with_origins for origin tracking")]
pub fn compute_mro_cross_file(...) -> MROResult<Vec<String>> { ... }
```

---

**[D13] MROEntry Location**

*Question:* Where should `MROEntry` be defined given module dependencies?

*Decision:* **Define in `mro.rs`**; `ClassHierarchyInfo` imports from `mro`.

*Rationale:*
- MRO is an MRO-specific concept, belongs in `mro.rs`
- `cross_file_types` already depends on `mro` for MRO computation
- Existing mutual dependency is acceptable in this crate
- Keeps layering clean: types module imports MRO module

*Implementation:*
```rust
// In mro.rs:
pub struct MROEntry { ... }
pub type MROWithOrigin = Vec<MROEntry>;

// In cross_file_types.rs:
use crate::mro::MROEntry;

pub struct ClassHierarchyInfo {
    // ...
    pub mro: Option<Vec<MROEntry>>,
}
```

---

**[D14] mro_names() Return Type**

*Question:* Should `mro_names()` return `Vec<&str>` or `Vec<String>`?

*Decision:* **Return `Vec<String>`** for simplicity and API compatibility.

*Rationale:*
- MRO sizes are small (~5-10 entries), allocation cost is negligible
- Avoids lifetime friction at call sites
- Matches existing APIs that return owned strings
- Callers often need owned strings anyway

*Implementation:*
```rust
impl ClassHierarchyInfo {
    pub fn mro_names(&self) -> Option<Vec<String>> {
        self.mro.as_ref().map(|entries|
            entries.iter().map(|e| e.class_name.clone()).collect()
        )
    }
}
```

---

**Data Structures (Final):**

```rust
// ============================================================================
// In mro.rs [D13]
// ============================================================================

/// An entry in the Method Resolution Order with its origin file.
#[derive(Debug, Clone, Eq)]
pub struct MROEntry {
    /// The class name (simple name, not qualified).
    pub class_name: String,
    /// The file where this class is defined (workspace-relative path).
    pub file_path: PathBuf,
}

impl PartialEq for MROEntry {
    fn eq(&self, other: &Self) -> bool {
        self.class_name == other.class_name && self.file_path == other.file_path
    }
}

impl MROEntry {
    pub fn new(class_name: String, file_path: PathBuf) -> Self {
        debug_assert!(
            !file_path.is_absolute(),
            "MROEntry file_path must be workspace-relative, got: {:?}",
            file_path
        );
        Self { class_name, file_path }
    }
}

/// The MRO with origin tracking.
pub type MROWithOrigin = Vec<MROEntry>;

// ============================================================================
// In cross_file_types.rs [D11]
// ============================================================================

pub struct FileTypeContext {
    /// Path to the source file (workspace-relative, e.g., "base.py") [D11]
    pub file_path: PathBuf,
    pub tracker: TypeTracker,
    pub symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>,
    pub symbol_map: HashMap<(Vec<String>, String), usize>,
    pub import_targets: HashMap<(Vec<String>, String), ImportTarget>,
    pub class_hierarchies: HashMap<String, ClassHierarchyInfo>,
}

pub struct ClassHierarchyInfo {
    pub name: String,
    pub bases: Vec<String>,
    pub mro: Option<Vec<MROEntry>>,  // [D08] Changed from Option<Vec<String>>
}

impl ClassHierarchyInfo {
    /// Extract class names from origin-aware MRO [D14]
    pub fn mro_names(&self) -> Option<Vec<String>> {
        self.mro.as_ref().map(|entries|
            entries.iter().map(|e| e.class_name.clone()).collect()
        )
    }
}
```

**API Changes (Final):**

1. **`FileTypeContext`** gains `file_path: PathBuf` field [D11]
2. **`merge()`** operates on `Vec<Vec<MROEntry>>` with full identity comparison [D07]
3. **`ClassHierarchyInfo.mro`** changes to `Option<Vec<MROEntry>>` [D08]
4. **`cache_mro()`** and **`get_cached_mro()`** updated for `MROEntry` + path normalization [D10]
5. **`compute_mro_cross_file_with_origins()`** - new primary function, returns `MROWithOrigin`
6. **`compute_mro_cross_file()`** - demoted to `#[cfg(test)]` or deprecated [D12]
7. **`lookup_attr_in_file()`** - new helper for class+file lookup
8. **`lookup_attr_in_mro()`** - uses `ctx.file_path` (no signature change needed) [D11]
9. **`attribute_type_of_with_mro()`** - uses `self.file_path` (no signature change needed) [D11]

##### Step 5.1: Fix Path Normalization in get_or_analyze (COMPLETE)

**Tasks:**
- [x] Modify `get_or_analyze` to normalize paths at entry point
- [x] Use relative path for all cache operations (lookup, insert, in_progress)
- [x] Use `workspace_root.join(relative_path)` for file I/O

**Tests:**
- [x] `test_get_or_analyze_normalizes_absolute_path`
- [x] `test_get_or_analyze_handles_relative_path`
- [x] `test_cache_hit_after_normalization`
- [x] `test_nested_directory_path_normalization`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python cross_file_types::tests` - 19 tests pass

##### Step 5.2: Add MRO Origin Tracking

**Implementation Sequence:**

1. **Add `MROEntry` struct in `mro.rs`** (per [D07], [D10], [D13])
   - [x] Add struct with `class_name: String` and `file_path: PathBuf`
   - [x] Implement `PartialEq`/`Eq` comparing both fields (identity = class + file)
   - [x] Add `MROEntry::new()` constructor with debug assertion for relative paths
   - [x] Add `MROWithOrigin` type alias

2. **Add `file_path` field to `FileTypeContext`** (per [D11])
   - [x] Add `pub file_path: PathBuf` field to `FileTypeContext` struct
   - [x] Update `analyze_file()` to set `file_path` from the relative path it computes
   - [x] Update test helpers that construct `FileTypeContext` manually

3. **Update `merge()` function** (per [D07])
   - [x] Add new `merge_entries()` function for `Vec<Vec<MROEntry>>`
   - [x] Update head/tail comparisons to use MROEntry equality (both fields)
   - [x] Original `merge()` kept for backwards compatibility

4. **Update `ClassHierarchyInfo`** (per [D08], [D14])
   - [x] Import `MROEntry` from `mro` module
   - [x] Change `mro` field from `Option<Vec<String>>` to `Option<Vec<MROEntry>>`
   - [x] Add `mro_names() -> Option<Vec<String>>` helper method

5. **Update cache methods with normalization** (per [D10])
   - [x] Update `cache_mro()` to accept `Vec<MROEntry>`
   - [x] Update `get_cached_mro()` to return `Option<&Vec<MROEntry>>`
   - Note: Path normalization already handled in `get_or_analyze()` (Step 5.1)

6. **Add `compute_mro_cross_file_with_origins()`**
   - [x] New function returning `MROResult<MROWithOrigin>`
   - [x] Uses `ctx.file_path` for starting class origin (no extra parameter needed)
   - [x] Delegates to `compute_mro_in_file_with_origins()`

7. **Add `compute_mro_in_file_with_origins()` internal function**
   - [x] Build MRO entries with file paths at each level
   - [x] Pass `resolved_file` to recursive calls for base classes
   - [x] Use `MROEntry::new()` for construction

8. **Update `compute_mro_cross_file()` as wrapper** (adjusted from [D12])
   - [x] Wrapper calls origin version and extracts names
   - Note: Kept as public function (not test-only) for API compatibility

9. **Add `lookup_attr_in_file()` helper**
   - [x] Simple helper: looks up attribute in specific class+file via cache

10. **Update `lookup_attr_in_mro()` to use origins**
    - [x] Uses `compute_mro_cross_file_with_origins()`
    - [x] Walk MRO entries using `lookup_attr_in_file()`

11. **Update `FileTypeContext::attribute_type_of_with_mro()`**
    - [x] Uses `lookup_attr_in_mro()` which now has origin tracking (no change needed)

**Test Updates:**
- [x] Update `FileTypeContext` construction in tests to include `file_path`
- [x] Update `test_mro_attr_cache_populated` for `Vec<MROEntry>` cache format
- Note: `test_mro_entry_identity` and `test_same_name_different_files` deferred

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python test_mro_attr` - all tests pass
- [x] Existing MRO tests still pass: `cargo nextest run -p tugtool-python mro::tests` - 48 tests pass
- [x] No regressions: `cargo nextest run -p tugtool-python` - 611 tests pass

##### Step 5.3: Verify Multi-Hop Cross-File Resolution

**Tasks:**
- [x] Update `test_mro_attr_multi_hop_cross_file` to set `FileTypeContext.file_path`
- [x] Remove all debug `eprintln!` statements from test
- [x] Verify attribute lookup resolves through: Mid -> Base -> Root

**Expected Behavior After Fix:**
1. MRO computed with origins: `[(Mid, "mid.py"), (Base, "base.py"), (Root, "root.py")]`
2. Attribute "root" lookup walks origins:
   - Check Mid in mid.py -> not found
   - Check Base in base.py -> not found
   - Check Root in root.py -> **FOUND**: `root() -> str`
3. Test assertion `root_attr.is_some()` passes
4. Test assertion `root_attr.unwrap().type_str == "str"` passes

**Test Cleanup:**
The current test has extensive debug output that should be removed:
```rust
// REMOVE these debug blocks after implementation works:
eprintln!("=== DEBUG INFO ===");
eprintln!("root_attr result: {:?}", root_attr);
// ... (approximately 30 lines of debug eprintln!)
eprintln!("===================");
```

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python test_mro_attr_multi_hop` passes
- [x] All MRO tests pass: `cargo nextest run -p tugtool-python mro::tests` - 48 tests pass
- [x] All cross_file_types tests pass: `cargo nextest run -p tugtool-python cross_file_types::tests`
- [x] Full crate passes: `cargo nextest run -p tugtool-python` - 611 tests pass

**Risk Assessment:**

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing callers | Low | Medium | Internal API; only 6 call sites |
| Performance regression | Low | Low | No additional file I/O; just carrying data |
| Incorrect file path normalization | Medium | High | Debug assert in MROEntry::new() |
| Memory increase | Low | Low | PathBuf is small; MRO chains bounded |
| C3 merge regression | Medium | High | Identity uses both fields; add edge case test |

**Rollback:**
- Revert commit; attribute lookup remains local-only

---

#### Step 6: Property Decorator Support {#step-6}

**Commit:** `feat(python): add property decorator type tracking`

**References:** [D05] Property Detection, (#success-criteria)

**Artifacts:**
- `crates/tugtool-python/src/type_tracker.rs`: PropertyTypeInfo, property_types map
- `crates/tugtool-python-cst/src/visitor/signature.rs`: Property detection

**Tasks:**
- [x] Add `PropertyTypeInfo` struct
- [x] Add `property_types` HashMap to TypeTracker
- [x] Add `property_type_of(class, prop)` method
- [x] Add `process_properties` to collect from signatures with `Modifier::Property`
- [x] Update `attribute_type_of` to fall back to `property_type_of`

**Tests:**
- [x] Unit test: property with return type annotation
- [x] Integration test: Fixture 11D-F05 (property decorator)
- [x] Integration test: Fixture 11D-F08 (inherited property)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python test_property`
- [x] All existing tests pass

**Rollback:**
- Revert commit

---

#### Step 7: Type Stub Integration {#step-7}

**Commit:** `feat(python): add type stub (.pyi) file support`

**References:** [D06] Stub Integration, (#scope)

**Prerequisite Verification:** Before implementing stub support, verify the CST parser
correctly handles `.pyi` stub syntax:
- Ellipsis bodies (`def foo(): ...`)
- Class stubs with only signatures
- Type annotations without implementations

**Artifacts:**
- `crates/tugtool-python/src/cross_file_types.rs`: Stub discovery and merging

**Tasks:**
- [ ] **Verify CST parses .pyi files correctly** (write test with ellipsis body, confirm no parse errors)
- [ ] Add `stub_paths` map to CrossFileTypeCache
- [ ] Implement `load_stub_if_exists` method (inline .pyi adjacent to .py)
- [ ] Implement `resolve_stubs_path` for project-level `stubs/` directory
- [ ] Merge stub TypeTracker with source TypeTracker (stub wins)
- [ ] Document supported vs unsupported stub syntax per D06

**Tests:**
- [ ] Unit test: CST parses stub with ellipsis body
- [ ] Unit test: CST parses stub with `pass` body
- [ ] Unit test: stub discovered adjacent to source
- [ ] Unit test: stub discovered in project-level `stubs/`
- [ ] Unit test: stub types override source types
- [ ] Unit test: partial stub (some methods missing) merges correctly
- [ ] Integration test: Fixture 11D-F06 (stub override)
- [ ] Integration test: Fixture 11D-F11 (stubs/ directory)

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python test_stub`
- [ ] `cargo nextest run -p tugtool-python-cst` (verify stub parsing)
- [ ] All existing tests pass

**Rollback:**
- Revert commit; stub support not available

---

#### Step 8: Documentation and CLAUDE.md Updates {#step-8}

**Commit:** `docs: update CLAUDE.md with Phase 11D capabilities`

**References:** (#documentation-plan)

**Artifacts:**
- `CLAUDE.md`: Updated receiver resolution documentation
- Module-level rustdoc in new files

**Tasks:**
- [ ] Document cross-file resolution capabilities and limits
- [ ] Document MRO-based attribute lookup
- [ ] Document property decorator support
- [ ] Document type stub support
- [ ] Add examples to rustdoc

**Tests:**
- N/A (documentation only)

**Checkpoint:**
- [ ] `cargo doc --workspace --no-deps` succeeds
- [ ] Review CLAUDE.md changes

**Rollback:**
- Revert commit

---

#### Step 9: End-to-End Integration Tests {#step-9}

**Commit:** `test(python): add comprehensive Phase 11D integration tests`

**References:** (#test-fixtures)

**Artifacts:**
- New test fixtures in `crates/tugtool-python/tests/`

**Tasks:**
- [ ] Add all fixtures from Test Plan section (11D-F01 through 11D-F16)
- [ ] Verify cross-file resolution works end-to-end
- [ ] Verify MRO lookup works for all inheritance patterns
- [ ] Verify property resolution works
- [ ] Verify stub integration works

**Tests:**
- [ ] All fixtures pass
- [ ] Performance test: < 100ms for 50-file project

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python`
- [ ] Performance benchmark within threshold

**Rollback:**
- Revert commit; individual features remain but integration tests removed

---

### 11D.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Cross-file type resolution, MRO-based attribute lookup, property support, and type stub integration for Python refactoring.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Cross-file attribute chains resolve when all files are in workspace (Fixture 11D-F01, F02)
- [ ] Inherited attributes resolve via MRO (Fixture 11D-F03, F04)
- [ ] Property decorators provide type information (Fixture 11D-F05, F08)
- [ ] Type stubs override source types when present (Fixture 11D-F06)
- [ ] Circular imports are handled gracefully (Fixture 11D-F07)
- [ ] FactsStore has no Python-specific additions (code review)
- [ ] All existing tests pass (`cargo nextest run --workspace`)
- [ ] Performance is acceptable (< 100ms overhead for typical project)

**Acceptance tests:**
- [ ] Integration test: Multi-file project with 10+ files resolves correctly
- [ ] Integration test: Diamond inheritance resolves correctly
- [ ] Integration test: Temporale fixture (if applicable) resolves more patterns than before
- [ ] Golden test: Cross-file resolution output format is correct

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Cross-File Resolution** {#m01-cross-file}
- [ ] CrossFileTypeCache implemented (Step 1)
- [ ] Cross-file resolution integrated in analyzer (Step 2)

**Milestone M02: MRO Support** {#m02-mro}
- [ ] MRO computation implemented (Step 3)
- [ ] Class hierarchy collection implemented (Step 4)
- [ ] MRO-based attribute lookup working (Step 5)

**Milestone M03: Property Support** {#m03-property}
- [x] Property decorator detection and type tracking (Step 6)

**Milestone M04: Stub Support** {#m04-stub}
- [ ] Type stub discovery and merging (Step 7)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Type narrowing from isinstance checks (Phase 11E candidate)
- [ ] Generic type parameter resolution (Phase 11E candidate)
- [ ] Full typeshed-style stub discovery (project-level stubs/, site-packages stubs)
- [ ] Protocol/duck typing support
- [ ] Third-party package type resolution (requires dependency analysis)
- [ ] Performance optimization: parallel file analysis
- [ ] Memory optimization: shared type info across files

| Checkpoint | Verification |
|------------|--------------|
| Cross-file cache works | `cargo nextest run -p tugtool-python cross_file` |
| MRO computation correct | `cargo nextest run -p tugtool-python mro` |
| All tests pass | `cargo nextest run --workspace` |
| No regression | Compare output on existing fixtures |
| Performance acceptable | Benchmark < 100ms for 50-file project |

**Commit after all checkpoints pass.**
