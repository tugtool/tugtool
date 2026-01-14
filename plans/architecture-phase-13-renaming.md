## Phase 13.0 Terminology Refactoring

**Purpose:** Adopt JSON-native terminology (`array`/`object`) and clean, generic method names throughout the codebase.

**Decision:** YES - complete terminology overhaul for a clean, consistent API.

**Status:** Not started (previous attempt failed completely and was reverted)

### 13.0.1 Lessons from Failed Attempt

The previous attempt failed badly:
- Custom syn-based Rust renamer was overly complex and didn't preserve formatting
- libcst Python renamer was too aggressive, renaming things it shouldn't
- Fell back to perl one-liners which created an inconsistent mess
- Left backwards compat aliases, outdated docs, mixed terminology

**Root causes:**
1. Tried to be clever with tooling instead of doing simple, careful manual work
2. Incomplete scope: renamed constructors but left operation methods with old terminology
3. This would have caused permanent confusion: `object()` to create, but `.struct_field()` to access

### 13.0.2 Design Principles

**The API must look like it was written this way from the start.** No vestigial terminology, no compat aliases, no mixed naming.

**Terminology alignment:**
- JSON arrays → `array()` constructor, generic operation methods
- JSON objects → `object()` constructor, generic operation methods

**Generic method names:** Operation methods should NOT have type prefixes. Instead of `.list_get()` and `.struct_field()`, use `.get()` and `.field()`. The type is already known from context.

**Exception - contains:** Both `Expr` (string) and arrays have `contains` operations. To avoid collision and programmer confusion, we use explicit prefixes: `.str_contains()` and `.array_contains()`.

### 13.0.3 Execution Steps

**Strategy:** Use the compiler as the refactoring tool. Rename definition → compiler shows all errors → fix each one → verify → commit.

---

#### Step 1: Rust Core Types and Constructors

**Commit:** `refactor(core): rename List/Struct to Array/Object in Rust core`

**Renames:**

| Current | New | Location |
|---------|-----|----------|
| `Expr::List` | `Expr::Array` | `crates/arbors-expr/src/expr.rs` |
| `Expr::Struct` | `Expr::Object` | `crates/arbors-expr/src/expr.rs` |
| `list(exprs)` | `array(exprs)` | `crates/arbors-expr/src/expr.rs` + lib.rs export |
| `struct_(fields)` | `object(fields)` | `crates/arbors-expr/src/expr.rs` + lib.rs export |
| `Shape::List` | `Shape::Array` | `crates/arbors-expr/src/shape.rs` |
| `Shape::Struct` | `Shape::Object` | `crates/arbors-expr/src/shape.rs` |
| `Shape::list(inner)` | `Shape::array(inner)` | `crates/arbors-expr/src/shape.rs` |
| `dt::struct_(fields)` | `dt::object(fields)` | `crates/arbors-schema/src/dt.rs` |
| `NodeType::LIST` | `NodeType::ARRAY` | `crates/arbors-core/src/lib.rs` |
| `NodeType::STRUCT` | `NodeType::OBJECT` | `crates/arbors-core/src/lib.rs` |
| `ArborsType::List` | `ArborsType::Array` | `crates/arbors-schema/src/types.rs` |
| `ArborsType::Struct` | `ArborsType::Object` | `crates/arbors-schema/src/types.rs` |
| `is_struct_child` | `is_object_child` | `crates/arbors-storage/src/*.rs` |

**Tasks:**
- [ ] Rename enum variants (cargo build shows all match arms to fix)
- [ ] Rename constructor functions
- [ ] Update lib.rs exports
- [ ] Fix all match arms and call sites

**Checkpoint:** `cargo build && cargo test`

---

#### Step 2: Rust Operation Methods and Eval Functions

**Commit:** `refactor(expr): rename operation methods to generic names`

**Enum Variant Renames:**

| Current | New | Notes |
|---------|-----|-------|
| `Expr::ListGet` | `Expr::Get` | |
| `Expr::ListSlice` | `Expr::Slice` | |
| `Expr::ListContains` | `Expr::ArrayContains` | Explicit type prefix to avoid collision |
| `Expr::ListUnique` | `Expr::Unique` | |
| `Expr::ListSort` | `Expr::Sort` | |
| `Expr::ListReverse` | `Expr::Reverse` | |
| `Expr::ListConcat` | `Expr::Concat` | |
| `Expr::StructField` | `Expr::Field` | |
| `Expr::StructRename` | `Expr::Rename` | |
| `Expr::StructWith` | `Expr::WithField` | |
| `Expr::StructWithout` | `Expr::Without` | |
| `Expr::Contains` | `Expr::StrContains` | Renamed for clarity (was string contains) |

**Method Renames (in `crates/arbors-expr/src/expr.rs`):**

| Current | New | Notes |
|---------|-----|-------|
| `.list_get(index)` | `.get(index)` | |
| `.list_slice(start, end)` | `.slice(start, end)` | |
| `.list_contains(value)` | `.array_contains(value)` | Explicit to avoid collision with str_contains |
| `.list_unique()` | `.unique()` | |
| `.list_sort(desc)` | `.sort(desc)` | |
| `.list_reverse()` | `.reverse()` | |
| `list_concat(arrays)` | `concat(arrays)` | |
| `.struct_field(name)` | `.field(name)` | |
| `.struct_rename(old, new)` | `.rename(old, new)` | |
| `.struct_with(name, value)` | `.with_field(name, value)` | |
| `.struct_without(name)` | `.without(name)` | |
| `.is_list()` | `.is_array()` | |
| `.is_struct()` | `.is_object()` | |
| `.contains(pattern)` | `.str_contains(pattern)` | Renamed for clarity (was string contains) |

**Eval Function Renames (in `crates/arbors-query/src/eval.rs`):**

| Current | New |
|---------|-----|
| `eval_list_get()` | `eval_get()` |
| `eval_list_slice()` | `eval_slice()` |
| `eval_list_contains()` | `eval_array_contains()` |
| `eval_list_unique()` | `eval_unique()` |
| `eval_list_sort()` | `eval_sort()` |
| `eval_list_reverse()` | `eval_reverse()` |
| `eval_list_concat()` | `eval_concat()` |
| `eval_struct_field()` | `eval_field()` |
| `eval_struct_rename()` | `eval_rename()` |
| `eval_struct_with()` | `eval_with_field()` |
| `eval_struct_without()` | `eval_without()` |
| `eval_contains()` | `eval_str_contains()` |

**Tasks:**
- [x] Rename enum variants
- [x] Rename method definitions
- [x] Rename eval functions
- [x] Fix all match arms and call sites in:
  - `crates/arbors-expr/src/*.rs`
  - `crates/arbors-query/src/*.rs`
  - `crates/arbors-query/tests/*.rs`
  - `crates/arbors/tests/*.rs`

**Checkpoint:** `cargo build && cargo test` ✅

---

#### Step 3: Python Bindings

**Commit:** `refactor(python): update bindings with new terminology`

**Constructor Renames (in `python/src/lib.rs`):**

| Current | New | PyO3 name |
|---------|-----|-----------|
| `expr_list` | `expr_array` | `#[pyo3(name = "array")]` |
| `expr_struct` | `expr_object` | `#[pyo3(name = "object")]` |
| `Schema.list()` | `Schema.array()` | |
| `Schema.struct_()` | `Schema.object()` | |
| `ArborsType.list()` | `ArborsType.array()` | |
| `ArborsType.struct_()` | `ArborsType.object()` | |
| `List()` factory | `Array()` | |
| `Struct()` factory | `Object()` | |

**Operation Method Renames:**

| Current | New | Notes |
|---------|-----|-------|
| `.list_get()` | `.get()` | On ExprArrayAccessor |
| `.list_slice()` | `.slice()` | On ExprArrayAccessor |
| `.list_contains()` | `.array_contains()` | Explicit type prefix |
| `.list_unique()` | `.unique()` | On ExprArrayAccessor |
| `.list_sort()` | `.sort()` | On ExprArrayAccessor |
| `.list_reverse()` | `.reverse()` | On ExprArrayAccessor |
| `list_concat()` | `concat()` | Free function |
| `.struct_field()` | `.field()` | On ExprObjectAccessor |
| `.struct_rename()` | `.rename()` | On ExprObjectAccessor |
| `.struct_with()` | `.with_field()` | On ExprObjectAccessor |
| `.struct_without()` | `.without()` | On ExprObjectAccessor |
| `.is_list()` | `.is_array()` | On Expr |
| `.is_struct()` | `.is_object()` | On Expr |
| `.contains()` (on Expr) | `.str_contains()` | Renamed for clarity |
| `.contains()` (on ExprStrAccessor) | `.str_contains()` | Renamed for clarity |

**Accessor Renames:**

| Current | New |
|---------|-----|
| `.list` accessor | `.arr` accessor |
| `.struct_` accessor | `.obj` accessor |
| `ExprListAccessor` | `ExprArrayAccessor` |
| `ExprStructAccessor` | `ExprObjectAccessor` |

**Tasks:**
- [x] Rename all constructors
- [x] Rename all operation methods
- [x] Rename accessors and accessor classes
- [x] Delete `python/arbors/compat.py` entirely

**Checkpoint:** `make python` ✅

---

#### Step 4: Python Exports and Stubs

**Commit:** `refactor(python): update exports, stubs, and manifest`

**Files to Update:**

| File | Changes |
|------|---------|
| `python/arbors/__init__.py` | Update imports, exports, `__all__` list, docstring |
| `python/arbors/_arbors.pyi` | All function signatures, class definitions, method signatures |
| `python/api_manifest.toml` | All export entries |
| `python/stubtest_allowlist.txt` | Remove compat references |

**Tasks:**
- [x] Update `__init__.py` with new names
- [x] Update `_arbors.pyi` with new signatures
- [x] Update `api_manifest.toml`
- [x] Clean up `stubtest_allowlist.txt`

**Checkpoint:** `make python` ✅

---

#### Step 5: Python Tests

**Commit:** `test(python): update all tests for new terminology`

**Delete:**
- `python/tests/test_compat.py`
- `python/tests/test_naming_conventions.py`

**Update all test files:**
- `test_expr.py` (largest - ~100 changes)
- `test_schema.py`
- `test_types.py`
- `test_type_constants.py`
- `test_integration.py`
- `test_query.py`
- `test_arbor.py`
- `test_tree.py`
- `test_node.py`
- `test_errors.py`
- `test_arrow.py`
- `test_parsing.py`
- `test_serialization.py`
- `test_repr.py`
- `test_expr_acceptance.py`
- `conftest.py`

**Tasks:**
- [ ] Delete obsolete test files
- [ ] Update all remaining test files

**Checkpoint:** `make test`

---

#### Step 6: Documentation and Examples

**Commit:** `docs: update all documentation and examples`

**Update:**
- `python/examples/*.py`
- All Rust docstrings in `crates/*/src/*.rs`
- Python docstrings in `python/src/lib.rs`

**Final Verification:**
```bash
# Should return ZERO matches - all old terminology is gone
grep -rn "Expr::List\b\|Expr::Struct\b\|::LIST\b\|::STRUCT\b" crates/ python/
grep -rn "list_get\|list_slice\|struct_field\|struct_rename" crates/ python/
grep -rn "eval_list_\|eval_struct_" crates/ python/
grep -rn "is_struct_child" crates/ python/
```

**Tasks:**
- [x] Update example scripts
- [x] Update Rust docstrings
- [x] Update Python docstrings
- [x] Run grep checks - must return zero matches

**Checkpoint:** `make check-parity && make check-stubs` ✅

---

#### Step 7: Rename ExprResult::List and ExprResult::Struct

**Commit:** `refactor(expr): rename ExprResult::List/Struct to Array/Object`

**Rationale:** The plan states "The API must look like it was written this way from the start." Having `Expr::Array` but `ExprResult::List` is exactly the mixed terminology we want to eliminate. Even internal code should be consistent.

**Enum Variant Renames (in `crates/arbors-expr/src/result.rs`):**

| Current | New |
|---------|-----|
| `ExprResult::List` | `ExprResult::Array` |
| `ExprResult::Struct` | `ExprResult::Object` |

**Method Renames (in `crates/arbors-expr/src/result.rs`):**

| Current | New | Notes |
|---------|-----|-------|
| `is_list()` | `is_array()` | |
| `is_struct()` | `is_object()` | |
| `as_list()` | `as_array()` | |
| `as_struct()` | `as_object()` | |
| `into_list()` | `into_array()` | |
| `into_struct()` | `into_object()` | |
| `empty_list()` | `empty_array()` | |
| `empty_struct()` | `empty_object()` | |

**Helper Function Renames (in `crates/arbors-query/src/eval.rs`):**

| Current | New |
|---------|-----|
| `is_list_value()` | `is_array_value()` |
| `is_struct_value()` | `is_object_value()` |

**Docstring Updates (in `crates/arbors-expr/src/result.rs`):**

| Current | New |
|---------|-----|
| "Results can be scalars, lists, or structs" | "Results can be scalars, arrays, or objects" |
| "**List**: An ordered collection..." | "**Array**: An ordered collection..." |
| "**Struct**: A named collection..." | "**Object**: A named collection..." |
| "from wildcards or list construction" | "from wildcards or array construction" |
| "from struct construction" | "from object construction" |
| "A struct/object with named fields" | "An object with named fields" |

**Python Binding Renames (in `python/src/lib.rs`):**

| Current | New |
|---------|-----|
| `fn as_list()` | `fn as_array()` |

**Python Stub Renames (in `python/arbors/_arbors.pyi`):**

| Current | New |
|---------|-----|
| `def as_list()` | `def as_array()` |

**Python Test Renames:**

| Current | New | File |
|---------|-----|------|
| `test_as_list_array` | `test_as_array` | `python/tests/test_node.py` |
| `test_as_list_non_list_raises` | `test_as_array_non_array_raises` | `python/tests/test_node.py` |
| `test_node_as_list_non_array` | `test_node_as_array_non_array` | `python/tests/test_errors.py` |

**Panic Message Updates (update all instances):**

| Current | New |
|---------|-----|
| `"Expected List result"` | `"Expected Array result"` |
| `"Expected Struct result"` | `"Expected Object result"` |

**Files requiring updates:**

1. `crates/arbors-expr/src/result.rs` - Enum definition, methods, docstrings, tests
2. `crates/arbors-query/src/eval.rs` - All match arms, helper functions
3. `crates/arbors-query/src/ops.rs` - All match arms
4. `crates/arbors-query/src/tree_ops.rs` - All match arms, docstrings
5. `crates/arbors-query/tests/integration.rs` - All match arms, panic messages
6. `crates/arbors-io/src/builder.rs` - All match arms, test names
7. `crates/arbors-lazy/src/execute.rs` - All match arms
8. `crates/arbors-lazy/tests/lazy_integration.rs` - All match arms, panic messages
9. `crates/arbors/tests/expr_acceptance.rs` - All match arms
10. `python/src/lib.rs` - Method name, match arms
11. `python/arbors/_arbors.pyi` - Method stub
12. `python/tests/test_node.py` - Test names, method calls
13. `python/tests/test_errors.py` - Test names, method calls

**Tasks:**
- [x] Rename enum variants in result.rs
- [x] Rename methods in result.rs
- [x] Update docstrings in result.rs
- [x] Rename helper functions in eval.rs
- [x] Fix all match arms in Rust crates (cargo build shows all errors)
- [x] Update panic messages
- [x] Rename Python binding method
- [x] Update Python stub
- [x] Rename Python tests

**Checkpoint:** `cargo build && cargo test && make check-parity && make check-stubs` ✅

---

#### Step 8: Audit and Cleanup

**Commit:** `refactor(terminology): complete cleanup of lingering list/struct references`

**Purpose:** Steps 1-7 completed the core API renames, but numerous stragglers remain in variable names, error messages, comments, docstrings, test names, and examples. This step ensures the code "looks like it was written this way from the start."

---

##### 8.1 Error Messages (User-Facing)

Error strings still use `"list"` and `"struct"` terminology which will surface to users:

| File | Current | New |
|------|---------|-----|
| `crates/arbors-query/src/eval.rs` | `expected: "list"`, `got: "non-list"` | `expected: "array"`, `got: "non-array"` |
| `crates/arbors-query/src/eval.rs` | `expected: "struct"`, `got: "non-struct"` | `expected: "object"`, `got: "non-object"` |
| `crates/arbors-query/src/eval.rs` | `expected: "list of strings"` | `expected: "array of strings"` |
| `crates/arbors-query/src/ops.rs` | `got: "struct"` | `got: "object"` |
| `crates/arbors-query/src/tree_ops.rs` | `got: "struct"` | `got: "object"` |
| `crates/arbors-expr/src/validate.rs` | `got: "struct"` | `got: "object"` |
| `crates/arbors-schema/src/lib.rs` | `"list"`, `"struct"` (type names) | `"array"`, `"object"` |
| `crates/arbors-io/src/builder.rs` | `"list"` in error test | `"array"` |

**Tasks:**
- [x] Update all error message strings from "list" to "array"
- [x] Update all error message strings from "struct" to "object"
- [x] Update "non-list" to "non-array", "non-struct" to "non-object"
- [x] Update "list of strings" to "array of strings"

---

##### 8.2 Variable and Parameter Names

Local variables and parameters still use old naming:

| File | Current | New |
|------|---------|-----|
| `crates/arbors-query/src/eval.rs` | `list_result`, `list_expr` (many occurrences) | `array_result`, `array_expr` |
| `crates/arbors-query/src/eval.rs` | `struct_result` (many occurrences) | `object_result` |
| `python/src/lib.rs` | `list_path` parameter in `filter()` | `array_path` |
| `python/src/lib.rs` | `list_expr` parameter in `join_strings()` | `array_expr` |
| `python/arbors/_arbors.pyi` | `list_path`, `list_expr` parameters | `array_path`, `array_expr` |

**Tasks:**
- [x] Rename `list_result` → `array_result` in eval.rs
- [x] Rename `list_expr` → `array_expr` in eval.rs
- [x] Rename `struct_result` → `object_result` in eval.rs
- [x] Rename `list_path` → `array_path` in Python bindings
- [x] Rename `list_expr` → `array_expr` in Python bindings
- [x] Update corresponding Python stubs

---

##### 8.3 Internal Helper Functions

Internal functions still use old naming:

| File | Current | New |
|------|---------|-----|
| `crates/arbors-io/src/builder.rs` | `fill_list_from_results()` | `fill_array_from_results()` |
| `crates/arbors-io/src/builder.rs` | `fill_struct_from_results()` | `fill_object_from_results()` |

**Tasks:**
- [x] Rename `fill_list_from_results` → `fill_array_from_results`
- [x] Rename `fill_struct_from_results` → `fill_object_from_results`

---

##### 8.4 Test Names

Test names still use old terminology:

| File | Current | New |
|------|---------|-----|
| `crates/arbors/tests/expr_acceptance.rs` | `test_is_list_with_array` | `test_is_array_with_array` |
| `crates/arbors/tests/expr_acceptance.rs` | `test_is_struct_with_object` | `test_is_object_with_object` |
| `crates/arbors-expr/src/plan.rs` | `test_plan_list_expression` | `test_plan_array_expression` |
| `python/tests/test_arrow.py` | `class TestListLists` | `class TestArrays` |
| `python/tests/test_arrow.py` | `test_nested_struct_fields` etc. | `test_nested_object_fields` |
| `python/tests/test_arrow.py` | `test_list_is_list`, `test_list_of_integers` etc. | `test_array_is_list`, `test_array_of_integers` |
| `python/tests/test_integration.py` | `class TestListLikeWorkflows` | `class TestArrayLikeWorkflows` |
| `python/tests/test_integration.py` | `test_list_pattern_*` methods | `test_array_pattern_*` |
| `python/tests/test_expr.py` | `test_type_of_list_with_elements` | `test_type_of_array_with_elements` |
| `python/tests/test_node.py` | `test_as_dict_non_struct_raises` | `test_as_dict_non_object_raises` |

**Tasks:**
- [x] Rename Rust test functions
- [x] Rename Python test classes and methods

---

##### 8.5 Docstrings and Comments

Documentation still uses old terminology:

| File | Location | Issue |
|------|----------|-------|
| `crates/arbors/src/lib.rs:44-45` | Module docstring | "**list** (JSON array), **struct** (JSON object)" |
| `crates/arbors/src/lib.rs:58` | Example comment | "prefer object_ over struct_" |
| `crates/arbors-expr/src/validate.rs:13` | Docstring | "**struct** → error" |
| `crates/arbors-expr/src/expr.rs:156,162` | Docstrings | "list of strings" |
| `crates/arbors-expr/src/infer.rs:270,274` | Comments | "list of strings" |
| `python/src/lib.rs:2686-2700` | `filter()` docstring | "Filter list elements", "list_path" |
| `python/src/lib.rs:5494-5499` | `join_strings()` docstring | "Join a list of strings", "list_expr" |
| `python/arbors/_arbors.pyi` | Various | Matching stubs with list/struct wording |
| `python/tests/test_arrow.py:152` | Comment | "# List/List Tests" |
| `python/tests/test_integration.py:310` | Docstring | "List-like access patterns" |

**Tasks:**
- [x] Update main crate docstring terminology section
- [x] Update validate.rs docstring
- [x] Update expr.rs docstrings ("list of strings" → "array of strings")
- [x] Update infer.rs comments
- [x] Update Python binding docstrings
- [x] Update Python stub docstrings
- [x] Update test file comments and docstrings

---

##### 8.6 Examples

Example scripts still use old terminology:

| File | Issue |
|------|-------|
| `examples/expressions.py:199-208` | Uses `struct_()` constructor, banner says "Building Structures with struct_" |

**Tasks:**
- [x] Update examples/expressions.py to use `object()` constructor
- [x] Update banner text

---

##### 8.7 Tone Cleanup: Remove Excessive "JSON" Callouts

The code repeatedly emphasizes "JSON array"/"JSON object" as if to say "Look, we match JSON!" This tone should be cleaned up:

**Strategy:** One brief note in a central location (e.g., main crate README or top-level docstring) explaining that arbors uses JSON-native terminology. All other occurrences should just say "array" or "object" without the "JSON" prefix.

**Files with excessive callouts:**
- `crates/arbors-expr/src/expr.rs` - Multiple "JSON array", "JSON object" in docstrings
- `crates/arbors-expr/src/lib.rs` - "array for JSON arrays", "object for JSON objects"
- `crates/arbors-core/src/lib.rs` - NodeType docstrings

**Tasks:**
- [x] Reduce "JSON array/object" mentions to simple "array/object"
- [x] Keep one authoritative note about JSON terminology alignment

---

##### 8.8 Schema Type Names

The schema module returns type names:

| File | Current | New |
|------|---------|-----|
| `crates/arbors-schema/src/lib.rs:223,225` | `"list"`, `"struct"` | `"array"`, `"object"` |
| `crates/arbors-schema/src/lib.rs:548,564` | `"list"`, `"struct"` | `"array"`, `"object"` |

Note: The compiler.rs accepts both `"array" | "list"` and `"object" | "struct"` for backwards compatibility with JSON Schema - this is fine to keep.

**Tasks:**
- [x] Update returned type name strings from "list"/"struct" to "array"/"object"

---

##### 8.9 Verification

After completing all cleanup:

```bash
# Should return ZERO matches (excluding plans/, chats/, docs/):
grep -rn '"list"' crates/ python/src/ --include="*.rs" | grep -v "allowlist\|list_path\|allow_list"
grep -rn '"struct"' crates/ python/src/ --include="*.rs" | grep -v "StructField\|StructList"
grep -rn 'list_result\|list_expr\|struct_result' crates/ --include="*.rs"
grep -rn 'fill_list_\|fill_struct_' crates/ --include="*.rs"
grep -rn 'test_is_list\|test_is_struct' crates/ python/ --include="*.rs" --include="*.py"
grep -rn 'TestList\|ListLike' python/tests/ --include="*.py"
```

**Tasks:**
- [x] Run verification grep checks - must return zero matches
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity/stubs checks: `make check-parity && make check-stubs`

---

**Checkpoint:** All verification greps return zero matches, `cargo test && make test && make check-parity && make check-stubs` pass ✅

---

### 13.0.4 Final Deliverable

**Deliverable:** Complete terminology overhaul - constructors, methods, enum variants, eval functions, storage helpers. Code looks like it was written this way from the start. ZERO old terminology anywhere.

| Checkpoint | Verification |
|------------|--------------|
| Rust compiles | `cargo build` |
| Rust tests pass | `cargo test` |
| Python builds | `make python` |
| Python tests pass | `make test` |
| API parity | `make check-parity` |
| Stubs correct | `make check-stubs` |
| No old terminology ANYWHERE | All grep checks return zero matches |

### 13.0.5 Example: Before and After

**Before:**
```python
from arbors import list_, struct_, path, lit

# Create an object with an array field
data = struct_(
    name=path("user.name"),
    scores=list_([lit(85), lit(92), lit(78)])
)

# Access the array
first_score = path("scores").list_get(lit(0))
high_scores = path("scores").list.slice(0, 2)

# Access the object
name = path("data").struct_field("name")
updated = path("data").struct_with("active", lit(True))
```

**After:**
```python
from arbors import array, object, path, lit

# Create an object with an array field
data = object(
    name=path("user.name"),
    scores=array([lit(85), lit(92), lit(78)])
)

# Access the array
first_score = path("scores").get(lit(0))
high_scores = path("scores").arr.slice(0, 2)

# Access the object
name = path("data").field("name")
updated = path("data").with_field("active", lit(True))
```

**Commit after all checkpoints pass.**
