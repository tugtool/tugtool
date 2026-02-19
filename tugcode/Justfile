# Tug development commands

default:
    @just --list

# Development
build:
    cargo build --workspace

test:
    cargo nextest run --workspace

# Quality
fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all -- --check

lint:
    cargo clippy --workspace --all-targets -- -D warnings

check:
    cargo check --workspace

# CI (runs all checks)
ci: fmt-check lint test

# Release
build-release:
    cargo build --release

# Run the CLI
run *ARGS:
    cargo run -p tugcode -- {{ARGS}}

# Update golden files (for intentional schema changes)
update-golden:
    TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugcode golden

# Generate documentation
doc:
    cargo doc --workspace --open

# Install locally
install:
    cargo install --path crates/tugcode

# Release a new version
release VERSION:
    ./scripts/release.sh {{VERSION}}
