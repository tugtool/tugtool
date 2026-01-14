# Tugtool Development Guide

## Project Overview

Tugtool is an AI-native code transformation engine for verified, deterministic refactors. It provides semantic refactoring operations that understand code structure rather than just text patterns.

## Architecture

```
src/
├── lib.rs          # Library root - re-exports public API
├── main.rs         # CLI binary entry point
├── cli.rs          # CLI command implementations
├── mcp.rs          # Model Context Protocol server
├── error.rs        # Error types (TugError)
├── output.rs       # JSON output types and formatting
├── session.rs      # Session management
├── workspace.rs    # Workspace snapshots
├── sandbox.rs      # Sandboxed file operations
├── patch.rs        # Unified diff generation
├── testcmd.rs      # Test command resolution
├── facts/          # Symbol and reference tracking
│   └── mod.rs      # FactsStore for semantic analysis
├── python/         # Python language support
│   ├── mod.rs      # Python module root
│   ├── analyzer.rs # Semantic analysis
│   ├── worker.rs   # LibCST worker process
│   ├── ops/        # Refactoring operations
│   │   └── rename.rs
│   └── ...
└── rust/           # Rust language support (future)
    └── mod.rs
```

## Build Commands

```bash
# Development build
cargo build

# Release build
cargo build --release

# Run the CLI
cargo run -- --help
```

## Test Commands

**IMPORTANT:** Use nextest for running tests (faster, parallel execution).

```bash
# Run all tests
cargo nextest run

# Run specific test
cargo nextest run test_name_substring

# Run tests with output
cargo nextest run -- --nocapture

# Update golden files (when making intentional schema changes)
TUG_UPDATE_GOLDEN=1 cargo nextest run golden
```

## Quality Checks

```bash
# Format code
cargo fmt

# Lint with clippy
cargo clippy -- -D warnings

# Run all CI checks locally
just ci
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

1. **New refactoring operation**: Add to `src/python/ops/`
2. **New CLI command**: Update `src/main.rs` and `src/cli.rs`
3. **New MCP tool**: Update `src/mcp.rs`
4. **New output type**: Update `src/output.rs`

Always add tests for new functionality.
