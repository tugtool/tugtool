## Phase 1.0: Dev Mode Source-Direct Serving {#phase-dev-source-direct}

**Purpose:** Eliminate the broken copy-to-dist dev mode architecture by serving source files directly from their edit locations via an asset manifest, enabling immediate hot reload for CSS, HTML, and JS. Font files are served directly but require manual refresh (see [D08]).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-source-direct |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-20 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Dev mode hot reload is broken. Editing `tugdeck/styles/tokens.css` does not trigger a live reload in the Mac app. The root cause is that tugcast watches `tugdeck/dist/` (build output) while source files live in `tugdeck/styles/` and `tugdeck/`. A separate script (`watch-assets.ts`) is supposed to copy source files into `dist/` so the watcher sees them, but the Mac app never starts it. Even if it did, the copy-to-dist architecture is needless indirection for files that require no transformation.

The same URL-to-source mapping is hardcoded in three separate places: `watch-assets.ts` (TypeScript `FILE_MAPPINGS`), `build.rs` (Rust `fs::copy` calls), and any new dev server code. Adding a CSS file means updating all three. This is fragile and will drift.

#### Strategy {#strategy}

- Create a single asset manifest (`tugdeck/assets.toml`) as the source of truth for URL-to-source mappings
- Modify tugcast dev mode to serve source files directly from their edit locations instead of from `dist/`
- Change `--dev` from taking a dist path to taking a source tree path (the repo root)
- Make the file watcher derive its watch directories from the manifest
- Replace hardcoded `fs::copy` calls in `build.rs` with a manifest-driven loop
- Delete `watch-assets.ts` and simplify `dev.ts` to just `bun build --watch`
- Have `ProcessManager.swift` spawn `bun build --watch` as a second managed process for JS hot-reload

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers working on tugdeck frontend (CSS, HTML, JS)
2. The Mac app (Tug.app) in Developer Mode

#### Success Criteria (Measurable) {#success-criteria}

- Editing `tugdeck/styles/tokens.css` triggers a live reload in the Mac app within 500ms (verify: save file, observe browser reload)
- Editing `tugdeck/src/main.ts` triggers a JS rebuild and live reload (verify: `bun build --watch` process is spawned by ProcessManager)
- Font files are served directly from source in dev mode (verify: browser loads fonts); font changes require manual refresh (per [D08])
- Adding a new CSS file requires editing only `tugdeck/assets.toml` (verify: add entry, confirm it serves in dev mode and embeds in production build)
- `cargo build` succeeds with no warnings and production-embedded assets are identical to pre-change behavior (verify: `cargo nextest run`)
- `watch-assets.ts` is deleted and `dev.ts` is simplified (verify: file does not exist, `bun run dev` runs only `bun build --watch`)

#### Scope {#scope}

1. Create `tugdeck/assets.toml` manifest with `[files]`, `[dirs]`, and `[build]` sections
2. Rewrite `tugcast/src/dev.rs` to parse the manifest, build a route map, and watch source directories
3. Update `tugcast/src/server.rs` to use the manifest-based route mapper instead of `ServeDir::new(path)`
4. Update `tugcast/src/cli.rs` help text to clarify `--dev` takes a source tree path
5. Rewrite `tugcast/build.rs` to read the manifest instead of hardcoded `fs::copy` calls
6. Update `tugapp/Sources/ProcessManager.swift` to pass source tree directly and spawn `bun build --watch`
7. Update `tugapp/Sources/TugConfig.swift` to remove `tugdeckDistRel` constant
8. Delete `tugdeck/scripts/watch-assets.ts`
9. Rewrite `tugdeck/scripts/dev.ts` to just run `bun build --watch`
10. Update `tugdeck/package.json` to remove `dev:assets` script and simplify `dev` script

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing production serving (`rust-embed` continues to embed from `$OUT_DIR/tugdeck/`)
- Changing release/CI builds (`bun build` still outputs to `dist/`)
- Changing `index.html` URL paths (they remain flat; only server-side mapping changes)
- Adding new asset types beyond what the manifest currently describes
- Hot Module Replacement (HMR) for CSS (full page reload is acceptable)

#### Dependencies / Prerequisites {#dependencies}

- `toml` crate already available as workspace dependency (version 0.8)
- `serde` with `Deserialize` already available as workspace dependency
- `glob` crate for real glob pattern matching (new dependency)
- Bun installed for `bun build --watch` spawning
- Existing `notify` crate already used for file watching

#### Constraints {#constraints}

- Build policy: warnings are errors (`-D warnings` via `.cargo/config.toml`)
- `build.rs` must fail if `assets.toml` is malformed or missing
- Dev mode must validate the manifest at startup and warn about missing files but serve 404 at runtime
- Custom asset serving must enforce path safety: normalize paths, reject traversal, verify bounds (see [D09])
- Font files (`.woff2`) continue to use existing `content_type_for()` logic (extended with `font/woff2` mapping)
- File watcher extension filter remains `.html`, `.css`, `.js`; font changes do not trigger live reload (see [D08])
- No changes to `index.html` URL structure
- `build.rs` must emit `cargo:rerun-if-changed` for `assets.toml` and all manifest-resolved source files/dirs

#### Assumptions {#assumptions}

- The roadmap document (`roadmap/dev-mode-source-direct-serving.md`) is complete and accurate for implementation
- The manifest `toml` crate with serde is sufficient for parsing (no custom parser needed)
- The `glob` crate provides real glob pattern matching for `[dirs]` entries
- The watcher can automatically derive directories to watch from manifest source paths (with deduplication to avoid overlapping recursive watches)
- ProcessManager will spawn `bun build --watch` as a second managed process
- Real glob patterns (via `glob` crate) in `[dirs]` entries for dynamic file sets
- No backward compatibility needed for `--dev` flag — clean break from dist-path semantics

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Asset manifest as single source of truth (DECIDED) {#d01-asset-manifest}

**Decision:** Create `tugdeck/assets.toml` with `[files]`, `[dirs]`, and `[build]` sections as the single source of truth for URL-to-source-path mappings, read by dev serving, `build.rs`, and the file watcher.

**Rationale:**
- The same mapping is currently hardcoded in three places (`watch-assets.ts`, `build.rs`, future dev code)
- A TOML manifest is self-documenting, easy to validate, and obvious to edit
- Adding a new asset requires editing one line in one file

**Implications:**
- `build.rs` must parse TOML (adds `toml` + `serde` as build dependencies)
- The manifest becomes a required file; missing or malformed manifest fails the build
- `cargo:rerun-if-changed` must include `assets.toml`

---

#### [D02] Dev mode serves source files directly (DECIDED) {#d02-source-direct}

**Decision:** In dev mode, tugcast serves source files directly from their edit locations by building a `HashMap<String, PathBuf>` from the manifest `[files]` section. Requests fall through to `[dirs]` entries, then to the `[build].fallback` directory for JS.

**Rationale:**
- Six of eight file types in `dist/` are straight copies requiring no transformation
- Direct serving eliminates the broken copy-to-dist indirection
- The three-tier lookup (files -> dirs -> fallback) handles all current asset types

**Implications:**
- `DevPath` newtype changes from holding a single directory to holding the parsed manifest state
- `server.rs` replaces `ServeDir::new(path)` with a custom fallback handler
- The file watcher watches source directories instead of `dist/`

---

#### [D03] CLI --dev flag takes source tree root (DECIDED) {#d03-dev-source-tree}

**Decision:** The `--dev` flag changes from `--dev <dist-path>` to `--dev <source-tree>` where source-tree is the repo root. Tugcast reads `{source-tree}/tugdeck/assets.toml` at startup.

**Rationale:**
- The source tree root is the natural unit of reference; `dist/` is an implementation detail
- ProcessManager already knows the source tree path; it was appending `/tugdeck/dist` unnecessarily
- Reading `assets.toml` from `{source-tree}/tugdeck/` is deterministic and self-contained

**Implications:**
- CLI help text must be updated
- Existing `--dev` callers (ProcessManager) must stop appending `/tugdeck/dist`
- `main.rs` derives the manifest path as `{dev_path}/tugdeck/assets.toml`

---

#### [D04] Use toml crate with serde for manifest parsing (DECIDED) {#d04-toml-serde}

**Decision:** Use the `toml` crate (dtolnay, already in workspace at version 0.8) with serde `Deserialize` to parse the asset manifest into typed Rust structs.

**Rationale:**
- `toml` is already a workspace dependency
- Serde derive gives typed access with clear error messages for malformed manifests
- No custom parser needed

**Implications:**
- `build.rs` needs `toml` and `serde` as build-time dependencies (added to `[build-dependencies]` with explicit version pins, not `workspace = true`, because cargo workspace inheritance for `[build-dependencies]` is not reliable across all cargo versions)
- The `toml` crate is also needed as a regular `[dependencies]` entry for runtime manifest parsing in `dev.rs`
- Manifest struct definitions are duplicated between `dev.rs` and `build.rs` since build scripts cannot import crate code; they are small (3 structs, ~15 lines) so duplication is acceptable and must be kept in sync manually

---

#### [D05] Warn at startup, 404 at runtime for missing files (DECIDED) {#d05-missing-files}

**Decision:** At dev mode startup, validate all manifest source paths exist and log warnings for any that are missing. At runtime, serve 404 for requests to files that do not exist on disk.

**Rationale:**
- Failing hard on a missing optional asset (like a font) would be too aggressive for dev mode
- Warnings at startup give immediate visibility into configuration issues
- 404 at runtime is the natural HTTP response for missing files

**Implications:**
- Startup validation iterates all `[files]` and `[dirs]` entries, logs warnings
- Runtime file serving uses `tokio::fs::read` or `std::fs::read` with 404 fallback
- No caching of file contents in dev mode (always serve from disk for hot reload)

---

#### [D06] ProcessManager spawns bun build --watch as second managed process (DECIDED) {#d06-bun-watch-process}

**Decision:** `ProcessManager.swift` spawns `bun build --watch` as a second managed process alongside tugcast when dev mode is enabled, so JS changes also trigger hot reload.

**Rationale:**
- Without this, only CSS and HTML changes are live; JS requires a manual rebuild
- The whole point of dev mode is hot-reload of all resources including JS
- ProcessManager already manages process lifecycle; adding a second process follows the same pattern

**Implications:**
- ProcessManager needs a `bunProcess: Process?` field and lifecycle management
- The bun process must be killed when tugcast stops, and vice versa
- Bun must be findable on the user's shell PATH (already resolved by `ProcessManager.shellPATH`)
- `TugConfig.swift` removes `tugdeckDistRel` since ProcessManager no longer appends it

---

#### [D07] Dir entries use real glob patterns for dynamic file sets (DECIDED) {#d07-dir-glob-patterns}

**Decision:** The `[dirs]` section in the manifest supports real glob patterns (e.g., `*.woff2`, `*.{woff,woff2}`) to match files within a directory. Use the `glob` crate's pattern matching semantics.

**Rationale:**
- Font files are added and removed; listing each one defeats the purpose of a directory entry
- Glob patterns are well-understood, standard (1970s-era tech), and the `glob` crate provides reliable matching
- The pattern is applied at both dev serve time and build time

**Implications:**
- Add `glob` crate to `[dependencies]` and `[build-dependencies]`
- Dev mode lists directory contents and filters by glob pattern for `[dirs]` requests
- `build.rs` iterates directory entries and applies the glob filter when copying
- **Glob pattern matches against the file's basename only** (e.g., `*.woff2` matches `Hack-Regular.woff2`), not the relative path under `src`. Both dev serving and `build.rs` use the same contract: `glob::Pattern::matches(filename)` where `filename` is the entry's file name component.
- Full glob semantics available from day one — no deferred "future use" half-measures

---

#### [D08] File watcher does not add .woff2 to extension filter (DECIDED) {#d08-watcher-extensions}

**Decision:** The file watcher extension filter remains `.html`, `.css`, `.js` only. Font file changes (`.woff2`) do not trigger live reload.

**Rationale:**
- Font files are binary assets that change extremely rarely (typically only when adding a new font family)
- A full page reload for a font change would be disruptive and unlikely to show a meaningful difference
- The browser caches fonts aggressively; a reload would not necessarily pick up the new font without a hard refresh
- If font hot-reload is needed in the future, it can be added by extending the filter (a one-line change)

**Implications:**
- Adding or changing a font file requires a manual browser refresh or server restart
- The watcher still watches `tugdeck/styles/fonts/` (derived from manifest) but ignores `.woff2` events
- This is an acceptable trade-off for dev mode; fonts are edited far less frequently than CSS/JS

---

#### [D09] Custom asset serving must enforce path safety (DECIDED) {#d09-path-safety}

**Decision:** The custom `serve_dev_asset` handler must normalize request paths and reject any path that would escape the intended source roots. This replaces the path safety that `ServeDir` previously provided.

**Rationale:**
- Today dev mode relies on `ServeDir` from `tower-http`, which handles path normalization and prevents directory traversal (encoded `..`, etc.)
- Replacing `ServeDir` with a custom handler removes this safety net
- Even though dev mode is local-only (`127.0.0.1`), defense in depth is the right practice

**Implementation:**
- Decode percent-encoding using `percent_encoding::percent_decode_str` from the `percent-encoding` crate (already a transitive dependency via `url`/`hyper`; add as direct dependency if needed). If decoding produces invalid UTF-8, return 404 immediately.
- Resolve `.` and `..` segments logically (path component iteration, not filesystem canonicalization) to produce a clean relative path
- Join the clean relative path onto the allowed root to produce a candidate filesystem path
- Canonicalize using the **parent directory** strategy: `canonicalize(candidate.parent())` + `candidate.file_name()`. This handles the case where the target file does not yet exist (e.g., a font being added) without failing. If the parent does not exist, return 404.
- Verify the canonicalized path starts with one of the allowed root directories (the `tugdeck/` subtree or `dist/`). Reject (404) any path that escapes these bounds.
- Do not follow symlinks that point outside the allowed roots

**Implications:**
- `serve_dev_asset` must canonicalize paths before serving
- This is a hard requirement, not optional hardening

---

#### [D10] Reload script injection on both / and /index.html (DECIDED) {#d10-index-injection}

**Decision:** The reload script tag is injected into `index.html` responses served from both the `/` route and a direct `/index.html` request.

**Rationale:**
- Current behavior only injects on `/`; a direct `index.html` request would bypass injection
- Both routes serve the same file and should behave identically in dev mode

**Implications:**
- `serve_dev_index` handles both `/` and `/index.html` URL paths
- The `[files]` lookup for `index.html` must route through the injection handler, not the plain file handler

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Manifest struct drift | med | med | Small structs, review discipline | Build.rs and dev.rs diverge on field names |
| Bun process failure | low | med | Log and continue; tugcast still serves | Bun not installed or crashes |
| toml crate version mismatch | low | low | Pin versions explicitly | Cargo dependency resolution errors |
| Duplicate watch roots | low | med | Deduplicate dirs, skip subdirs of watched parents | Jittery reloads during active rebuilds |

**Risk R04: Duplicate watch roots may generate noisy reloads** {#r04-duplicate-watch-roots}

- **Risk:** Watching `tugdeck/`, `tugdeck/styles/`, `tugdeck/styles/fonts/`, and `tugdeck/dist/` simultaneously with `RecursiveMode::Recursive` can produce duplicate filesystem events for the same file change, causing jittery reload behavior especially during active JS rebuilds.
- **Mitigation:**
  - `watch_dirs_from_manifest` must deduplicate: if a directory is a subdirectory of another already-watched directory, skip it (the parent's recursive watch covers it)
  - Sort directories by depth, add only if no existing entry is an ancestor
  - This produces minimal, non-overlapping watch roots
- **Residual risk:** Even with deduplication, rapid successive file writes (e.g., bun writing multiple chunk files) can fire multiple debounced reloads. The existing 300ms debounce handles this adequately.

**Risk R01: Manifest struct duplication between dev.rs and build.rs may drift** {#r01-manifest-drift}

- **Risk:** The `AssetManifest`, `DirEntry`, and `BuildConfig` structs are duplicated in `dev.rs` (runtime) and `build.rs` (build script) because build scripts cannot import crate code. If one is updated without the other, parsing may silently succeed with missing fields or fail unexpectedly.
- **Mitigation:**
  - The structs are intentionally small (3 types, ~15 lines each) to minimize drift surface
  - Add a comment in both locations cross-referencing the other copy
  - A future follow-on could extract the structs into a tiny shared crate, but this is not worth the complexity for 3 small types
- **Residual risk:** A developer adding a new manifest section could forget to update `build.rs`. The build would still succeed but would not copy the new asset type into `$OUT_DIR`.

**Risk R02: Bun process spawning in ProcessManager adds failure modes** {#r02-bun-process}

- **Risk:** ProcessManager spawning `bun build --watch` as a second managed process introduces new failure scenarios: bun not installed, bun crashes, bun process outlives tugcast.
- **Mitigation:**
  - Use `ProcessManager.which("bun")` to check bun availability before spawning; log warning and skip if not found
  - Handle bun process exit: log but do not crash tugcast (CSS/HTML hot-reload still works without bun)
  - Ensure `stop()` kills both processes; use `terminationHandler` or explicit cleanup
- **Residual risk:** If bun crashes silently, JS changes will not hot-reload until the user notices and restarts. This is acceptable for dev mode.

**Risk R03: toml crate needed in both [dependencies] and [build-dependencies]** {#r03-toml-dual-dep}

- **Risk:** The `toml` crate is needed as a regular dependency (for runtime manifest parsing in `dev.rs`) and as a build dependency (for `build.rs`). Using `workspace = true` for `[build-dependencies]` is not reliably supported across all cargo versions.
- **Mitigation:**
  - Use `workspace = true` for `[dependencies]` (well-supported)
  - Use explicit version pins (`toml = "0.8"`, `serde = { version = "1", features = ["derive"] }`) for `[build-dependencies]`
  - Pin the same versions as the workspace to avoid resolution conflicts
- **Residual risk:** Version drift between workspace and build-dependencies is possible but unlikely since both pin `0.8` / `1`.

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Asset Manifest Format {#manifest-format}

**Spec S01: assets.toml Schema** {#s01-manifest-schema}

```toml
# tugdeck/assets.toml
# All source paths are relative to the tugdeck/ directory.

[files]
"index.html" = "index.html"
"tokens.css" = "styles/tokens.css"
"cards.css" = "styles/cards.css"
"cards-chrome.css" = "styles/cards-chrome.css"
"dock.css" = "styles/dock.css"
"app.css" = "node_modules/@xterm/xterm/css/xterm.css"

[dirs]
"fonts" = { src = "styles/fonts", pattern = "*.woff2" }

[build]
fallback = "dist"
```

**Table T01: Manifest Section Semantics** {#t01-manifest-sections}

| Section | Key | Value | Semantics |
|---------|-----|-------|-----------|
| `[files]` | URL path segment (no leading `/`) | Source path relative to `tugdeck/` | 1:1 mapping; exact URL match serves the source file |
| `[dirs]` | URL path prefix | `{ src = "...", pattern = "..." }` | Directory mapping; URL `/{prefix}/{filename}` serves `{src}/{filename}` if it matches pattern |
| `[build]` | `fallback` | Directory relative to `tugdeck/` | Catch-all for requests not matched by `[files]` or `[dirs]` (JS build output) |

**Lookup order in dev mode:**
1. Check `[files]` map for exact URL match
2. Check `[dirs]` entries for URL prefix match (file must exist and match pattern)
3. Serve from `[build].fallback` directory
4. Return 404

#### 1.0.1.2 Rust Manifest Types {#manifest-types}

**Spec S02: Manifest Structs** {#s02-manifest-structs}

```rust
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub(crate) struct AssetManifest {
    pub files: HashMap<String, String>,
    pub dirs: Option<HashMap<String, DirEntry>>,
    pub build: Option<BuildConfig>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DirEntry {
    pub src: String,
    pub pattern: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BuildConfig {
    pub fallback: String,
}
```

#### 1.0.1.3 Dev Serving Behavior {#dev-serving-behavior}

**Request handling (per [D02], [D09], [D10]):**
- `GET /` -> serve `index.html` from manifest `[files]` with reload script injection
- `GET /index.html` -> same as `/` (reload script injected, per [D10])
- `GET /tokens.css` -> serve `tugdeck/styles/tokens.css` from manifest `[files]`
- `GET /fonts/Hack-Regular.woff2` -> serve `tugdeck/styles/fonts/Hack-Regular.woff2` from manifest `[dirs]`
- `GET /app.js` -> serve `tugdeck/dist/app.js` from manifest `[build].fallback`
- `GET /nonexistent` -> 404

**Content-Type:** Reuse existing `content_type_for()` function from `server.rs`. Change its visibility from private to `pub(crate)` so `dev.rs` can call it for `serve_dev_asset`. Add `.woff2` -> `font/woff2` mapping. No duplicate content-type logic.

**Path safety (per [D09]):** All request paths are normalized (percent-decoded, `.`/`..` resolved) and the final filesystem path is verified to start with an allowed root. Paths that escape the allowed roots return 404.

**No caching:** Always read from disk on each request (enables hot reload without cache invalidation).

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/assets.toml` | Asset manifest: URL-to-source mappings |

#### 1.0.2.2 Deleted files {#deleted-files}

| File | Reason |
|------|--------|
| `tugdeck/scripts/watch-assets.ts` | Replaced by source-direct serving |

#### 1.0.2.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `AssetManifest` | struct | `tugcast/src/dev.rs` | Serde-deserializable manifest type |
| `DirEntry` | struct | `tugcast/src/dev.rs` | Directory entry with src path and glob pattern (compiled via `glob::Pattern`) |
| `BuildConfig` | struct | `tugcast/src/dev.rs` | Build fallback configuration |
| `DevState` | struct | `tugcast/src/dev.rs` | Replaces `DevPath`; holds parsed manifest + resolved paths |
| `load_manifest` | fn | `tugcast/src/dev.rs` | Parse `assets.toml` from source tree |
| `serve_dev_asset` | fn | `tugcast/src/dev.rs` | Three-tier asset lookup handler |
| `validate_manifest` | fn | `tugcast/src/dev.rs` | Startup validation: warn about missing files |
| `watch_dirs_from_manifest` | fn | `tugcast/src/dev.rs` | Derive watch directories from manifest entries |
| `content_type_for` (modify) | fn | `tugcast/src/server.rs` | Change to `pub(crate)`, add `.woff2` -> `font/woff2`; reused by `dev.rs` |
| `build_app` (modify) | fn | `tugcast/src/server.rs` | Use `DevState` and `serve_dev_asset` instead of `ServeDir` |
| `integration_tests.rs` (modify) | test file | `tugcast/src/integration_tests.rs` | Update 3 `build_app` call sites (lines 42, 455, 520) to new signature |
| `--dev` (modify) | CLI arg | `tugcast/src/cli.rs` | Update help text: source tree path |
| `AssetManifest` (build) | struct | `tugcast/build.rs` | Duplicated manifest struct for build script (no crate sharing) |
| `tugdeckDistRel` (remove) | static | `tugapp/Sources/TugConfig.swift` | No longer needed |
| `bunProcess` | property | `tugapp/Sources/ProcessManager.swift` | Second managed process for `bun build --watch` |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test manifest parsing, route lookup, content type detection | Core logic in `dev.rs` and `build.rs` |
| **Integration** | Test full request cycle through axum router in dev mode | End-to-end serving with test manifest |
| **Golden / Contract** | Verify `build.rs` produces correct `$OUT_DIR` layout | Production embed directory structure |

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Create asset manifest and add toml dependencies {#step-0}

**Commit:** `feat(tugdeck): add assets.toml manifest and toml dependencies`

**References:** [D01] Asset manifest as single source of truth, [D04] Use toml crate with serde, [D07] Dir entries use glob patterns, Risk R03, Spec S01, Table T01, (#manifest-format, #s01-manifest-schema, #t01-manifest-sections, #r03-toml-dual-dep)

**Artifacts:**
- `tugdeck/assets.toml` (new file)
- `tugcode/crates/tugcast/Cargo.toml` (add `toml` and `serde` to both `[dependencies]` and `[build-dependencies]`)

**Tasks:**
- [ ] Create `tugdeck/assets.toml` with `[files]`, `[dirs]`, and `[build]` sections matching the current asset set
- [ ] Add `toml = { workspace = true }` to tugcast's `[dependencies]` in `Cargo.toml` (for runtime manifest parsing in `dev.rs`)
- [ ] Add `glob` to tugcast's `[dependencies]` in `Cargo.toml` (for real glob pattern matching in `[dirs]` entries, per [D07])
- [ ] Add explicit version pins to tugcast's `[build-dependencies]` in `Cargo.toml`: `toml = "0.8"`, `serde = { version = "1", features = ["derive"] }`, and `glob = "0.3"` (not `workspace = true`; cargo workspace inheritance for `[build-dependencies]` is unreliable across cargo versions)
- [ ] Add `cargo:rerun-if-changed` for `assets.toml` in `build.rs` (can be just the println line for now; full build.rs rewrite is Step 2)

**Tests:**
- [ ] Unit test: verify `assets.toml` is valid TOML and parses into expected structure (can be a standalone test or build-time check)

**Checkpoint:**
- [ ] `tugdeck/assets.toml` exists and contains all current asset mappings
- [ ] `cargo check -p tugcast` succeeds with no warnings

**Rollback:**
- Delete `tugdeck/assets.toml`, revert `Cargo.toml` changes

**Commit after all checkpoints pass.**

---

#### Step 1: Implement manifest-based dev serving across dev.rs, server.rs, main.rs {#step-1}

**Depends on:** #step-0

> This step atomically replaces the old `DevPath`/`ServeDir` dev mode with manifest-based serving.
> All files that reference `DevPath`, `dev_file_watcher`, `build_app`, and `ServeDir` are updated
> together so the crate compiles at every intermediate state. Splitting these across separate steps
> would break `cargo check` at the step boundary because `server.rs` (line 85) references
> `crate::dev::DevPath`, `main.rs` (line 131) calls `dev::dev_file_watcher` with the old `&Path`
> signature, and `integration_tests.rs` (lines 42, 455, 520) calls `build_app` with the old
> `Option<PathBuf>` signature.

**Commit:** `feat(tugcast): manifest-based source-direct dev serving`

**References:** [D01] Asset manifest as single source of truth, [D02] Dev mode serves source files directly, [D03] CLI --dev flag takes source tree root, [D04] Use toml crate with serde, [D05] Warn at startup 404 at runtime, [D07] Dir entries use real glob patterns, [D08] File watcher does not add .woff2 to extension filter, [D09] Custom asset serving must enforce path safety, [D10] Reload script injection on both / and /index.html, Risk R01, Risk R04, Spec S02, (#manifest-types, #dev-serving-behavior, #s02-manifest-structs, #r01-manifest-drift, #r04-duplicate-watch-roots, #d09-path-safety, #d10-index-injection)

**Artifacts:**
- `tugcast/src/dev.rs` (add manifest types and functions; replace `DevPath` with `DevState`)
- `tugcast/src/server.rs` (replace `ServeDir` with manifest fallback; make `content_type_for` `pub(crate)`; add `.woff2`; remove `tower-http` import)
- `tugcast/src/main.rs` (load manifest at startup; pass `DevState` and derived watch dirs)
- `tugcast/src/cli.rs` (update `--dev` help text)
- `tugcast/src/integration_tests.rs` (update 3 `build_app` call sites to new signature)
- `tugcode/crates/tugcast/Cargo.toml` (remove `tower-http` from `[dependencies]`; add `glob` to `[dependencies]`)

**Tasks:**

*dev.rs changes:*
- [ ] Define `AssetManifest`, `DirEntry`, `BuildConfig` structs with serde `Deserialize`; add comment: "Keep in sync with build.rs copy"
- [ ] Define `DevState` struct holding: `files: HashMap<String, PathBuf>` (resolved absolute paths), `index_path: PathBuf` (resolved index.html for injection), `dirs: Vec<(String, PathBuf, glob::Pattern)>` (prefix, abs path, compiled glob pattern), `fallback: PathBuf`, `source_tree: PathBuf`
- [ ] Implement `load_manifest(source_tree: &Path) -> Result<DevState, String>` that reads `{source_tree}/tugdeck/assets.toml`, parses it, resolves all paths relative to `{source_tree}/tugdeck/`, and compiles glob patterns via `glob::Pattern::new()`
- [ ] Implement `validate_manifest(state: &DevState)` that logs warnings for missing files/directories
- [ ] Implement `watch_dirs_from_manifest(state: &DevState) -> Vec<PathBuf>` that collects unique parent directories from files, dirs sources, and the fallback directory; **deduplicate**: sort by depth, skip any directory that is a subdirectory of an already-included ancestor (per Risk R04 — prevents duplicate events from overlapping recursive watches)
- [ ] Implement `serve_dev_asset(uri, dev_state) -> Response` with three-tier lookup: files map -> dirs prefix match with glob pattern filter -> fallback directory -> 404. Use `crate::server::content_type_for()` for content type detection (no duplicate logic). **Path safety (per [D09]):** normalize the request URI (decode percent-encoding, resolve `.` and `..`), canonicalize the resolved filesystem path, and reject (404) any path that does not start with an allowed root (the `tugdeck/` subtree or fallback `dist/` directory). Do not follow symlinks that escape these bounds.
- [ ] Update `serve_dev_index` to read `index.html` from the manifest's resolved `index_path` instead of `dev_path.0.join("index.html")`; **handle both `/` and `/index.html` routes** (per [D10]) — the `[files]` lookup for `index.html` must route through the injection handler, not the plain file handler
- [ ] Remove `DevPath` newtype; replace with `DevState` (wrapped in `Arc` for sharing via axum Extension)
- [ ] Update `dev_file_watcher` to accept `&[PathBuf]` (deduplicated watch directories from manifest) instead of a single `&Path`; register each directory with the watcher individually using `RecursiveMode::Recursive`
- [ ] File watcher extension filter remains `.html`, `.css`, `.js` only (per [D08]); `.woff2` events are ignored

*server.rs changes:*
- [ ] Change `content_type_for` visibility from private to `pub(crate)` so `dev.rs` can reuse it
- [ ] Add `.woff2` -> `"font/woff2"` to `content_type_for()`
- [ ] Update `build_app` signature: change `dev_path: Option<PathBuf>` to `dev_state: Option<Arc<DevState>>`; change `reload_tx: Option<broadcast::Sender<()>>` accordingly
- [ ] Register both `.route("/", get(crate::dev::serve_dev_index))` and `.route("/index.html", get(crate::dev::serve_dev_index))` so reload script injection applies to both paths (per [D10])
- [ ] Replace `.fallback_service(ServeDir::new(path))` with `.fallback(serve_dev_asset)` using `DevState` via Extension
- [ ] Update `run_server` signature to match `build_app` changes
- [ ] Remove `use tower_http::services::ServeDir;` import (it is the only `tower-http` usage in the crate)

*main.rs changes:*
- [ ] When `cli.dev` is `Some`, call `dev::load_manifest(&dev_path)` to get `DevState`; exit with error if manifest fails to load
- [ ] Call `dev::validate_manifest(&dev_state)` at startup
- [ ] Call `dev::watch_dirs_from_manifest(&dev_state)` and pass the result to `dev_file_watcher`
- [ ] Pass `Arc<DevState>` to `build_app` and `run_server`

*cli.rs changes:*
- [ ] Update `--dev` help text from "Path to dev asset directory (serves from disk instead of embedded assets)" to "Path to source tree root (serves assets directly from source via manifest)"

*integration_tests.rs changes:*
- [ ] Update `build_test_app` (line 42): `build_app(feed_router, None, None)` stays `None, None` (types change but `None` is compatible)
- [ ] Update `test_build_app_dev_mode` (line 455): construct a `DevState` from the temp directory instead of passing `Some(temp_dir.path().to_path_buf())`; write a minimal `assets.toml` to the temp dir
- [ ] Update `test_dev_reload_sse_endpoint` (line 520): same pattern as above; construct `DevState` and pass `Some(Arc::new(dev_state))`

*Cargo.toml changes:*
- [ ] Remove `tower-http = { workspace = true }` from `[dependencies]` (only usage was `ServeDir` in `server.rs`, now removed)
- [ ] Add `glob` to `[dependencies]` (for real glob pattern matching in `[dirs]` entries, per [D07])

**Tests:**
- [ ] Unit test: `load_manifest` with a temp directory containing a valid `assets.toml` produces correct `DevState`
- [ ] Unit test: `load_manifest` with missing `assets.toml` returns error
- [ ] Unit test: `serve_dev_asset` resolves `[files]` entries correctly
- [ ] Unit test: `serve_dev_asset` resolves `[dirs]` entries correctly
- [ ] Unit test: `serve_dev_asset` falls back to `[build].fallback` for unmatched URLs
- [ ] Unit test: `serve_dev_asset` returns 404 for completely unknown URLs
- [ ] Unit test: `serve_dev_asset` returns 404 for path traversal attempts (e.g., `/../../../etc/passwd`, `/%2e%2e/secret`) per [D09]
- [ ] Unit test: `watch_dirs_from_manifest` returns correct set of directories
- [ ] Unit test: `watch_dirs_from_manifest` deduplicates overlapping directories (e.g., does not include both `styles/` and `styles/fonts/` when `styles/` is already watched recursively)
- [ ] Unit test: `validate_manifest` logs warnings for missing files (can use tracing test subscriber)
- [ ] Unit test: `content_type_for("font.woff2")` returns `"font/woff2"`
- [ ] Integration test: build app with dev state, make GET request for a `[files]` entry, verify 200 with correct content
- [ ] Integration test: make GET request for a `[dirs]` entry, verify 200
- [ ] Integration test: make GET request for `/index.html`, verify 200 with reload script injected (same as `/`, per [D10])
- [ ] Integration test: make GET request for unknown path, verify 404
- [ ] Integration test: make GET request with path traversal (e.g., `/../../../etc/passwd`), verify 404 (per [D09])
- [ ] Existing integration tests (`test_build_app_production_mode`, `test_build_app_dev_mode`, `test_dev_reload_sse_endpoint`) pass with updated signatures

**Checkpoint:**
- [ ] `cargo check -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` passes (all existing + new tests)
- [ ] Manual test: `tugcast --dev /path/to/tugtool` serves `tokens.css` from source, `app.js` from `dist/`

**Rollback:**
- Revert `dev.rs`, `server.rs`, `main.rs`, `cli.rs`, `integration_tests.rs`, `Cargo.toml` changes; restore `DevPath`, `ServeDir`, and `tower-http` dependency

**Commit after all checkpoints pass.**

---

#### Step 2: Rewrite build.rs to read manifest {#step-2}

**Depends on:** #step-0

**Commit:** `refactor(tugcast): build.rs reads asset manifest instead of hardcoded copies`

**References:** [D01] Asset manifest as single source of truth, [D04] Use toml crate with serde, [D07] Dir entries use glob patterns, Risk R01, Spec S01, (#manifest-format, #s01-manifest-schema, #r01-manifest-drift)

**Artifacts:**
- `tugcode/crates/tugcast/build.rs` (replace hardcoded `fs::copy` calls with manifest-driven loop)

**Tasks:**
- [ ] Define `AssetManifest`, `DirEntry`, `BuildConfig` structs in `build.rs` (duplicated from `dev.rs` since build scripts cannot import crate code); add comment: "Keep in sync with dev.rs copy"
- [ ] Read and parse `tugdeck/assets.toml` at build time; panic with clear message if missing or malformed
- [ ] Loop over `[files]` entries: for each, `fs::copy(tugdeck_dir.join(src), tugdeck_out.join(url_key))`
- [ ] Loop over `[dirs]` entries: for each, iterate the source directory, filter by pattern, copy matching files to `tugdeck_out.join(prefix).join(filename)`
- [ ] Keep the existing `bun build` step for `app.js` (the JS bundle still requires compilation)
- [ ] **Emit `cargo:rerun-if-changed` for `tugdeck/assets.toml` AND all manifest-resolved source files and directories.** This is critical: the existing `build.rs` declares broad `rerun-if-changed` paths for `tugdeck/src/`, `tugdeck/index.html`, `tugdeck/styles/`, etc. The manifest-driven version must preserve this behavior — iterate `[files]` entries and emit `cargo:rerun-if-changed` for each source path, iterate `[dirs]` entries and emit `cargo:rerun-if-changed` for each source directory. Without this, production embeds become stale when CSS/HTML/font files change.
- [ ] Keep the existing `cargo:rerun-if-changed` entries for `tugdeck/src/`, `tugdeck/package.json`, `tugtalk/src/`, `tugtalk/package.json` (these cover JS source and tugtalk, not covered by the manifest)
- [ ] Remove all hardcoded `fs::copy` calls for `index.html`, CSS files, `xterm.css`, and font files
- [ ] Add `glob` to `[build-dependencies]` with explicit version pin (for glob pattern matching in `[dirs]` entries)
- [ ] Keep the tugtalk build section unchanged

**Tests:**
- [ ] Golden test: `cargo build -p tugcast` succeeds and `$OUT_DIR/tugdeck/` contains exactly the same files as before (index.html, app.js, app.css, tokens.css, cards.css, cards-chrome.css, dock.css, fonts/*.woff2)

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` passes (existing tests including `test_assets_index_exists`)
- [ ] Verify `$OUT_DIR/tugdeck/` contents match expectations (same files, same content)

**Rollback:**
- Revert `build.rs` to previous hardcoded version

**Commit after all checkpoints pass.**

---

#### Step 3: Update Mac app (ProcessManager and TugConfig) {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugapp): pass source tree directly to --dev and spawn bun build --watch`

**References:** [D03] CLI --dev flag takes source tree root, [D06] ProcessManager spawns bun build --watch, Risk R02, (#context, #strategy, #r02-bun-process)

**Artifacts:**
- `tugapp/Sources/ProcessManager.swift` (pass source tree directly as `--dev`, spawn `bun build --watch` process)
- `tugapp/Sources/TugConfig.swift` (remove `tugdeckDistRel` constant)

**Tasks:**
- [ ] In `TugConfig.swift`: remove `static let tugdeckDistRel = "tugdeck/dist"` line
- [ ] In `ProcessManager.swift`: change `start(devMode:sourceTree:)` to set `self.devPath = devMode ? sourceTree : nil` (remove the `tugdeckDistRel` path appending)
- [ ] In `ProcessManager.swift`: add `private var bunProcess: Process?` property
- [ ] In `ProcessManager.swift`: in `startProcess()`, after starting tugcast, if `devPath != nil`:
  - Use `ProcessManager.which("bun")` to resolve the bun binary path; if not found, log warning and skip (per Risk R02 mitigation)
  - Spawn `bun build src/main.ts --outfile=dist/app.js --watch` with cwd set to `{sourceTree}/tugdeck`
  - Set up `terminationHandler` or equivalent to log bun exit without crashing tugcast
- [ ] In `stop()`: terminate both `process` (tugcast) and `bunProcess` (bun)
- [ ] In `restart()`: stop both processes, restart both
- [ ] Handle bun process exit: log but do not crash (tugcast can still serve; JS just won't auto-rebuild)

**Tests:**
- [ ] Manual test: launch Tug.app with Developer Mode enabled, verify tugcast receives `--dev /path/to/tugtool` (not `--dev /path/to/tugtool/tugdeck/dist`)
- [ ] Manual test: verify `bun build --watch` process appears in Activity Monitor when dev mode is active
- [ ] Manual test: edit `tugdeck/src/main.ts`, verify `dist/app.js` is rebuilt and browser reloads

**Checkpoint:**
- [ ] Tug.app builds with `xcodebuild` (no Swift compiler errors)
- [ ] Tugcast starts successfully when launched from Tug.app in dev mode
- [ ] Bun watch process starts and stops with tugcast

**Rollback:**
- Revert `ProcessManager.swift` and `TugConfig.swift` changes

**Commit after all checkpoints pass.**

---

#### Step 4: Clean up TypeScript scripts and package.json {#step-4}

**Depends on:** #step-1

**Commit:** `chore(tugdeck): delete watch-assets.ts, simplify dev.ts and package.json`

**References:** [D01] Asset manifest as single source of truth, [D02] Dev mode serves source files directly, (#context, #strategy)

**Artifacts:**
- `tugdeck/scripts/watch-assets.ts` (delete)
- `tugdeck/scripts/dev.ts` (rewrite to just `bun build --watch`)
- `tugdeck/package.json` (remove `dev:assets` script, simplify `dev` script)

**Tasks:**
- [ ] Delete `tugdeck/scripts/watch-assets.ts`
- [ ] Rewrite `tugdeck/scripts/dev.ts` to a single line: spawn `bun build src/main.ts --outfile=dist/app.js --watch`
- [ ] In `tugdeck/package.json`: remove the `"dev:assets"` script entry
- [ ] In `tugdeck/package.json`: change `"dev"` script to `"bun build src/main.ts --outfile=dist/app.js --watch"`
- [ ] Verify no other scripts reference `watch-assets.ts`

**Tests:**
- [ ] Manual verification: `bun run dev` starts successfully and watches for changes

**Checkpoint:**
- [ ] `tugdeck/scripts/watch-assets.ts` does not exist
- [ ] `bun run dev` in `tugdeck/` starts `bun build --watch` successfully
- [ ] `bun run build` still works for production builds
- [ ] `bun test` passes

**Rollback:**
- Restore `watch-assets.ts` and `dev.ts` from git, revert `package.json`

**Commit after all checkpoints pass.**

---

#### Step 5: End-to-end validation and cleanup {#step-5}

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `test(tugcast): end-to-end validation of source-direct dev mode`

**References:** [D01] Asset manifest as single source of truth, [D02] Dev mode serves source files directly, [D03] CLI --dev flag takes source tree root, [D05] Warn at startup 404 at runtime, [D06] ProcessManager spawns bun build --watch, [D08] File watcher does not add .woff2 to extension filter, (#success-criteria, #dev-serving-behavior)

**Artifacts:**
- Any final cleanup (dead imports, unused dependencies, warnings)

**Tasks:**
- [ ] Full `cargo build` from clean state: verify no warnings
- [ ] Full `cargo nextest run`: verify all tests pass
- [ ] Run `tugcast --dev /path/to/tugtool` manually: verify CSS, HTML, fonts, and JS all serve correctly
- [ ] Edit `tugdeck/styles/tokens.css`: verify live reload fires within 500ms
- [ ] Edit `tugdeck/src/main.ts` with `bun build --watch` running: verify `app.js` rebuilds and reload fires
- [ ] Verify production build (`cargo build --release -p tugcast`) still embeds all assets correctly
- [ ] Verify `tower-http` is not in tugcast's `Cargo.toml` `[dependencies]` (removed in Step 1); confirm no unused dependency warnings
- [ ] Remove any dead code or unused imports flagged by `-D warnings`

**Tests:**
- [ ] Integration test: full request cycle through production-mode (rust-embed) server returns all expected assets
- [ ] Integration test: full request cycle through dev-mode server with test manifest returns all expected assets

**Checkpoint:**
- [ ] `cargo build -p tugcast` with no warnings
- [ ] `cargo nextest run -p tugcast` all pass
- [ ] Manual: edit CSS file -> reload fires -> browser shows change
- [ ] Manual: edit TS file -> bun rebuilds -> reload fires -> browser shows change
- [ ] `cargo build --release -p tugcast` succeeds

**Rollback:**
- Revert individual step changes as needed

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Dev mode serves source files directly from their edit locations via an asset manifest, with automatic hot reload for CSS, HTML, and JS. Font files are served directly from source but require manual refresh (per [D08]).

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugdeck/assets.toml` exists and is the single source of truth for asset mappings (verify: all three consumers read it)
- [ ] `watch-assets.ts` is deleted (verify: file does not exist)
- [ ] Editing any CSS file in `tugdeck/styles/` triggers live reload in the Mac app (verify: manual test)
- [ ] Editing `tugdeck/src/main.ts` triggers JS rebuild and live reload (verify: `bun build --watch` spawned by ProcessManager)
- [ ] `cargo build -p tugcast` succeeds with no warnings (verify: CI build)
- [ ] `cargo nextest run -p tugcast` passes all tests (verify: CI test)
- [ ] Production build embeds identical assets to pre-change behavior (verify: `test_assets_index_exists` and manual inspection)
- [ ] Adding a new CSS file requires editing only `tugdeck/assets.toml` (verify: add entry, confirm it serves)

**Acceptance tests:**
- [ ] Integration test: dev mode request cycle serves correct files via manifest
- [ ] Integration test: production mode (rust-embed) serves correct embedded files
- [ ] Unit test: manifest parsing produces correct `DevState`
- [ ] Unit test: three-tier lookup (files -> dirs -> fallback -> 404) works correctly

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] CSS Hot Module Replacement (HMR) without full page reload
- [ ] Manifest validation CLI command (`tugcast manifest check`)
- [ ] Source map support in dev mode for CSS debugging
- [ ] Watch `assets.toml` itself and hot-reload the manifest when it changes

| Checkpoint | Verification |
|------------|--------------|
| Asset manifest created (Step 0) | `tugdeck/assets.toml` exists with correct entries |
| Dev serving works (Step 1) | `tugcast --dev /path/to/repo` serves CSS from source |
| Build.rs reads manifest (Step 2) | `cargo build` succeeds, `$OUT_DIR/tugdeck/` correct |
| Mac app updated (Step 3) | Tug.app passes source tree, spawns bun watch |
| Scripts cleaned up (Step 4) | `watch-assets.ts` deleted, `dev.ts` simplified |
| End-to-end validation (Step 5) | Full manual test of hot reload workflow |

**Commit after all checkpoints pass.**
