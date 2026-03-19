## Phase 4.0: Bun Pivot {#phase-bun-pivot}

**Purpose:** Replace all npm/Node.js/esbuild tooling with Bun so that tugdeck uses a single runtime for package management, bundling, and TypeScript execution.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugdeck frontend currently depends on npm for package management and esbuild (invoked via npx) for TypeScript bundling. The `build.rs` file in the tugcast crate orchestrates this: it runs `npm install` when `node_modules` is missing, then `npx esbuild` to produce the bundled `app.js`. The CI workflow implicitly relies on Node.js being available on the runner for `cargo build` to succeed.

Bun is a drop-in replacement that serves as runtime, package manager, and bundler in a single binary. Switching to Bun eliminates the esbuild dev dependency, replaces `package-lock.json` with `bun.lockb`, and simplifies the toolchain to one tool for all TypeScript concerns. This is a prerequisite for later phases (tugtalk in Phase 7) which will use Bun as their runtime.

#### Strategy {#strategy}

- Replace `npm install` with `bun install` in `build.rs`, with an upfront check that Bun is installed and a clear error message if not.
- Replace `npx esbuild ... --bundle` with `bun build ...` in `build.rs`, preserving the same output path and minification.
- Remove the `esbuild` dev dependency from `tugdeck/package.json` and update the `build` and `dev` scripts to use `bun build`.
- Delete `tugdeck/package-lock.json` and commit the generated `bun.lockb`.
- Update the CI workflow to install Bun and cache `tugdeck/node_modules`.
- Update the release workflow to install Bun so that `cargo build --release` succeeds.
- Verify that the resulting bundle is functionally equivalent and comparable in size.

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers building tugcast locally (must have Bun installed)
2. CI/CD pipeline (must install Bun before cargo build)

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build -p tugcast` succeeds with Bun and fails clearly if Bun is not installed (verified by removing bun from PATH and checking the error message)
- `cargo nextest run` passes with zero regressions
- No references to npm, npx, or esbuild remain in `build.rs`, `package.json`, CI configs, or `.gitignore`
- `tugdeck/package-lock.json` is deleted; `tugdeck/bun.lockb` exists and is committed
- Bundle size of the Bun-produced `app.js` is within 10% of the esbuild-produced version (manual one-time check)
- CI build job and release job both pass

#### Scope {#scope}

1. `crates/tugcast/build.rs` -- replace npm/npx/esbuild commands with bun equivalents
2. `tugdeck/package.json` -- remove esbuild dependency, update scripts
3. `tugdeck/package-lock.json` -- delete
4. `tugdeck/bun.lockb` -- generate and commit
5. `.github/workflows/ci.yml` -- install Bun, cache node_modules
6. `.github/workflows/release.yml` -- install Bun
7. `.gitignore` -- add `bun.lockb` binary to tracked files (ensure it is not ignored)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migrating any Rust code to Bun/TypeScript
- Adding new TypeScript dependencies or features to tugdeck
- Implementing tugtalk (that is Phase 7)
- Adding a tsconfig.json (Bun handles TypeScript natively)
- Adding automated bundle size CI checks (manual verification only per user answer)

#### Dependencies / Prerequisites {#dependencies}

- Bun must be installable on macOS (dev) and ubuntu-latest (CI)
- Existing xterm.js dependencies must resolve correctly under Bun's package resolution

#### Constraints {#constraints}

- Bun's built-in bundler must support the `--outfile` and `--minify` flags with semantics equivalent to esbuild
- The `bun.lockb` binary file must be committable to git (not in `.gitignore`)
- CI runners must support Bun installation via `oven-sh/setup-bun` GitHub Action

#### Assumptions {#assumptions}

- Bun version should be pinned in CI (e.g., 1.1.0+) to ensure reproducible builds
- The `bun.lockb` file will be committed to the repository after first `bun install`
- Existing xterm.js dependencies are compatible with Bun package resolution
- The `--frozen-lockfile` flag should be used in CI for deterministic builds
- Developer documentation should be updated to list Bun as a build prerequisite alongside Rust
- The `build.rs` bundler output path and minification flags remain the same between esbuild and Bun
- Bun TypeScript support works without a tsconfig.json (as stated in the design doc)

---

### 4.0.0 Design Decisions {#design-decisions}

#### [D01] Fail build.rs with a clear error if Bun is not found (DECIDED) {#d01-bun-check}

**Decision:** The build script checks for the `bun` binary at the start and panics with a human-readable message ("Bun is required to build tugdeck. Install it from https://bun.sh") if it is not on PATH.

**Rationale:**
- Follows Rust ecosystem convention: fail early with a clear message rather than a cryptic "command not found" from a later step.
- The user specifically chose "verify and error if missing" over silently attempting or auto-installing.

**Implications:**
- Developers must install Bun before building tugcast.
- CI workflows must install Bun before `cargo build`.

#### [D02] Update package.json scripts to use bun build (DECIDED) {#d02-package-scripts}

**Decision:** The `build` and `dev` scripts in `tugdeck/package.json` are updated to use `bun build` instead of `esbuild`, so developers can also run manual builds via `bun run build`.

**Rationale:**
- The user chose "update to bun build" for package.json scripts.
- Keeps the scripts consistent with what `build.rs` invokes.
- Developers who want to iterate on tugdeck without cargo can use `bun run build` directly.

**Implications:**
- The `esbuild` dev dependency is removed from `package.json`.
- The scripts use `bun build` syntax which differs slightly from esbuild CLI.

#### [D03] Cache tugdeck/node_modules in CI (DECIDED) {#d03-ci-caching}

**Decision:** CI caches the `tugdeck/node_modules` directory (keyed by `bun.lockb` hash) rather than the global Bun cache.

**Rationale:**
- The user chose "cache tugdeck/node_modules" as the simpler approach that is still fast.
- Bun's install is already fast; caching node_modules avoids even the resolution step on cache hit.
- Simpler cache key (just the lockfile hash) compared to managing global cache paths.

**Implications:**
- Cache key includes `hashFiles('tugdeck/bun.lockb')`.
- `bun install --frozen-lockfile` is used in CI to ensure deterministic installs.

#### [D04] Manual bundle size verification only (DECIDED) {#d04-bundle-size}

**Decision:** Bundle size is verified once during implementation (comparing esbuild vs. Bun output). No ongoing CI check is added.

**Rationale:**
- The user chose "manual verification only" over adding CI bundle size thresholds.
- The Bun pivot is a one-time migration; future bundle size changes are driven by dependency changes, not the bundler.
- Avoids adding CI complexity for a metric that is not expected to regress continuously.

**Implications:**
- The implementation step includes a one-time size comparison logged in the commit message or PR description.
- No `bundlewatch` or similar CI integration is needed.

#### [D05] Pin Bun version in CI (DECIDED) {#d05-bun-version-pin}

**Decision:** The CI workflow pins a specific Bun version (e.g., `bun-version: "1.1.0"`) using the `oven-sh/setup-bun` action.

**Rationale:**
- Ensures reproducible builds across CI runs.
- Prevents unexpected breakage from Bun updates.
- Aligns with the clarifier assumption.

**Implications:**
- Bun version updates in CI are explicit, deliberate changes.
- The pinned version should be updated periodically.

#### [D06] Use --frozen-lockfile in CI (DECIDED) {#d06-frozen-lockfile}

**Decision:** CI runs `bun install --frozen-lockfile` to ensure the lockfile is not modified during CI builds.

**Rationale:**
- Standard practice for deterministic CI builds.
- Catches cases where a developer forgot to update `bun.lockb` after changing `package.json`.

**Implications:**
- If `bun.lockb` is out of sync with `package.json`, CI will fail with a clear error.

---

### 4.0.1 Specification {#specification}

#### 4.0.1.1 build.rs Changes {#build-rs-changes}

**Current behavior:**
1. `npm install` (if `node_modules` missing)
2. `npx esbuild src/main.ts --bundle --outfile=<OUT_DIR>/tugdeck/app.js --minify --target=es2020`

**New behavior:**
1. Check that `bun` is on PATH; panic with clear message if not
2. `bun install` (if `node_modules` missing), run from `tugdeck/` directory
3. `bun build src/main.ts --outfile=<OUT_DIR>/tugdeck/app.js --minify`, run from `tugdeck/` directory

**Key differences:**
- `bun build` does not need `--bundle` (bundling is the default behavior)
- `bun build` does not need `--target=es2020` (Bun targets modern browsers by default)
- No `npx` wrapper needed; `bun build` is a built-in subcommand

#### 4.0.1.2 package.json Changes {#package-json-changes}

**Before:**
```json
{
  "scripts": {
    "build": "esbuild src/main.ts --bundle --outfile=dist/app.js --minify --target=es2020",
    "dev": "esbuild src/main.ts --bundle --outfile=dist/app.js --target=es2020 --watch"
  },
  "devDependencies": {
    "esbuild": "^0.27.0"
  }
}
```

**After:**
```json
{
  "scripts": {
    "build": "bun build src/main.ts --outfile=dist/app.js --minify",
    "dev": "bun build src/main.ts --outfile=dist/app.js --watch"
  }
}
```

The `devDependencies` section is removed entirely (esbuild was the only dev dependency).

#### 4.0.1.3 CI Workflow Changes {#ci-changes}

The `build` job in `.github/workflows/ci.yml` adds two steps before `cargo build`:
1. Install Bun via `oven-sh/setup-bun@v2` with a pinned version
2. Cache `tugdeck/node_modules` keyed by `hashFiles('tugdeck/bun.lockb')`

The `clippy` job also needs Bun installed because `cargo clippy --all-targets` triggers `build.rs`.

The `format` job does not need Bun (it only runs `cargo fmt`).

#### 4.0.1.4 Release Workflow Changes {#release-changes}

The `build` job in `.github/workflows/release.yml` adds a Bun installation step before `cargo build --release`. The release workflow builds on macOS runners, so the `oven-sh/setup-bun` action must work on macOS (it does).

#### 4.0.1.5 File Deletions and Additions {#file-changes}

**Deleted:**
- `tugdeck/package-lock.json`

**Added:**
- `tugdeck/bun.lockb` (binary lockfile, committed to git)

**Modified:**
- `crates/tugcast/build.rs`
- `tugdeck/package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

---

### 4.0.5 Execution Steps {#execution-steps}

#### Step 0: Replace npm/esbuild with Bun in build.rs and package.json {#step-0}

**Commit:** `build: replace npm/esbuild with bun in build.rs and package.json`

**References:** [D01] Fail build.rs with a clear error if Bun is not found, [D02] Update package.json scripts to use bun build, [D04] Manual bundle size verification only, (#build-rs-changes, #package-json-changes, #file-changes)

**Artifacts:**
- Modified `crates/tugcast/build.rs` -- bun check, `bun install`, `bun build`
- Modified `tugdeck/package.json` -- updated scripts, removed esbuild devDependency
- Deleted `tugdeck/package-lock.json`
- Added `tugdeck/bun.lockb`

**Tasks:**
- [ ] Add a Bun existence check at the top of `build.rs` that runs `bun --version` and panics with a descriptive message if it fails
- [ ] Replace the `npm install` block with `bun install`, keeping the `node_modules` existence guard
- [ ] Replace the `npx esbuild` block with `bun build src/main.ts --outfile=<path> --minify`
- [ ] Remove the `--target=es2020` flag (not needed with Bun bundler)
- [ ] Remove `--bundle` flag (Bun bundles by default)
- [ ] Update error messages from "is Node.js installed?" / "is npx available?" to reference Bun
- [ ] In `tugdeck/package.json`, update `scripts.build` to `bun build src/main.ts --outfile=dist/app.js --minify`
- [ ] In `tugdeck/package.json`, update `scripts.dev` to `bun build src/main.ts --outfile=dist/app.js --watch`
- [ ] In `tugdeck/package.json`, remove the entire `devDependencies` section (esbuild was the only entry)
- [ ] Delete `tugdeck/package-lock.json`
- [ ] Run `bun install` in `tugdeck/` to generate `bun.lockb`
- [ ] Ensure `bun.lockb` is not in `.gitignore` (it is a binary file that should be tracked)
- [ ] Record the esbuild bundle size (before) and Bun bundle size (after) for comparison in PR description

**Tests:**
- [ ] Integration test: `cargo build -p tugcast` succeeds and produces `app.js` in the output directory
- [ ] Integration test: the generated `app.js` is non-empty and contains expected markers (e.g., xterm.js references)
- [ ] Manual verification: bundle size is within 10% of esbuild output

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds
- [ ] `cargo nextest run` passes
- [ ] `tugdeck/bun.lockb` exists
- [ ] `tugdeck/package-lock.json` does not exist
- [ ] No references to `npm`, `npx`, or `esbuild` in `crates/tugcast/build.rs`
- [ ] No references to `esbuild` in `tugdeck/package.json`

**Rollback:**
- Revert changes to `build.rs` and `package.json`, restore `package-lock.json`, delete `bun.lockb`

**Commit after all checkpoints pass.**

---

#### Step 1: Update CI and release workflows {#step-1}

**Depends on:** #step-0

**Commit:** `ci: install bun and cache node_modules in CI and release workflows`

**References:** [D03] Cache tugdeck/node_modules in CI, [D05] Pin Bun version in CI, [D06] Use --frozen-lockfile in CI, (#ci-changes, #release-changes)

**Artifacts:**
- Modified `.github/workflows/ci.yml` -- Bun install step, node_modules cache, frozen-lockfile
- Modified `.github/workflows/release.yml` -- Bun install step

**Tasks:**
- [ ] In `.github/workflows/ci.yml`, add `oven-sh/setup-bun@v2` step with pinned `bun-version` to the `build` job, before the `Build` step
- [ ] In `.github/workflows/ci.yml`, add a cache step for `tugdeck/node_modules` keyed by `${{ runner.os }}-bun-${{ hashFiles('tugdeck/bun.lockb') }}`
- [ ] In `.github/workflows/ci.yml`, add a `bun install --frozen-lockfile` step in `tugdeck/` directory (run before cargo build, after cache restore)
- [ ] In `.github/workflows/ci.yml`, add the same Bun setup step to the `clippy` job (clippy triggers build.rs)
- [ ] In `.github/workflows/ci.yml`, add the same `bun install --frozen-lockfile` step to the `clippy` job
- [ ] In `.github/workflows/release.yml`, add `oven-sh/setup-bun@v2` step with pinned `bun-version` to the `build` job, before `Build binary`
- [ ] In `.github/workflows/release.yml`, add a `bun install --frozen-lockfile` step in `tugdeck/` directory
- [ ] Remove any Node.js setup steps if present (none currently, but verify)
- [ ] Verify that the `format` job does NOT need Bun (it only runs `cargo fmt`)

**Tests:**
- [ ] Integration test: push to a branch and verify CI passes (build, clippy, format jobs)
- [ ] Manual verification: confirm cache hit on second CI run by checking the cache restore step output

**Checkpoint:**
- [ ] CI `build` job passes
- [ ] CI `clippy` job passes
- [ ] CI `format` job passes (unmodified, should still work)
- [ ] No references to `npm`, `npx`, `node`, or `esbuild` in any workflow file
- [ ] Bun version is pinned in all workflow files that use it

**Rollback:**
- Revert CI workflow changes; the build will still work locally with Bun from Step 0

**Commit after all checkpoints pass.**

---

### 4.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** All npm/Node.js/esbuild tooling replaced with Bun for tugdeck package management and bundling, with CI updated to match.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugcast` invokes `bun install` and `bun build` (not npm/npx/esbuild)
- [ ] `cargo build -p tugcast` fails with a clear error message if Bun is not installed
- [ ] `cargo nextest run` passes with zero regressions
- [ ] `tugdeck/bun.lockb` is committed; `tugdeck/package-lock.json` is deleted
- [ ] `tugdeck/package.json` has no esbuild dependency and scripts use `bun build`
- [ ] CI workflow installs Bun and caches `tugdeck/node_modules`
- [ ] Release workflow installs Bun
- [ ] Bundle size is within 10% of esbuild output (verified once, recorded in PR)

**Acceptance tests:**
- [ ] Integration test: full `cargo build` from clean state with Bun installed succeeds
- [ ] Integration test: `cargo build` from clean state without Bun fails with human-readable error

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add Bun as a build prerequisite in developer documentation / README
- [ ] Phase 7 (tugtalk) will use Bun as its runtime for the conversation engine
- [ ] Consider adding automated bundle size tracking if bundle grows significantly in future phases

| Checkpoint | Verification |
|------------|--------------|
| Bun replaces npm/esbuild in build.rs | `grep -c 'bun' crates/tugcast/build.rs` returns >= 2, `grep -c 'npm\|npx\|esbuild' crates/tugcast/build.rs` returns 0 |
| package.json updated | `grep -c 'esbuild' tugdeck/package.json` returns 0 |
| Lockfile swapped | `test -f tugdeck/bun.lockb && ! test -f tugdeck/package-lock.json` |
| CI updated | `grep -c 'setup-bun' .github/workflows/ci.yml` returns >= 1 |
| All tests pass | `cargo nextest run` exits 0 |

**Commit after all checkpoints pass.**
