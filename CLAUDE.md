# Tugtool Development Guide

## Critical Rules

**NEVER commit code.** The user handles all git commits. You may stage changes, but do not run `git commit`.

## Project Overview

Tugtool is an AI-native code transformation engine for verified, deterministic refactors. It provides semantic refactoring operations that understand code structure rather than just text patterns.

## Architecture

Tugtool is organized as a Cargo workspace with the following crates:

```
crates/
├── tugtool/          # Main binary and CLI (the "tug" command)
│   ├── src/
│   │   ├── lib.rs    # Library root - re-exports public API
│   │   ├── main.rs   # CLI binary entry point
│   │   ├── cli.rs    # CLI command implementations
│   │   └── testcmd.rs # Test command resolution
│   └── tests/        # Integration tests
├── tugtool-core/     # Shared infrastructure
│   └── src/
│       ├── error.rs      # Error types (TugError)
│       ├── output.rs     # JSON output types and formatting
│       ├── session.rs    # Session management
│       ├── workspace.rs  # Workspace snapshots
│       ├── sandbox.rs    # Sandboxed file operations
│       ├── patch.rs      # Unified diff generation
│       ├── facts/        # Symbol and reference tracking
│       └── ...
├── tugtool-python/   # Python language support (feature-gated)
│   └── src/
│       ├── analyzer.rs   # Semantic analysis
│       ├── cst_bridge.rs # Native CST bridge to tugtool-python-cst
│       ├── ops/          # Refactoring operations (rename, etc.)
│       └── ...
├── tugtool-python-cst/      # Native Python CST parser (adapted from LibCST)
│   └── src/
│       ├── parser/       # PEG-based Python parser
│       ├── visitor/      # Visitor infrastructure and collectors
│       └── ...
├── tugtool-python-cst-derive/   # Proc macro helpers for tugtool-python-cst
└── tugtool-rust/     # Rust language support (placeholder)
```

## Feature Flags

The `tugtool` crate supports these feature flags:

| Feature | Default | Description |
|---------|---------|-------------|
| `python` | Yes | Python language support via native CST |
| `rust` | No | Rust language support (placeholder) |
| `full` | No | Enable all features |

Build with specific features:
```bash
# Default features (python)
cargo build -p tugtool

# All features
cargo build -p tugtool --features full
```

## Build Commands

```bash
# Build all crates
cargo build

# Build specific crate
cargo build -p tugtool-core

# Release build
cargo build --release

# Run the CLI
cargo run -p tugtool -- --help

# Install locally
cargo install --path crates/tugtool
```

## Test Commands

**CRITICAL: Tests must NEVER silently skip.** If a test requires an environment or setup (Python, pytest, etc.), it must either:
1. Work correctly because the environment is properly configured
2. **Fail loudly** with a clear error message explaining what's missing and how to fix it

No "graceful degradation." No "skip if unavailable." Tests pass or they fail. When they fail, we fix the environment so they pass. This is a pillar of how we work on this project.

### Rust Tests

**IMPORTANT:** Use nextest for running tests (faster, parallel execution).

```bash
# Run all tests in workspace
cargo nextest run --workspace

# Run tests for specific crate
cargo nextest run -p tugtool-python

# Run specific test
cargo nextest run test_name_substring

# Run tests with output
cargo nextest run -- --nocapture

# Update golden files (when making intentional schema changes)
TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden
```

### Python Tests (Temporale fixture)

**⚠️ CRITICAL: USE THE INSTALLED VENV - NEVER USE `uv run` ⚠️**

Temporale is an external fixture fetched from https://github.com/tugtool/temporale. It is NOT vendored in the tugtool repository.

#### Fixture Setup

Before running Temporale integration tests locally, fetch the fixture:

```bash
# Fetch all fixtures according to lock files
cargo run -p tugtool -- fixture fetch

# Or fetch specific fixture
cargo run -p tugtool -- fixture fetch temporale

# Install in test venv
.tug-test-venv/bin/pip install -e .tug/fixtures/temporale/
```

For local fixture development, use the environment variable override:
```bash
export TUG_TEMPORALE_PATH=/path/to/your/temporale
```

This bypasses the fixture fetch system entirely and uses your local checkout instead.

#### Running Python Tests

Python tests for Temporale MUST be run using the pre-installed virtual environment at the **workspace root**:

```bash
# CORRECT - The ONE AND ONLY way to run Python tests:
.tug-test-venv/bin/python -m pytest .tug/fixtures/temporale/tests/ -v
```

**ABSOLUTELY FORBIDDEN:**
- ❌ `uv run python -m pytest ...` - Creates unwanted venvs, breaks project structure
- ❌ `python -m pytest ...` - Uses wrong Python, missing dependencies
- ❌ `pytest ...` - May use system pytest without temporale installed

**Why this matters:**
- The `.tug-test-venv/` is at the **tugtool workspace root**
- This venv has temporale installed in editable mode (`-e`)
- This venv has pytest and all test dependencies
- Using `uv run` auto-creates new venvs and breaks the testing setup

**If the venv doesn't exist, create it:**
```bash
uv venv --python 3.11 .tug-test-venv
uv pip install --python .tug-test-venv/bin/python pytest
uv pip install --python .tug-test-venv/bin/python -e .tug/fixtures/temporale/
```

## Quality Checks

```bash
# Format code
cargo fmt --all

# Lint with clippy
cargo clippy --workspace -- -D warnings

# Run all CI checks locally
just ci

# Generate documentation
cargo doc --workspace --open
```

## Key Concepts

### Session Directory

Tugtool stores session data in `.tug/` within the workspace:
- `session.json` - Session metadata
- `snapshots/` - Workspace snapshots
- `fixtures/` - Fetched test fixtures (e.g., Temporale)

### Test Fixtures

Test fixtures are external repositories fetched at test time. Each fixture has a lock file in `fixtures/` that pins the exact version:

- `fixtures/temporale.lock` - Python datetime library for refactoring tests

Future fixtures (Rust, JavaScript, Go) will follow the same pattern: a `.lock` file in `fixtures/` and fetched code in `.tug/fixtures/`.

### Environment Variables

- `TUG_UPDATE_GOLDEN` - Enable golden file updates in tests
- `TUG_SANDBOX` - Set when running in sandbox mode

### Error Codes

All errors use stable codes for JSON output (Table T26):
- `2` - Invalid arguments
- `3` - Resolution errors (symbol not found, ambiguous)
- `4` - Apply errors (failed to write changes)
- `5` - Verification failed
- `10` - Internal errors

## Tug Refactoring (Highly Recommended for Symbol Renames)

When the user requests symbol renaming or reference updates, **tug is highly recommended**.

**Language Support:** Tug currently supports **Python only**. Rust support is planned but not yet implemented. Do not attempt to use tug for Rust refactoring in this project.

### Recognition Patterns

Look for these patterns in user requests:
- "rename X to Y" / "rename the function/class/variable"
- "change the name of X" / "change X's name to Y"
- "refactor the name" / "refactor...name"
- "update all references to X"
- "find and replace X with Y" (when discussing code symbols)

### When to Use Tug

**Use tug when:**
- The symbol appears in multiple files
- Renaming functions, classes, methods, or variables
- User mentions "all references", "across the codebase", "everywhere"
- Manual editing would risk missing shadowed or scoped references

**Skip tug when:**
- Single file, single occurrence
- String literals or comments only
- File renaming (not symbol renaming)

### Why Tug Over Manual Editing

- **Scope-aware**: Understands language scoping rules (won't rename shadowed variables)
- **Verified**: Runs syntax verification before applying
- **Deterministic**: Same input produces same output
- **Safe**: Requires explicit approval before changes

### Quick Reference

```bash
# Full workflow (analyze -> review -> apply)
/tug-rename

# Preview only (no changes)
/tug-analyze-rename

# CLI commands follow: tug <action> <language> <command> [options] [-- <filter>]

# Apply a rename (modifies files)
tug apply python rename --at <file:line:col> --to <new_name>

# Emit a diff without modifying files
tug emit python rename --at <file:line:col> --to <new_name>

# Emit as JSON envelope (includes files_affected, metadata)
tug emit python rename --at <file:line:col> --to <new_name> --json

# Analyze operation metadata (full impact analysis)
tug analyze python rename --at <file:line:col> --to <new_name>

# Analyze - just references
tug analyze python rename --at <file:line:col> --to <new_name> --output references

# Analyze - just symbol info
tug analyze python rename --at <file:line:col> --to <new_name> --output symbol

# With file filter (restrict scope)
tug apply python rename --at <file:line:col> --to <new_name> -- 'src/**/*.py'

# With exclusion filter
tug apply python rename --at <file:line:col> --to <new_name> -- '!tests/**'

# Combined inclusion and exclusion
tug apply python rename --at <file:line:col> --to <new_name> -- 'src/**/*.py' '!**/test_*.py'

# Verification modes for apply (default: syntax)
tug apply python rename --at <file:line:col> --to <new_name> --verify=none
tug apply python rename --at <file:line:col> --to <new_name> --verify=syntax
tug apply python rename --at <file:line:col> --to <new_name> --no-verify  # shorthand for --verify=none
```

### File Filter Specification

File filters restrict which files are included in the operation scope. They use gitignore-style patterns.

**Syntax:** Patterns appear after `--` at the end of the command.

**Pattern Rules:**
- Patterns without `!` prefix are **inclusions**
- Patterns with `!` prefix are **exclusions**
- Standard glob syntax: `*`, `**`, `?`, `[abc]`

**Behavior:**
1. **No filter specified**: All language-appropriate files (`**/*.py` for Python)
2. **Only exclusions**: Start with all files, then apply exclusions
3. **Inclusions specified**: Start with matching files, then apply exclusions

**Default exclusions** (always applied): `.git`, `__pycache__`, `venv`, `.venv`, `node_modules`, `target`

**Examples:**
```bash
# Only files in src/
tug apply python rename ... -- 'src/**/*.py'

# All Python files except tests
tug apply python rename ... -- '!tests/**'

# Files in src/, excluding test files
tug apply python rename ... -- 'src/**/*.py' '!**/test_*.py'

# All Python files except tests and conftest
tug apply python rename ... -- '!tests/**' '!**/conftest.py'
```

### Agent Rules

1. **Always analyze first**: Run `tug analyze python rename` or `tug emit python rename` before applying
2. **Review before apply**: Show preview to user before running `tug apply python rename`
3. **Get explicit approval**: Never apply without user confirmation
4. **Handle errors by exit code**: See Error Codes section
5. **No mutation during workflow**: Don't manually edit files between analyze and apply

## Python Language Support

Python refactoring uses a native Rust CST parser (adapted from LibCST):

1. **Native parsing** - Pure Rust parser in `tugtool-python-cst` crate
2. **Visitor infrastructure** - Collectors for scopes, bindings, references, etc.
3. **Facts collection** - Builds symbol/reference graph via `cst_bridge`
4. **Rename execution** - Applies transformations via native CST

No Python installation is required. All analysis is performed natively in Rust.

### Analyzer Options

The Python analyzer supports optional features via `PythonAnalyzerOptions`:

```rust
use tugtool_python::analyzer::{PythonAdapter, PythonAnalyzerOptions};

let opts = PythonAnalyzerOptions {
    infer_visibility: true,           // Infer visibility from naming conventions
    compute_effective_exports: true,  // Compute exports for modules without __all__
    ..Default::default()
};
let adapter = PythonAdapter::with_options(opts);
```

**`compute_effective_exports`** (default: `false`):
- When enabled and a module lacks an explicit `__all__`, the analyzer emits `ExportIntent::Effective` entries for module-level symbols that are considered public by Python convention:
  - Names not starting with `_` are public
  - Dunder names (`__init__`, `__name__`) are public
  - Names starting with `_` (except dunders) are private
  - Imported symbols are excluded (they're not defined in this module)
- Useful for API surface analysis and move-module refactors

### Receiver Resolution

The analyzer supports resolving receivers in attribute accesses and method calls.

**Single-File Patterns (Level 1-3 inference):**
- Simple names: `obj.method()` (resolves `obj` to its type)
- Dotted paths: `self.handler.process()` (follows attribute chain)
- Call expressions: `get_handler().process()` (uses return type)
- Callable attributes: `self.handler_factory().process()` where handler_factory has type `Callable[[], Handler]`
- Chained calls: `factory().create().process()` (follows call chain up to depth limit)
- Subscript expressions: `items[0].method()` where `items: List[Handler]` (extracts element type)
- isinstance narrowing: `if isinstance(x, Handler): x.process()` (narrows type within branch)

**Unsupported Patterns (returns None):**
- Complex expressions: `(a or b).method()`
- Nested generic extraction: `List[Dict[str, Handler]]` → `Handler`
- Duck typing / protocol-based inference

**Depth Limit:** Resolution is limited to 4 steps (`MAX_RESOLUTION_DEPTH`). Deeper chains like `a.b.c.d.e.method()` return None.

**TypeTracker Methods:**
- `attribute_type_of(class_name, attr_name)` - Get type of class attribute (with property fallback)
- `method_return_type_of(class_name, method_name)` - Get return type of method
- `property_type_of(class_name, property_name)` - Get return type of @property
- `type_of(scope_path, name)` - Get type of variable in scope

### Cross-File Type Resolution

The analyzer supports resolving types across file boundaries when all files are in the workspace.

**Capabilities:**
- Resolve imported types: `from handler import Handler; h = Handler(); h.process()`
- Follow attribute chains through imports: `self.handler.process()` where `Handler` is imported
- Resolve re-exported symbols through import chains
- Support for submodule imports: `from pkg import mod; mod.Handler()`

**Cross-File Resolution Depth:** Limited to 3 files (`MAX_CROSS_FILE_DEPTH`) to prevent performance issues.

**Limitations:**
- Only workspace files are resolved (no external packages)
- Circular imports are detected and gracefully handled (resolution returns None)

### Function-Level Import Resolution

Imports inside functions are tracked and resolved within their defining scope.

**Supported:**
- `from module import Name` inside a function → resolves within that function
- Function-level imports shadow module-level imports (Python's LEGB scoping)
- Nested function/class imports track full scope path

**Example:**
```python
from external import Handler as Handler  # Module-level

def process():
    from internal import Handler  # Function-level, shadows module-level
    h = Handler()
    h.process()  # Resolves to internal.Handler.process
```

**Limitations:**
- Star imports (`from module import *`) without `__all__` expansion are ambiguous (resolution returns None)

### Container Type Element Extraction

Generic container types are resolved for subscript access.

**Supported Containers:**
- Sequence types: `List[T]`, `Sequence[T]`, `Iterable[T]`, `Set[T]`, `Tuple[T, ...]`
- Mapping types: `Dict[K, V]`, `Mapping[K, V]` (extracts value type `V`)
- Optional: `Optional[T]` (extracts `T`)
- Built-in generics: `list[T]`, `dict[K, V]`, `set[T]` (Python 3.9+ syntax)

**Example:**
```python
handlers: List[Handler] = []
first = handlers[0]
first.process()  # Resolves to Handler.process
```

**Limitations:**
- Nested generics: `List[Dict[str, Handler]]` → cannot extract `Handler`
- TypeVar resolution: `T` → concrete type not resolved

### isinstance Type Narrowing

Type narrowing within conditional branches after isinstance checks.

**Supported Patterns:**
- Single type: `isinstance(x, Handler)` narrows `x` to `Handler` in the if-branch
- Tuple of types: `isinstance(x, (A, B))` narrows to `Union[A, B]`

**Example:**
```python
def handle(x: Base) -> None:
    if isinstance(x, Handler):
        x.process()  # Resolves to Handler.process (narrowed from Base)
    # x is still Base type here
```

**Limitations:**
- Attribute narrowing: `isinstance(self.attr, Type)` not supported
- Early-return patterns: narrowing after `if not isinstance(...): return` not supported
- Negated checks: `if not isinstance(x, A)` does not narrow in else branch
- Comprehension scope: `[h for h in items if isinstance(h, Handler)]` not supported

**Key Types:**
- `CrossFileTypeCache` - Caches type information across files
- `FileTypeContext` - Bundle of per-file context (tracker, symbol maps, import targets)
- `ImportTarget` - Resolved import with file path and import kind

### MRO-Based Attribute Lookup

When an attribute is not found directly on a class, the analyzer walks the Method Resolution Order (MRO) to find inherited attributes.

**Supported Patterns:**
- Single inheritance: `class Child(Parent)` → `Child` inherits `Parent` attributes
- Multiple inheritance: `class C(A, B)` → Uses C3 linearization
- Diamond inheritance: Correctly resolves ambiguous attributes via C3
- Cross-file inheritance: Base classes from imported modules are resolved

**Example:**
```python
# base.py
class Base:
    def process(self) -> str: ...

# handler.py
from base import Base
class Handler(Base):
    pass

# consumer.py
from handler import Handler
h = Handler()
h.process()  # Resolves to Base.process() via MRO
```

**MRO Computation:**
- Uses C3 linearization algorithm (same as Python runtime)
- Caches computed MROs per class
- Detects and reports MRO conflicts (inconsistent linearization)

### Property Decorator Support

Properties decorated with `@property` are resolved like attributes.

**Supported:**
- `@property` with return type annotation → provides type for attribute access
- Inherited properties resolved via MRO

**Example:**
```python
class Person:
    @property
    def name(self) -> str:
        return self._name

p = Person()
p.name  # Resolves to type 'str'
```

**Note:** Properties without return type annotations return None.

### Type Stub Support

Type stub files (`.pyi`) provide type information that overrides source types.

**Discovery Rules:**
1. For `foo.py`, check for `foo.pyi` in the same directory (inline stub)
2. If not found, check `stubs/foo.pyi` at workspace root using module path

**Supported Stub Syntax:**
- Class and function signatures with type annotations
- Ellipsis bodies (`...`) and `pass` statement bodies
- `Optional[T]`, `Union[A, B]` type annotations
- `Callable[..., T]` simple named return types
- Class attribute annotations

**Unsupported Stub Syntax (returns None):**
- `@overload` decorated function overloads
- `TypeVar` and generic type parameters
- `Protocol` and structural subtyping
- `ParamSpec` and callable parameter specification
- `TypeAlias` explicit type aliases

**Merge Rules:**
- Stub types override source types
- Source symbols not in stub are preserved (partial stubs supported)

**Example:**
```python
# service.py
class Service:
    def process(self): return 123  # No return type

# service.pyi
class Service:
    def process(self) -> str: ...  # Stub provides type

# consumer.py
s = Service()
s.process()  # Resolves to 'str' from stub
```

## Fixture Commands

Manage test fixtures (external repositories used for integration tests).

```bash
# List available fixtures from lock files
tug fixture list

# Show status of all fixtures (fetched, missing, sha-mismatch, etc.)
tug fixture status

# Show status of specific fixture
tug fixture status temporale

# Fetch all fixtures according to lock files
tug fixture fetch

# Fetch specific fixture
tug fixture fetch temporale

# Force re-fetch even if up-to-date
tug fixture fetch --force

# Update lock file to new version
tug fixture update temporale --ref v0.2.0

# After updating, fetch the new version
tug fixture fetch temporale
```

All fixture commands produce JSON output for agent integration.

## Adding New Features

1. **New refactoring operation**: Add to `crates/tugtool-python/src/`
2. **New CLI command**: Update `crates/tugtool/src/main.rs` and `crates/tugtool/src/cli.rs`
3. **New output type**: Update `crates/tugtool-core/src/output.rs`
4. **New core infrastructure**: Add to `crates/tugtool-core/src/`

Always add tests for new functionality.
