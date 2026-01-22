# Tugtool Development Guide

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
│   │   ├── mcp.rs    # Model Context Protocol server
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
| `mcp` | Yes | Model Context Protocol server |
| `full` | No | Enable all features |

Build with specific features:
```bash
# Default features (python + mcp)
cargo build -p tugtool

# MCP only, no Python
cargo build -p tugtool --no-default-features --features mcp

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
# Read the pinned version from lock file
cat fixtures/temporale.lock

# Fetch the fixture (adjust tag as needed)
mkdir -p .tug/fixtures
git clone --depth 1 --branch v0.1.0 \
  https://github.com/tugtool/temporale \
  .tug/fixtures/temporale

# Install in test venv
.tug-test-venv/bin/pip install -e .tug/fixtures/temporale/
```

Or use a local checkout for development:
```bash
export TUG_TEMPORALE_PATH=/path/to/your/temporale
```

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

## Python Language Support

Python refactoring uses a native Rust CST parser (adapted from LibCST):

1. **Native parsing** - Pure Rust parser in `tugtool-python-cst` crate
2. **Visitor infrastructure** - Collectors for scopes, bindings, references, etc.
3. **Facts collection** - Builds symbol/reference graph via `cst_bridge`
4. **Rename execution** - Applies transformations via native CST

No Python installation is required. All analysis is performed natively in Rust.

## MCP Server

Start the MCP server for AI agent integration:
```bash
tug mcp
```

Tools exposed via MCP:
- `tug_snapshot` - Create workspace snapshot
- `tug_analyze_impact` - Analyze refactoring impact
- `tug_rename_symbol` - Execute rename operation
- `tug_verify` - Run verification

## Adding New Features

1. **New refactoring operation**: Add to `crates/tugtool-python/src/`
2. **New CLI command**: Update `crates/tugtool/src/main.rs` and `crates/tugtool/src/cli.rs`
3. **New MCP tool**: Update `crates/tugtool/src/mcp.rs`
4. **New output type**: Update `crates/tugtool-core/src/output.rs`
5. **New core infrastructure**: Add to `crates/tugtool-core/src/`

Always add tests for new functionality.
