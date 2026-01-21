# Tugtool development commands

default:
    @just --list

# Development
build:
    cargo build --workspace

test:
    cargo nextest run --workspace

test-all:
    cargo nextest run --workspace --all-features

# Quality
fmt:
    cargo fmt --all

lint:
    cargo clippy --workspace --features full -- -D warnings

# CI (runs all checks)
ci: fmt lint test

# Release
build-release:
    cargo build --release

# Run the CLI
run *ARGS:
    cargo run -p tugtool -- {{ARGS}}

# Start MCP server
mcp:
    cargo run -p tugtool -- mcp

# Update golden files (for intentional schema changes)
update-golden:
    TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden

# Generate documentation
doc:
    cargo doc --workspace --open

# Install locally
install:
    cargo install --path crates/tugtool
