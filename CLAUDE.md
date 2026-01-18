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
│       ├── worker.rs     # LibCST worker process
│       ├── rename.rs     # Rename refactoring
│       └── ...
└── tugtool-rust/     # Rust language support (placeholder)
```

## Feature Flags

The `tugtool` crate supports these feature flags:

| Feature | Default | Description |
|---------|---------|-------------|
| `python` | Yes | Python language support via LibCST |
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
- `python/` - Python toolchain config and cache
- `snapshots/` - Workspace snapshots
- `workers/` - Worker process artifacts

### Environment Variables

- `TUG_PYTHON` - Override Python interpreter path
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

Python refactoring uses LibCST for parsing and transformation:

1. **Environment resolution** - Finds Python with libcst installed
2. **Worker process** - Spawns LibCST worker for analysis
3. **Facts collection** - Builds symbol/reference graph
4. **Rename execution** - Applies transformations via CST

Ensure libcst is available:
```bash
pip install libcst
# Or use tug's managed venv:
tug toolchain python setup
```

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
