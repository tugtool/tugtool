# Version Management

All Rust binaries have divergent version numbers. tugcode, tugbank, tugtool,
and tugrelaunch inherit `0.7.48` from the workspace; tugcast is independently
at `0.1.0`. There is no tooling to set, bump, or synchronize versions. There
is no build number.

## Goals

1. **Unified version:** All Rust binaries share a single semantic version,
   managed from the workspace `Cargo.toml`. Starting point: `0.8.0`.

2. **Build number:** A monotonically-increasing integer that increments on
   every build. Starting point: `1`. Stored in a file at the workspace root
   so it survives across builds and is tracked in git.

3. **Visible in `--version`:** Every binary's `--version` output includes
   the build number. Format: `<name> 0.8.0 (build 1)`.

4. **Version management script:** A shell script (or Rust script via
   `cargo xtask`) to set versions, bump versions (major/minor/patch),
   and bump the build number.


## Current state

| Binary      | Cargo.toml                        | Version | Inherits workspace? |
|-------------|-----------------------------------|---------|---------------------|
| tugcode     | crates/tugcode/Cargo.toml         | 0.7.48  | Yes                 |
| tugcast     | crates/tugcast/Cargo.toml         | 0.1.0   | No                  |
| tugbank     | crates/tugbank/Cargo.toml         | 0.7.48  | Yes                 |
| tugtool     | crates/tugtool/Cargo.toml         | 0.7.48  | Yes                 |
| tugrelaunch | crates/tugrelaunch/Cargo.toml     | 0.7.48  | Yes                 |

Library crates (tugtool-core, tugcast-core, tugbank-core) inherit the
workspace version where applicable. tugcast-core is at `0.1.0` like tugcast.

### How `--version` works today

- **tugcode:** Has a custom `version` subcommand (`commands/version.rs`)
  with `--verbose` for commit/date/rustc info. Also has clap `--version`
  via `const VERSION: &str = env!("CARGO_PKG_VERSION")`.
- **All others:** Use clap's built-in `--version` which reads
  `CARGO_PKG_VERSION` automatically.
- **No binary displays a build number.**


## Design

### Build number file

A plain text file at `tugcode/BUILD_NUMBER` containing a single integer.
Starts at `1`. Incremented by the version management script before each
build. Checked into git so the number is shared across machines and
branches.

### Build-time injection

Each binary's `build.rs` (or a shared workspace-level build approach)
reads `BUILD_NUMBER` and sets a `TUG_BUILD_NUMBER` environment variable
via `cargo::rustc-env`. Binaries that don't have a `build.rs` today will
get a minimal one.

tugcode already has a `build.rs` that sets `TUG_COMMIT`, `TUG_BUILD_DATE`,
and `TUG_RUSTC_VERSION`. Add `TUG_BUILD_NUMBER` to that file. For other
binaries, create a small `build.rs` that reads the build number file and
emits the env var.

Add `cargo::rerun-if-changed=../../BUILD_NUMBER` so cargo rebuilds when
the number changes.

### Version string format

All binaries adopt this format for `--version`:

    <name> 0.8.0 (build 42)

For tugcode's verbose version subcommand:

    tug 0.8.0 (build 42)
      commit:     a34cb38
      built:      2026-04-01
      rustc:      1.85.0

For tugcode's JSON output:

    {"status":"ok","schema_version":"1","version":"0.8.0","build_number":42,...}

### Version management script

A shell script at `tugcode/scripts/version.sh` with these subcommands:

    version.sh set <major.minor.patch>
      Sets workspace.package.version in tugcode/Cargo.toml.
      Sets version in any crate that doesn't use `version.workspace = true`
      (currently tugcast and tugcast-core).
      Runs `cargo generate-lockfile` to update Cargo.lock.

    version.sh bump major|minor|patch
      Reads current version from workspace Cargo.toml, increments the
      specified component, then runs `set` with the new version.

    version.sh build
      Reads tugcode/BUILD_NUMBER, increments by 1, writes it back.
      This is intended to be called before `cargo build`.

    version.sh show
      Prints current version and build number.

### Make tugcast use workspace version

Change `tugcast/Cargo.toml` and `tugcast-core/Cargo.toml` to use
`version.workspace = true` instead of hardcoded `0.1.0`. This is the
prerequisite for unified versioning -- all crates must inherit from the
workspace so `version.sh set` only needs to update one place.


## Sequencing

1. **Unify versions:** Change tugcast and tugcast-core to
   `version.workspace = true`. Set workspace version to `0.8.0`.
   Verify `cargo build` succeeds.

2. **Add build number infrastructure:** Create `tugcode/BUILD_NUMBER`
   with contents `1`. Add `TUG_BUILD_NUMBER` env var injection to
   tugcode's `build.rs`. Create minimal `build.rs` for tugcast,
   tugbank, tugtool, tugrelaunch.

3. **Update `--version` output:** Modify each binary's clap setup to
   include the build number in the version string. Update tugcode's
   `version` subcommand to include build number in plain, verbose,
   and JSON output.

4. **Create version.sh script:** Implement `set`, `bump`, `build`,
   and `show` subcommands. Verify each works correctly.

5. **Verify:** Run `--version` on every binary and confirm the output
   matches the expected format.


## Files affected

| File | Change |
|------|--------|
| `tugcode/Cargo.toml` | version `0.7.48` -> `0.8.0` |
| `tugcode/crates/tugcast/Cargo.toml` | hardcoded `0.1.0` -> `version.workspace = true` |
| `tugcode/crates/tugcast-core/Cargo.toml` | hardcoded `0.1.0` -> `version.workspace = true` |
| `tugcode/BUILD_NUMBER` | New file, contains `1` |
| `tugcode/crates/tugcode/build.rs` | Add `TUG_BUILD_NUMBER` env var |
| `tugcode/crates/tugcode/src/cli.rs` | Include build number in VERSION string |
| `tugcode/crates/tugcode/src/commands/version.rs` | Add build number to all output formats |
| `tugcode/crates/tugcast/build.rs` | Add build number injection (may need new or modified build.rs) |
| `tugcode/crates/tugbank/src/main.rs` | Include build number in clap version |
| `tugcode/crates/tugtool/src/main.rs` | Include build number in clap version |
| `tugcode/crates/tugrelaunch/src/main.rs` | Include build number in clap version |
| `tugcode/scripts/version.sh` | New file, version management script |
