# Tugtool development commands

default:
    @just --list

# Development
build:
    cargo build

test:
    cargo nextest run

test-all:
    cargo nextest run --all-features

# Quality
fmt:
    cargo fmt

lint:
    cargo clippy --all-features -- -D warnings

# CI (runs all checks)
ci: fmt lint test

# Release
build-release:
    cargo build --release

# Run the CLI
run *ARGS:
    cargo run -- {{ARGS}}

# Start MCP server
mcp:
    cargo run -- mcp

# Update golden files (for intentional schema changes)
update-golden:
    TUG_UPDATE_GOLDEN=1 cargo nextest run golden

# Generate documentation
doc:
    cargo doc --open
