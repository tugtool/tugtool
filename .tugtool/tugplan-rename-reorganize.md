## Phase 7.0: Rename and Reorganize into Mono-Repo {#phase-rename-reorganize}

**Purpose:** Transform the tugtool project into a clean mono-repo container with subdirectory projects (tugcode/, tugdeck/, tugplug/, tugtalk/) by executing five renames and two directory moves, staged so that no two things ever share a name at the same time.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-19 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugtool project has grown from a single Rust CLI into a multi-component system with a browser frontend (tugdeck), a Claude Code plugin (agents, skills, hooks), and a communication protocol (tugtalk). The current layout scatters these concerns across the project root, mixing Rust workspace files (Cargo.toml, crates/, tests/) with TypeScript files (tugdeck/), plugin infrastructure (.claude-plugin/, agents/, skills/, hooks/), and roadmap documents. Meanwhile, several naming legacy issues persist: the styling system still references `retronow` (an old project name), the UI layer uses `panel`/`floating-panel` when the correct terminology is `card`/`card-frame`, and the binary names are backwards (the CLI is called `tugtool` but should be `tugcode`; the launcher is called `tugcode` but should be `tugtool`).

This phase executes a comprehensive, carefully staged reorganization that resolves all naming debts and establishes the mono-repo structure. The staging is critical because two binary names must swap, requiring a temporary intermediate name (`tug-launch`) to ensure no two things share a name at any point during the process.

#### Strategy {#strategy}

- Execute seven steps in strict order, each producing a self-contained commit with verification before proceeding
- Start with CSS-only renames (Step 1: retronow to tuglook) as the lowest-risk change
- Follow with the largest rename by line count (Step 2: panel to card) while still in the tugdeck domain
- Move plugin files and change namespace (Step 3) before touching Rust binary names
- Execute the three-step binary name swap (Steps 4, 5, 6a) in exact order: free tugcode, claim tugcode for CLI, claim tugtool for launcher
- Finish by moving the entire Rust workspace into tugcode/ (Step 6b) to create the final mono-repo layout
- Update CI/CD workflows in the same commit as the structural change that breaks them (no separate CI-fix commits needed)
- At each step, run grep verification and behavior-based checks (--help) to confirm old names are gone before proceeding

#### Stakeholders / Primary Customers {#stakeholders}

1. Project maintainer (kocienda) -- needs clean mono-repo layout for ongoing development
2. Claude Code plugin users -- skill invocations change from `tugtool:` to `tugplug:` namespace

#### Success Criteria (Measurable) {#success-criteria}

- Zero occurrences of `--rn-` or `retronow` in CSS files after Step 1 (verified by grep)
- Zero occurrences of `PanelManager`, `FloatingPanel`, `PanelState`, `floating-panel` in TS/CSS after Step 2 (verified by grep)
- Plugin loads correctly from `tugplug/` directory with `tugplug:` namespace after Step 3
- `cargo build` succeeds after each of Steps 4, 5, 6a, and 6b
- `bun test` in tugdeck passes after Steps 1 and 2
- Final mono-repo layout matches the target structure in the proposal (#target-layout)

#### Scope {#scope}

1. Rename `--rn-*` CSS custom properties to `--tl-*` and `retronow` references to `tuglook`
2. Rename panel/floating-panel terminology to card/card-frame throughout tugdeck
3. Move plugin files to `tugplug/` and change namespace from `tugtool:` to `tugplug:`
4. Execute three-step binary name swap: tugcode(launcher) to tug-launch to tugtool; tugtool(CLI) to tugcode
5. Move Rust workspace into `tugcode/` subdirectory
6. Split CLAUDE.md into root (project conventions) and tugplug/CLAUDE.md (plugin operations)
7. Update .gitignore, all path references, and build commands
8. Update CI/CD workflows (ci.yml, release.yml) to work with new directory structure and binary names
9. Update release packaging to use `share/tugplug/` for plugin assets

#### Non-goals (Explicitly out of scope) {#non-goals}

- Renaming `--td-*` semantic tokens (td = tugdeck, already correct)
- Renaming `.tugtool/` directory (tugplan infrastructure, not the plugin)
- Renaming `tugtool-core` crate (library crate named after the project, not the binary)
- Rewriting historical tugplan files or archive content
- Renaming the git repository or project root directory
- Renaming card content classes (`.files-card`, `.conversation-card`, etc. -- already correct)
- Renaming roadmap/tugplan references to old names (design records, not live code)

#### Dependencies / Prerequisites {#dependencies}

- Clean git working tree (user confirmed: already committed, repo clean)
- `bun` installed for tugdeck tests
- `cargo` and `cargo-nextest` installed for Rust builds and tests

#### Constraints {#constraints}

- At no point during execution may two things share the same name
- Each step must produce a passing build/test before the next step begins
- Binary name swap (Steps 4-5-6a) must execute in exact order
- Historical files must not be modified

#### Assumptions {#assumptions}

- Each step will be a separate git commit with verification before proceeding
- The binary name swap (Steps 4-6a) must happen in exact order to avoid conflicts
- All grep verification commands will use exact patterns from the proposal
- tugdeck and tugtalk remain at root level (already subdirectories)
- After Step 6b, root .gitignore updated to point to `tugcode/target/`
- Plugin invocation changes from `claude --plugin-dir .` to `claude --plugin-dir tugplug`
- tugtool-core crate name remains unchanged
- Step 2 requires updating tugdeck/index.html to reference `cards-chrome.css` instead of `panels.css`
- CLAUDE.md split done based on logical separation (project conventions vs plugin operations)
- Old serialization data (v4) will be discarded; version bumps to v5 with fallback to `buildDefaultLayout()`
- After Step 6b, all cargo commands use `cd tugcode && cargo <command>` pattern
- CI green on every intermediate step is not required; CI fixes land in the same commit as the structural change
- Release packaging changes from `share/tugtool/` to `share/tugplug/` for plugin assets

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Binary name collision during swap | high | low | Strict three-step staging with grep verification after each step | Any grep finds unexpected hits |
| CSS rename misses an occurrence | med | low | Exhaustive grep verification + bun test | Styling breaks after rename |
| Plugin fails to load from new path | med | low | Test with `claude --plugin-dir tugplug` after Step 3 | Plugin skill invocation fails |
| Serialization version bump breaks state | low | low | Discard-and-rebuild strategy (same as v3-to-v4 migration) | N/A -- by design |
| CI/CD workflows broken by directory moves | high | high | Update workflows in same commit as structural change | CI fails on push |

**Risk R01: Binary name collision during swap** {#r01-name-collision}

- **Risk:** If steps 4, 5, and 6a are executed out of order, two binaries could share the same name, causing cargo build failures or runtime confusion
- **Mitigation:**
  - Each step has explicit grep verification confirming the freed name has zero hits
  - Steps 4, 5, 6a must be committed in exact order with no reordering
- **Residual risk:** None if ordering is followed; the temporary `tug-launch` name eliminates the cycle

**Risk R02: Missed rename occurrence** {#r02-missed-rename}

- **Risk:** A grep pattern might miss an occurrence of an old name in an unusual context (e.g., string interpolation, multiline comment)
- **Mitigation:**
  - Grep patterns cover all relevant file extensions (*.ts, *.css, *.rs, *.toml, *.md, *.json, *.sh)
  - Build and test commands catch runtime breakage
- **Residual risk:** Comments or documentation may retain old names in historical context, which is acceptable

---

### Open Questions {#open-questions}

No open questions. All decisions have been made based on the proposal and user answers.

---

### 7.0.0 Design Decisions {#design-decisions}

#### [D01] Three-step binary name swap with temporary name (DECIDED) {#d01-three-step-swap}

**Decision:** Use a temporary name `tug-launch` as a waypoint to swap the `tugcode` and `tugtool` binary names without collision.

**Rationale:**
- Two binaries need to swap names: tugcode(launcher) becomes tugtool, tugtool(CLI) becomes tugcode
- Direct swap is impossible -- both names are occupied simultaneously
- A temporary third name breaks the cycle cleanly

**Implications:**
- Step 4 renames launcher to tug-launch (freeing tugcode)
- Step 5 renames CLI to tugcode (freeing tugtool as binary name)
- Step 6a renames tug-launch to tugtool (freeing tug-launch)
- tug-launch exists only transiently across 2 commits

#### [D02] Discard-and-rebuild for serialization version bump (DECIDED) {#d02-serialization-discard}

**Decision:** Bump serialization version from v4 to v5 and let `deserialize()` fall back to `buildDefaultLayout()` for old data, rather than implementing migration logic.

**Rationale:**
- Same pattern used for v3 to v4 migration
- Layout state is easily reconstructible; no user data is lost
- Migration code adds complexity with no lasting value

**Implications:**
- Users will see their card layout reset to defaults on first load after Step 2
- No migration code needs to be written or maintained

#### [D03] CLAUDE.md split by concern (DECIDED) {#d03-claude-md-split}

**Decision:** Split the root CLAUDE.md into two files: root CLAUDE.md for project conventions and tugplug/CLAUDE.md for plugin operations.

**Rationale:**
- Current CLAUDE.md mixes project-wide concerns (build policy, crate structure) with plugin-specific concerns (skill invocation, agent architecture)
- After the plugin moves to tugplug/, only plugin-relevant content should be there
- Both files are loaded by Claude Code when using `--plugin-dir tugplug`

**Implications:**
- Root CLAUDE.md: crate structure, build policy, testing, common CLI commands, error codes, git policy
- tugplug/CLAUDE.md: skill descriptions, agent contracts, worktree workflow, beads policy, plan mode policy

#### [D04] CSS file renamed to cards-chrome.css, not cards.css (DECIDED) {#d04-cards-chrome-name}

**Decision:** Rename `panels.css` to `cards-chrome.css` rather than `cards.css`.

**Rationale:**
- `cards.css` already exists and contains card *content* styles (`.files-card`, `.conversation-card`, etc.)
- `cards-chrome.css` accurately describes the file's purpose: styling card chrome (title bars, tabs, resize handles, snap guides, sashes)

**Implications:**
- `tugdeck/index.html` must reference `cards-chrome.css` instead of `panels.css`
- Import comments and any CSS references must use the new name

#### [D05] Plugin namespace uses tugplug: prefix (DECIDED) {#d05-tugplug-namespace}

**Decision:** The plugin namespace changes from `tugtool:` to `tugplug:` in plugin.json, skill references, and hook patterns.

**Rationale:**
- The plugin directory moves to `tugplug/`, so the namespace should match
- `tugplug` is a dedicated name for the Claude Code plugin component
- Agent frontmatter `name:` fields do not include namespace prefix (unchanged)

**Implications:**
- All skill invocations become `/tugplug:plan`, `/tugplug:implement`, `/tugplug:merge`
- Hook patterns change from `tugtool:*` to `tugplug:*`
- Plugin invocation changes to `claude --plugin-dir tugplug`

#### [D06] Move Rust workspace into tugcode/ subdirectory (DECIDED) {#d06-rust-workspace-move}

**Decision:** Move all Rust workspace infrastructure (Cargo.toml, Cargo.lock, .cargo/, crates/, tests/, etc.) into a `tugcode/` subdirectory.

**Rationale:**
- Establishes clean mono-repo layout with each subdirectory owning its domain
- Root directory becomes a container rather than a Rust project
- Matches the organizational pattern of tugdeck/, tugplug/, tugtalk/

**Implications:**
- All cargo commands must use `cd tugcode && cargo <command>` pattern
- .gitignore changes from `/target/` to `/tugcode/target/`
- CLAUDE.md crate structure paths update to `tugcode/crates/`

#### [D07] Historical files left untouched (DECIDED) {#d07-historical-files}

**Decision:** Do not modify historical tugplan files, implementation logs, or archived documents that reference old names.

**Rationale:**
- Historical records should reflect what was true at the time they were written
- Rewriting history creates confusion about what actually happened
- Old names in archived plans do not affect live code

**Implications:**
- `.tugtool/tugplan-retronow-style-system.md` retains `retronow` references
- `.tugtool/tugplan-implementation-log.md` retains old references
- `.tugtool/tugplan-panel-system.md` and similar retain `panel` references

#### [D08] Update build.rs when renaming panels.css (DECIDED) {#d08-build-rs-panels-css}

**Decision:** The `crates/tugcast/build.rs` file must be updated in the same step that renames `panels.css` to `cards-chrome.css`, because build.rs copies CSS files by exact filename for rust-embed asset serving.

**Rationale:**
- `build.rs` lines 79-82 hardcode `styles/panels.css` as the source path and `panels.css` as the output filename
- If the CSS file is renamed without updating build.rs, `cargo build` will fail immediately because the source file no longer exists
- This is a cross-domain dependency (tugdeck CSS rename affects Rust build)

**Implications:**
- Step 1 (panel-to-card rename) must include a build.rs task, not just tugdeck files
- The `cargo build` checkpoint in Step 1 catches this if missed

#### [D09] Update build.rs relative paths after workspace move (DECIDED) {#d09-build-rs-repo-root}

**Decision:** When moving the Rust workspace into `tugcode/`, the `crates/tugcast/build.rs` relative path resolution must be updated to account for the additional directory level.

**Rationale:**
- build.rs line 13 uses `manifest_dir.parent().unwrap().parent().unwrap()` to find repo root (2 levels: `crates/tugcast/` up to workspace root)
- After the move, crate is at `tugcode/crates/tugcast/` which is 3 levels from repo root
- The `rerun-if-changed` paths (lines 150-155) use `../../tugdeck/` and `../../tugtalk/` which will also be wrong after the move
- Without this fix, `cargo build` will fail because it cannot find tugdeck/ and tugtalk/

**Implications:**
- Step 6 must add `.parent().unwrap()` to the repo root resolution (3 levels instead of 2)
- Step 6 must update all `rerun-if-changed` paths from `../../` to `../../../`

#### [D10] CI/CD workflow updates are mandatory, not follow-on (DECIDED) {#d10-ci-cd-mandatory}

**Decision:** Updates to `.github/workflows/ci.yml` and `.github/workflows/release.yml` are mandatory tasks within the steps that break them, not optional follow-ons.

**Rationale:**
- `ci.yml` runs `cargo build` and `cargo test` from the repo root; after Step 6 moves the Rust workspace to `tugcode/`, these commands fail
- `release.yml` copies skills from `skills/plan/SKILL.md` and agents from `agents/*.md`; after Step 2 moves these to `tugplug/`, the release job fails
- `release.yml` runs `./scripts/update-homebrew-formula.sh` and `git add Formula/tugtool.rb` from root; after Step 6, these paths are wrong
- CI/CD breakage is a structural failure, not a cosmetic issue

**Implications:**
- Step 2 must update `release.yml` plugin asset paths (skills, agents) from root to `tugplug/`
- Step 6 must update `ci.yml` cargo commands to work from `tugcode/` and update `release.yml` for moved scripts/Formula paths
- User confirmed intermediate CI green is not required, so CI fixes land in the same commit as the structural change

#### [D11] Release packaging uses share/tugplug/ for plugin assets (DECIDED) {#d11-release-packaging}

**Decision:** Release tarballs package plugin assets (skills, agents) under `share/tugplug/` instead of `share/tugtool/`.

**Rationale:**
- The plugin is now called `tugplug` and lives in `tugplug/`
- The Homebrew formula install paths should match: `share/"tugplug"`
- Consistent naming across the distribution

**Implications:**
- `release.yml` directory structure changes from `release/share/tugtool/` to `release/share/tugplug/`
- `Formula/tugtool.rb` install paths change from `share/"tugtool"` to `share/"tugplug"`
- Homebrew caveats text updates to reference `share/tugplug/`

---

### 7.0.1 Execution Order Reference {#execution-order}

**Table T01: Execution Order (Meticulous Staging)** {#t01-execution-order}

| Step | What | Names freed | Names claimed | Verify |
|------|------|-------------|---------------|--------|
| 1 | retronow to tuglook | `retronow`, `--rn-` | `tuglook`, `--tl-` | `bun test` |
| 2 | panel to card | `panel`, `floating-panel` | `card`, `card-frame` | `bun test` |
| 3 | Plugin to tugplug + move | `tugtool:` (namespace) | `tugplug:` (namespace) | plugin loads |
| 4 | Launcher: tugcode to tug-launch | `tugcode` (freed!) | `tug-launch` (temp) | `cargo build` |
| 5 | CLI: tugtool to tugcode | `tugtool` (freed as binary) | `tugcode` (reused!) | `cargo build` |
| 6a | Launcher: tug-launch to tugtool | `tug-launch` (freed) | `tugtool` (reused!) | `cargo build` |
| 6b | Move Rust into tugcode/ | root `Cargo.toml` | `tugcode/Cargo.toml` | `cargo build` from `tugcode/` |

**Key constraint:** At no point do two things share a name. Each step removes a name, verifies it is gone, then the next step reuses it.

---

### 7.0.2 File Inventory by Step {#file-inventory}

**Table T02: Step 1 Files (retronow to tuglook)** {#t02-step1-files}

| File | Occurrences | What changes |
|------|-------------|-------------|
| `tugdeck/styles/tokens.css` | ~177 `--rn-` refs | All `--rn-` declarations/refs to `--tl-`; `retronow`/`Retronow` in comments to `tuglook`/`Tuglook` |
| `tugdeck/styles/panels.css` | 1 `--rn-` ref | `--rn-line-ui` to `--tl-line-ui`; header comment update |
| `tugdeck/styles/cards.css` | 0 `--rn-` refs | Header comment: "Retronow design language" to "Tuglook design language" |
| `tugdeck/styles/dock.css` | 0 `--rn-` refs | Header comment: "Retronow design language" to "Tuglook design language" |
| `roadmap/retronow-style-system-redesign.txt` | Many | Rename file to `tuglook-style-system-redesign.txt`; update content |

**Table T03: Step 2 Naming Map (panel to card)** {#t03-step2-naming}

| Current name | New name | Scope |
|-------------|----------|-------|
| `PanelManager` | `DeckManager` | Class name |
| `FloatingPanel` | `CardFrame` | Class name |
| `PanelState` | `CardState` | Type name |
| `CanvasState` | `DeckState` | Type name |
| `PanelSet` | `CardSet` | Type name |
| `keyPanelId` | `keyCardId` | Property |
| `focusPanel()` | `focusCard()` | Method |
| `FLOATING_TITLE_BAR_HEIGHT` | `CARD_TITLE_BAR_HEIGHT` | Constant |
| `FloatingPanelCallbacks` | `CardFrameCallbacks` | Interface |
| `makePanelState` | `makeCardState` | Function |
| `panelToRect` | `cardToRect` | Function |
| `panelAId`/`panelBId` | `cardAId`/`cardBId` | Properties |
| `panelIds` | `cardIds` | Property |

**Table T04: Step 2 File Renames** {#t04-step2-file-renames}

| Current path | New path |
|-------------|----------|
| `tugdeck/src/floating-panel.ts` | `tugdeck/src/card-frame.ts` |
| `tugdeck/src/panel-manager.ts` | `tugdeck/src/deck-manager.ts` |
| `tugdeck/src/__tests__/floating-panel.test.ts` | `tugdeck/src/__tests__/card-frame.test.ts` |
| `tugdeck/src/__tests__/panel-manager.test.ts` | `tugdeck/src/__tests__/deck-manager.test.ts` |
| `tugdeck/styles/panels.css` | `tugdeck/styles/cards-chrome.css` |

**Table T05: Step 2 CSS Class Renames** {#t05-step2-css-classes}

| Current class | New class |
|--------------|-----------|
| `.panel-root` | `.deck-root` |
| `.panel-card-container` | `.card-container` |
| `.panel-card-area` | `.card-area` |
| `.panel-card-mount` | `.card-mount` |
| `.panel-tab-bar` | `.card-tab-bar` |
| `.panel-tab` | `.card-tab` |
| `.panel-tab-active` | `.card-tab-active` |
| `.panel-tab-close` | `.card-tab-close` |
| `.panel-tab.dragging` | `.card-tab.dragging` |
| `.floating-panel` | `.card-frame` |
| `.floating-panel-content` | `.card-frame-content` |
| `.floating-panel-resize` | `.card-frame-resize` |
| `.floating-panel-resize-{n,s,e,w,nw,ne,sw,se}` | `.card-frame-resize-{...}` |
| `.panel-header` | `.card-header` |
| `.panel-header-key` | `.card-header-key` |
| `.panel-header-icon` | `.card-header-icon` |
| `.panel-header-title` | `.card-header-title` |
| `.panel-header-spacer` | `.card-header-spacer` |
| `.panel-header-btn` | `.card-header-btn` |

**Table T06: Step 2 CSS Token Renames** {#t06-step2-css-tokens}

| Current token | New token |
|--------------|-----------|
| `--td-panel` | `--td-card` |
| `--td-panel-soft` | `--td-card-soft` |
| `--td-titlebar-active` | `--td-header-active` |
| `--td-titlebar-inactive` | `--td-header-inactive` |

**Table T07: Step 3 Namespace Changes** {#t07-step3-namespace}

| File (after move to tugplug/) | What changes |
|------|-------------|
| `tugplug/.claude-plugin/plugin.json` | `"name": "tugtool"` to `"name": "tugplug"` |
| `tugplug/hooks/auto-approve-tug.sh` | `tugtool:*` pattern to `tugplug:*` |
| `tugplug/hooks/ensure-init.sh` | `tugtool:*` pattern to `tugplug:*` |
| `tugplug/skills/plan/SKILL.md` | `/tugtool:plan` refs to `/tugplug:plan` |
| `tugplug/skills/implement/SKILL.md` | `/tugtool:implement` refs to `/tugplug:implement` |
| `tugplug/skills/merge/SKILL.md` | `/tugtool:merge` refs to `/tugplug:merge` |
| Root `CLAUDE.md` | All `/tugtool:*` skill refs to `/tugplug:*` |

**Table T08: Step 6b Directory Move** {#t08-step6b-move}

| From (project root) | To (tugcode/) |
|---------------------|---------------|
| `Cargo.toml` | `tugcode/Cargo.toml` |
| `Cargo.lock` | `tugcode/Cargo.lock` |
| `.cargo/config.toml` | `tugcode/.cargo/config.toml` |
| `clippy.toml` | `tugcode/clippy.toml` |
| `rust-toolchain.toml` | `tugcode/rust-toolchain.toml` |
| `Justfile` | `tugcode/Justfile` |
| `crates/` | `tugcode/crates/` |
| `tests/` | `tugcode/tests/` |
| `Formula/` | `tugcode/Formula/` |
| `scripts/` | `tugcode/scripts/` |

**Table T09: Step 2 Complete TS/Test File Inventory** {#t09-step2-all-ts-files}

| File | Change category | Key symbols affected |
|------|----------------|---------------------|
| `tugdeck/src/card-frame.ts` (was `floating-panel.ts`) | Heavy | `FloatingPanel` to `CardFrame`, `FloatingPanelCallbacks` to `CardFrameCallbacks`, `FLOATING_TITLE_BAR_HEIGHT` to `CARD_TITLE_BAR_HEIGHT`, `.floating-panel*` and `.panel-header*` CSS strings |
| `tugdeck/src/deck-manager.ts` (was `panel-manager.ts`) | Heavy | `PanelManager` to `DeckManager`, `PanelState`/`CanvasState`/`FloatingPanel`, `keyPanelId`, `focusPanel`, `.panel-*` and `.floating-panel` CSS strings |
| `tugdeck/src/layout-tree.ts` | Heavy | `PanelState` to `CardState`, `CanvasState` to `DeckState`, field `panels` to `cards` |
| `tugdeck/src/serialization.ts` | Heavy | `PanelState`/`CanvasState`, `makePanelState` to `makeCardState`, `panels` key to `cards`, version 4 to 5 |
| `tugdeck/src/snap.ts` | Heavy | `PanelState`/`PanelSet`, `panelToRect` to `cardToRect`, `panelAId`/`panelBId` to `cardAId`/`cardBId`, `panelIds` to `cardIds` |
| `tugdeck/src/tab-bar.ts` | Medium | `.panel-tab*` CSS class strings (~6+ occurrences) |
| `tugdeck/src/card-header.ts` | Medium | `.panel-header*` CSS class strings (~8 occurrences) |
| `tugdeck/src/main.ts` | Light | Import path, `PanelManager` to `DeckManager` |
| `tugdeck/src/dock.ts` | Light | Import path, `panelManager` to `deckManager`, `PanelManager` to `DeckManager` |
| `tugdeck/src/drag-state.ts` | Light | `PanelManager` comment reference |
| `tugdeck/src/card-menu.ts` | Light | `panel` comment reference |
| `tugdeck/src/__tests__/card-frame.test.ts` (was `floating-panel.test.ts`) | Heavy | `FloatingPanel` to `CardFrame`, `.floating-panel*` and `.panel-header*` selectors |
| `tugdeck/src/__tests__/deck-manager.test.ts` (was `panel-manager.test.ts`) | Heavy | `PanelManager` to `DeckManager`, `.floating-panel` and `.panel-*` selectors, `makePanelState` |
| `tugdeck/src/__tests__/layout-tree.test.ts` | Heavy | `PanelState` to `CardState`, `CanvasState` to `DeckState`, `panels` to `cards` (~76 occurrences) |
| `tugdeck/src/__tests__/dock.test.ts` | Medium | `.floating-panel` and `.panel-header` selectors |
| `tugdeck/src/__tests__/snap.test.ts` | Medium | `PanelSet`, `panelAId`/`panelBId`, `panelIds` |
| `tugdeck/src/__tests__/tab-bar.test.ts` | Medium | `.panel-tab*` CSS selector strings |
| `tugdeck/src/__tests__/card-header.test.ts` | Medium | `.panel-header*` CSS selector strings |
| `tugdeck/src/cards/conversation-card.test.ts` | Light | Comment referencing "panel manager owns focus" |

**Table T10: Step 5 Formula and Script Files** {#t10-step5-formula-scripts}

| File | Key changes |
|------|-------------|
| `Formula/tugtool.rb` | Class name `Tugtool` stays (project name); update `bin.install "bin/tugtool"` to `bin.install "bin/tugcode"`; update `share/"tugtool"` paths (already done in Step 2); rewrite caveats to remove ghost `setup` subcommand and point to `claude --plugin-dir tugplug` usage; update test commands `tugtool` to `tugcode` |
| `scripts/release.sh` | Update `Cargo.toml` path references (already relative); update comments referencing `tugtool` CLI |
| `scripts/update-homebrew-formula.sh` | Update `FORMULA_PATH` if Formula dir gets renamed; update comments |

**Table T11: CI/CD Workflow Updates** {#t11-ci-cd-workflows}

| File | Step | What changes |
|------|------|-------------|
| `.github/workflows/release.yml` | 2 | Lines 54-57: `share/tugtool/` to `share/tugplug/` (skills and agents directories); lines 63-68: `skills/plan/SKILL.md` etc. to `tugplug/skills/plan/SKILL.md`; line 68: `agents/*.md` to `tugplug/agents/*.md` |
| `.github/workflows/release.yml` | 4 | Line 48: `strip target/.../release/tugtool` to `strip target/.../release/tugcode`; line 60: `cp .../release/tugtool` to `cp .../release/tugcode` |
| `.github/workflows/release.yml` | 6 | Line 47: add `working-directory: tugcode` (covers both cargo build and strip, which share the same `run:` block); line 60: `cp target/...` to `cp tugcode/target/...` (cp runs from repo root in a separate step without working-directory); lines 167-174: `./scripts/update-homebrew-formula.sh` to `./tugcode/scripts/update-homebrew-formula.sh`, `git add Formula/tugtool.rb` to `git add tugcode/Formula/tugtool.rb` |
| `.github/workflows/ci.yml` | 6 | Lines 47-50: add `working-directory: tugcode` to Build and Run tests steps (or prefix commands with `cd tugcode &&`); line 63: add `working-directory: tugcode` to Check formatting; lines 90-91: add `working-directory: tugcode` to Run clippy; line 29: cache target path to `tugcode/target` |
| `Formula/tugtool.rb` | 2+4 | Step 2: `share/"tugtool"` to `share/"tugplug"`, caveats paths; Step 4: `bin.install` and test commands |

---

### 7.0.5 Execution Steps {#execution-steps}

#### Step 0: retronow to tuglook (CSS-only rename) {#step-0}

**Commit:** `refactor(tugdeck): rename retronow/--rn-* to tuglook/--tl-* in style system`

**References:** [D07] Historical files left untouched, Table T02 (#t02-step1-files), (#execution-order, #non-goals)

**Artifacts:**
- Updated `tugdeck/styles/tokens.css` with all `--rn-` replaced by `--tl-`
- Updated `tugdeck/styles/panels.css` with `--rn-line-ui` replaced by `--tl-line-ui`
- Updated header comments in `tugdeck/styles/cards.css` and `tugdeck/styles/dock.css`
- Renamed `roadmap/retronow-style-system-redesign.txt` to `roadmap/tuglook-style-system-redesign.txt`

**Tasks:**
- [ ] In `tugdeck/styles/tokens.css`: find-replace `--rn-` to `--tl-` (~177 occurrences)
- [ ] In `tugdeck/styles/tokens.css`: find-replace `retronow` to `tuglook` and `Retronow` to `Tuglook` in comments (case-preserving)
- [ ] In `tugdeck/styles/tokens.css`: update `rn-theme-brio` to `tl-theme-brio` in source-of-truth comment references
- [ ] In `tugdeck/styles/panels.css`: replace `--rn-line-ui` with `--tl-line-ui` (1 occurrence)
- [ ] In `tugdeck/styles/panels.css`: update header comment from retronow to tuglook
- [ ] In `tugdeck/styles/cards.css`: update header comment "Retronow design language" to "Tuglook design language"
- [ ] In `tugdeck/styles/dock.css`: update header comment "Retronow design language" to "Tuglook design language"
- [ ] Rename file `roadmap/retronow-style-system-redesign.txt` to `roadmap/tuglook-style-system-redesign.txt` and update content references

**Tests:**
- [ ] Integration test: `cd tugdeck && bun test` passes
- [ ] Integration test: `cd tugdeck && bun run build` passes

**Checkpoint:**
- [ ] `grep -r "\-\-rn-" --include='*.css' tugdeck/` returns 0 hits
- [ ] `grep -ri "retronow" --include='*.css' tugdeck/` returns 0 hits
- [ ] `cd tugdeck && bun test && bun run build` passes

**Rollback:**
- Revert commit; all changes are mechanical find-replace

**Commit after all checkpoints pass.**

---

#### Step 1: panel/floating-panel to card/card-frame (tugdeck terminology) {#step-1}

**Depends on:** #step-0

**Commit:** `refactor(tugdeck): rename panel/floating-panel to card/card-frame terminology`

**References:** [D02] Serialization discard-and-rebuild, [D04] CSS file renamed to cards-chrome.css, [D08] Update build.rs for panels.css rename, Tables T03-T06 (#t03-step2-naming, #t04-step2-file-renames, #t05-step2-css-classes, #t06-step2-css-tokens), Table T09 (#t09-step2-all-ts-files), (#non-goals)

**Artifacts:**
- Renamed source files per Table T04
- Updated all type names, class names, and CSS classes per Tables T03, T05, T06
- Updated `tugdeck/index.html` to reference `cards-chrome.css`
- Updated `crates/tugcast/build.rs` to copy `cards-chrome.css` instead of `panels.css` (and emit `cards-chrome.css` output filename)
- Bumped serialization version from v4 to v5
- Updated TS files with heavy changes: `card-frame.ts`, `deck-manager.ts`, `layout-tree.ts`, `serialization.ts`, `snap.ts`, `tab-bar.ts`, `card-header.ts`
- Updated TS files with light changes: `main.ts`, `dock.ts`, `drag-state.ts`, `card-menu.ts`
- Updated test files: `card-frame.test.ts`, `deck-manager.test.ts`, `layout-tree.test.ts`, `dock.test.ts`, `snap.test.ts`, `tab-bar.test.ts`, `card-header.test.ts`

**Tasks:**
- [ ] Rename `tugdeck/src/floating-panel.ts` to `tugdeck/src/card-frame.ts`
- [ ] Rename `tugdeck/src/panel-manager.ts` to `tugdeck/src/deck-manager.ts`
- [ ] Rename `tugdeck/src/__tests__/floating-panel.test.ts` to `tugdeck/src/__tests__/card-frame.test.ts`
- [ ] Rename `tugdeck/src/__tests__/panel-manager.test.ts` to `tugdeck/src/__tests__/deck-manager.test.ts`
- [ ] Rename `tugdeck/styles/panels.css` to `tugdeck/styles/cards-chrome.css`
- [ ] In `tugdeck/index.html`: change `panels.css` link to `cards-chrome.css`
- [ ] In `crates/tugcast/build.rs` (lines 79-82): change `styles/panels.css` to `styles/cards-chrome.css` and output filename from `panels.css` to `cards-chrome.css` -- build-critical, without this `cargo build` fails after the CSS file rename
- [ ] In `tugdeck/src/card-frame.ts` (was `floating-panel.ts`): rename class `FloatingPanel` to `CardFrame`, interface `FloatingPanelCallbacks` to `CardFrameCallbacks`, constant `FLOATING_TITLE_BAR_HEIGHT` to `CARD_TITLE_BAR_HEIGHT`, all `.floating-panel*` and `.panel-header*` CSS class strings
- [ ] In `tugdeck/src/deck-manager.ts` (was `panel-manager.ts`): rename class `PanelManager` to `DeckManager`, types `PanelState`/`CanvasState`/`FloatingPanel` to `CardState`/`DeckState`/`CardFrame`, `keyPanelId` to `keyCardId`, `focusPanel` to `focusCard`, all `.panel-*` and `.floating-panel` CSS class strings, update import path
- [ ] In `tugdeck/src/layout-tree.ts`: rename field `panels` to `cards`, update `PanelState` to `CardState`, `CanvasState` to `DeckState`
- [ ] In `tugdeck/src/__tests__/layout-tree.test.ts`: rename all `PanelState` to `CardState`, `CanvasState` to `DeckState`, `panels` to `cards` (~76 occurrences); update imports from `layout-tree.ts`
- [ ] In `tugdeck/src/serialization.ts`: bump version from 4 to 5, rename `panels` key to `cards`, rename `makePanelState` to `makeCardState`, update all type references
- [ ] In `tugdeck/src/snap.ts`: rename `PanelState` to `CardState`, `PanelSet` to `CardSet`, `panelToRect` to `cardToRect`, `panelAId`/`panelBId` to `cardAId`/`cardBId`, `panelIds` to `cardIds`
- [ ] In `tugdeck/src/tab-bar.ts`: update all `.panel-tab*` CSS class strings (~6+ occurrences)
- [ ] In `tugdeck/src/card-header.ts`: update all `.panel-header*` CSS class strings (~8 occurrences)
- [ ] In `tugdeck/src/dock.ts`: update import path `./panel-manager` to `./deck-manager`, rename `panelManager` property to `deckManager`, `PanelManager` to `DeckManager`, update about string
- [ ] In `tugdeck/src/main.ts`: update import path and `PanelManager` to `DeckManager`
- [ ] In `tugdeck/src/drag-state.ts`: update `PanelManager` comment reference
- [ ] In `tugdeck/src/card-menu.ts`: update `panel` comment reference
- [ ] In `tugdeck/src/__tests__/card-frame.test.ts` (was `floating-panel.test.ts`): rename all `FloatingPanel` to `CardFrame`, `.floating-panel*` and `.panel-header*` selectors, `PanelState` to `CardState`
- [ ] In `tugdeck/src/__tests__/deck-manager.test.ts` (was `panel-manager.test.ts`): rename all `PanelManager` to `DeckManager`, `.floating-panel` and `.panel-*` selectors, `makePanelState` to `makeCardState`
- [ ] In `tugdeck/src/__tests__/dock.test.ts`: update `.floating-panel` and `.panel-header` selectors
- [ ] In `tugdeck/src/__tests__/snap.test.ts`: update `PanelSet` to `CardSet`, `panelAId`/`panelBId` to `cardAId`/`cardBId`, `panelIds` to `cardIds`
- [ ] In `tugdeck/src/__tests__/tab-bar.test.ts`: update `.panel-tab*` CSS selector strings
- [ ] In `tugdeck/src/__tests__/card-header.test.ts`: update `.panel-header*` CSS selector strings
- [ ] In `tugdeck/src/cards/conversation-card.test.ts`: update comment referencing "panel manager owns focus"
- [ ] In `cards-chrome.css` (was `panels.css`): rename all CSS classes per Table T05
- [ ] In `tugdeck/styles/tokens.css`: rename CSS tokens per Table T06 (~12 lines across 3 themes); also update Tier 3 comment (line 7) from `--td-panel-*` to `--td-card-*` to match the renamed tokens
- [ ] In `cards-chrome.css` and `cards.css`: update consumption of renamed tokens
- [ ] Update legacy alias `--card: var(--td-panel)` to `--card: var(--td-card)` in tokens.css

**Tests:**
- [ ] Integration test: `cd tugdeck && bun test` passes
- [ ] Integration test: `cd tugdeck && bun run build` passes
- [ ] Integration test: `cargo build` passes (verifies build.rs update)

**Checkpoint:**
- [ ] `grep -r "floating-panel\|PanelManager\|PanelState\|FloatingPanel\|panel-header\|panel-tab\|panel-root\|PanelSet\|panelToRect\|panelAId\|panelBId" --include='*.ts' --include='*.css' tugdeck/` returns 0 hits
- [ ] `grep -r "panels\.css" --include='*.rs' --include='*.html' .` returns 0 hits (verifies build.rs and index.html updated)
- [ ] `cd tugdeck && bun test && bun run build` passes
- [ ] `cargo build` passes (critical: verifies build.rs copies cards-chrome.css)

**Rollback:**
- Revert commit; file renames are tracked by git

**Commit after all checkpoints pass.**

---

#### Step 2: Plugin namespace tugtool to tugplug + move to tugplug/ {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: move plugin to tugplug/ and rename namespace tugtool: to tugplug:`

**References:** [D03] CLAUDE.md split by concern, [D05] Plugin namespace uses tugplug: prefix, [D10] CI/CD workflow updates are mandatory, [D11] Release packaging uses share/tugplug/, Table T07 (#t07-step3-namespace), Table T11 (#t11-ci-cd-workflows), (#strategy)

**Artifacts:**
- New directory `tugplug/` containing `.claude-plugin/`, `agents/`, `skills/`, `hooks/`
- Updated `plugin.json` with `"name": "tugplug"`
- All hook and skill files updated with `tugplug:` namespace
- Split CLAUDE.md into root (project conventions) and `tugplug/CLAUDE.md` (plugin operations)
- Updated `.github/workflows/release.yml` plugin asset paths from root to `tugplug/`
- Updated `Formula/tugtool.rb` share paths from `share/"tugtool"` to `share/"tugplug"`

**Tasks:**
- [ ] Create `tugplug/` directory
- [ ] Move `.claude-plugin/`, `agents/`, `skills/`, `hooks/` into `tugplug/`
- [ ] In `tugplug/.claude-plugin/plugin.json`: change `"name": "tugtool"` to `"name": "tugplug"`
- [ ] In `tugplug/hooks/auto-approve-tug.sh`: change `tugtool:*` to `tugplug:*`
- [ ] In `tugplug/hooks/ensure-init.sh`: change `tugtool:*` to `tugplug:*`
- [ ] In `tugplug/skills/plan/SKILL.md`: change all `/tugtool:plan` to `/tugplug:plan`
- [ ] In `tugplug/skills/implement/SKILL.md`: change all `/tugtool:implement` to `/tugplug:implement`
- [ ] In `tugplug/skills/merge/SKILL.md`: change all `/tugtool:merge` to `/tugplug:merge`
- [ ] Split root CLAUDE.md: extract plugin-specific content (skill descriptions, agent contracts, worktree workflow, beads policy, plan mode policy) into `tugplug/CLAUDE.md`
- [ ] Update root CLAUDE.md: retain project conventions (crate structure, build policy, testing, common CLI commands, error codes); update all `/tugtool:*` skill invocations to `/tugplug:*`
- [ ] In all agent markdown files under `tugplug/agents/`: update any references to `/tugtool:*` skill names to `/tugplug:*`
- [ ] In `.claude/settings.local.json`: update `"Bash(tugtool:*)"` to `"Bash(tugplug:*)"` if present
- [ ] In `.github/workflows/release.yml` lines 54-57: change `share/tugtool/skills/` and `share/tugtool/agents/` to `share/tugplug/skills/` and `share/tugplug/agents/`
- [ ] In `.github/workflows/release.yml` lines 63-65: change `skills/plan/SKILL.md`, `skills/implement/SKILL.md`, `skills/merge/SKILL.md` to `tugplug/skills/plan/SKILL.md`, `tugplug/skills/implement/SKILL.md`, `tugplug/skills/merge/SKILL.md`
- [ ] In `.github/workflows/release.yml` line 68: change `agents/*.md` to `tugplug/agents/*.md`
- [ ] In `Formula/tugtool.rb`: change `share/"tugtool"` to `share/"tugplug"` in install paths (3 occurrences); update caveats to reference `share/tugplug/agents/` and `share/tugplug/skills/`

**Tests:**
- [ ] Manual verification: `claude --plugin-dir tugplug` loads the plugin

**Checkpoint:**
- [ ] `grep -r "tugtool:" --include='*.md' --include='*.json' --include='*.sh' tugplug/` returns 0 hits (namespace fully replaced)
- [ ] `grep -r "share/tugtool" --include='*.yml' --include='*.rb' .` returns 0 hits (release packaging updated to share/tugplug)
- [ ] Plugin loads from `tugplug/` directory
- [ ] Root CLAUDE.md contains only project conventions
- [ ] `tugplug/CLAUDE.md` contains only plugin operations

**Rollback:**
- Move directories back to root; restore original CLAUDE.md, release.yml, and Formula from git

**Commit after all checkpoints pass.**

---

#### Step 3: Free tugcode name -- rename launcher to tug-launch {#step-3}

**Depends on:** #step-2

**Commit:** `refactor: rename launcher binary tugcode to tug-launch (freeing tugcode name)`

**References:** [D01] Three-step binary name swap, Table T01 (#t01-execution-order), (#execution-order, #r01-name-collision)

**Artifacts:**
- Renamed directory `crates/tugcode/` to `crates/tug-launch/`
- Updated workspace Cargo.toml members list
- Updated all string literals in launcher source

**Tasks:**
- [ ] Rename directory `crates/tugcode/` to `crates/tug-launch/`
- [ ] In `crates/tug-launch/Cargo.toml`: change `name = "tugcode"` to `name = "tug-launch"`, update `[[bin]] name`
- [ ] In `crates/tug-launch/src/main.rs`: change all `"tugcode"` string literals to `"tug-launch"` (~15 occurrences including `#[command(name = "tugcode")]`, error prefix strings, test parse args)
- [ ] In root `Cargo.toml` workspace members: change `"crates/tugcode"` to `"crates/tug-launch"`
- [ ] In `crates/tugcast/build.rs`: update comment referencing `tugcode` to `tug-launch`
- [ ] In `tugdeck/src/cards/conversation-card.ts`: change `"restart tugcode"` to `"restart tug-launch"`
- [ ] In `tugdeck/src/cards/conversation-card.test.ts`: change matching test assertion string

**Tests:**
- [ ] Unit test: `cargo nextest run` passes
- [ ] Integration test: `cargo build` produces `tug-launch` binary

**Checkpoint:**
- [ ] `grep -r "tugcode" --include='*.rs' --include='*.toml' crates/` returns 0 hits (only tugtool and tugtool-core should remain)
- [ ] `cargo build && cargo nextest run` passes
- [ ] `cargo run -p tug-launch -- --help` succeeds (binary responds to new name)
- [ ] The name `tugcode` is completely free (no binary, no crate directory with that name)

**Rollback:**
- Revert commit; rename directory back

**Commit after all checkpoints pass.**

---

#### Step 4: Claim tugcode -- rename CLI binary tugtool to tugcode {#step-4}

**Depends on:** #step-3

**Commit:** `refactor: rename CLI binary tugtool to tugcode (claiming freed name)`

**References:** [D01] Three-step binary name swap, [D10] CI/CD workflow updates are mandatory, Table T01 (#t01-execution-order), Table T10 (#t10-step5-formula-scripts), Table T11 (#t11-ci-cd-workflows), (#execution-order, #r01-name-collision)

**Artifacts:**
- Renamed directory `crates/tugtool/` to `crates/tugcode/`
- Updated workspace Cargo.toml members list
- Updated all string literals, hook scripts, skill files, agent files, and CLAUDE.md references
- Updated Formula/tugtool.rb binary install path and test commands
- Updated scripts/release.sh and scripts/update-homebrew-formula.sh references
- Updated Justfile `cargo run -p tug` and `cargo install --path crates/tug` references
- Updated `.github/workflows/release.yml` binary name references from `tugtool` to `tugcode`

**Tasks:**
- [ ] Rename directory `crates/tugtool/` to `crates/tugcode/`
- [ ] In `crates/tugcode/Cargo.toml`: change `name = "tugtool"` to `name = "tugcode"`, update `[[bin]] name`
- [ ] In `crates/tugcode/src/cli.rs`: change `#[command(name = "tugtool")]` to `#[command(name = "tugcode")]`; update all `try_parse_from(["tugtool", ...])` in tests (~30 occurrences)
- [ ] In all `crates/tugcode/src/*.rs` files: update any remaining self-referencing `"tugtool"` strings
- [ ] In root `Cargo.toml` workspace members: change `"crates/tugtool"` to `"crates/tugcode"`
- [ ] In `tugplug/agents/committer-agent.md`: change all `tugtool commit`, `tugtool log`, `tugtool beads` references to `tugcode` equivalents
- [ ] In `tugplug/agents/integrator-agent.md`: change all `tugtool open-pr`, `tugtool worktree` references to `tugcode` equivalents
- [ ] In `tugplug/agents/reviewer-agent.md`: change all `tugtool validate`, `tugtool beads` references to `tugcode` equivalents
- [ ] In `tugplug/agents/architect-agent.md`: change all `tugtool` CLI references to `tugcode` equivalents
- [ ] In `tugplug/agents/coder-agent.md`: change all `tugtool` CLI references to `tugcode` equivalents
- [ ] In `tugplug/agents/critic-agent.md`: change all `tugtool validate` references to `tugcode validate`
- [ ] In `tugplug/agents/author-agent.md`: change all `tugtool validate` references to `tugcode validate`
- [ ] In `tugplug/skills/implement/SKILL.md`: change `tugtool init`, `tugtool worktree`, `tugtool commit`, etc. to `tugcode` equivalents
- [ ] In `tugplug/skills/merge/SKILL.md`: change `tugtool merge`, `tugtool doctor` to `tugcode merge`, `tugcode doctor`
- [ ] In `tugplug/hooks/ensure-init.sh`: change `tugtool init --quiet` to `tugcode init --quiet`
- [ ] In `tugplug/hooks/auto-approve-tug.sh`: change `tugtool\ *` bash pattern to `tugcode\ *`
- [ ] In `.claude/settings.local.json`: update any `tugtool` binary references to `tugcode`
- [ ] In root `CLAUDE.md`: change all `tugtool <subcommand>` CLI references to `tugcode <subcommand>` (preserve "tugtool" as project name and in tugtool-core references)
- [ ] In `tugplug/CLAUDE.md`: same CLI reference updates
- [ ] In `Justfile`: update `cargo run -p tug` to `cargo run -p tugcode`, update `cargo install --path crates/tug` to `cargo install --path crates/tugcode`, update `cargo nextest run -p tug` to `cargo nextest run -p tugcode`
- [ ] In `Formula/tugtool.rb`: update `bin.install "bin/tugtool"` to `bin.install "bin/tugcode"`; rewrite caveats block (lines 41-53) to remove ghost `tugtool setup claude` reference and replace with correct plugin usage instructions (`claude --plugin-dir tugplug`, then `/tugplug:plan`, `/tugplug:implement`, `/tugplug:merge`); update test commands `system "#{bin}/tugtool"` to `system "#{bin}/tugcode"` (lines 57-58); keep class name `Tugtool` -- that is the project name, not the binary name
- [ ] In `.github/workflows/release.yml` line 48: change `strip target/.../release/tugtool` to `strip target/.../release/tugcode`
- [ ] In `.github/workflows/release.yml` line 60: change `cp .../release/tugtool release/bin/` to `cp .../release/tugcode release/bin/`
- [ ] In `scripts/release.sh`: update any `tugtool` CLI references (note: mostly uses `Cargo.toml` and `cargo` commands which are path-relative, not binary-name dependent)
- [ ] In `scripts/update-homebrew-formula.sh`: update `FORMULA_PATH` and comments if needed

**Tests:**
- [ ] Unit test: `cargo nextest run` passes
- [ ] Integration test: `cargo build` produces `tugcode` binary

**Checkpoint:**
- [ ] `grep -rn "\"tugtool\"" --include='*.rs' crates/tugcode/` returns 0 hits (the binary is now tugcode)
- [ ] `grep -rn "tugtool " --include='*.sh' --include='*.json' tugplug/` returns 0 hits (all CLI invocations updated)
- [ ] `grep -rEn "tugtool (init|validate|beads|commit|merge|doctor|open-pr|worktree|log|status|list|resolve|setup)" --include='*.md' tugplug/` returns 0 hits (all CLI subcommand references updated; this pattern avoids false positives on project-name occurrences like "tugtool coder agent")
- [ ] `cargo build && cargo nextest run` passes
- [ ] `cargo run -p tugcode -- --help` succeeds and shows CLI help (validate, init, worktree, etc.)
- [ ] The name `tugtool` is free as a binary name (still exists as project name and in tugtool-core)

**Rollback:**
- Revert commit; rename directory back

**Commit after all checkpoints pass.**

---

#### Step 5: Claim tugtool -- rename tug-launch launcher to tugtool {#step-5}

**Depends on:** #step-4

**Commit:** `refactor: rename launcher binary tug-launch to tugtool (final name swap)`

**References:** [D01] Three-step binary name swap, Table T01 (#t01-execution-order), (#execution-order, #r01-name-collision)

**Artifacts:**
- Renamed directory `crates/tug-launch/` to `crates/tugtool/`
- Updated workspace Cargo.toml members list
- Updated all string literals referencing tug-launch

**Tasks:**
- [ ] Rename directory `crates/tug-launch/` to `crates/tugtool/`
- [ ] In `crates/tugtool/Cargo.toml`: change `name = "tug-launch"` to `name = "tugtool"`, update `[[bin]] name`
- [ ] In `crates/tugtool/src/main.rs`: change all `"tug-launch"` strings to `"tugtool"`
- [ ] In root `Cargo.toml` workspace members: change `"crates/tug-launch"` to `"crates/tugtool"`
- [ ] In `crates/tugcast/build.rs`: update comment from `tug-launch` to `tugtool`
- [ ] In `tugdeck/src/cards/conversation-card.ts`: change `"restart tug-launch"` to `"restart tugtool"`
- [ ] In `tugdeck/src/cards/conversation-card.test.ts`: change matching test assertion string

**Tests:**
- [ ] Unit test: `cargo nextest run` passes
- [ ] Integration test: `cargo build` produces `tugtool` binary

**Checkpoint:**
- [ ] `grep -r "tug-launch" --include='*.rs' --include='*.toml' --include='*.ts' .` returns 0 hits
- [ ] `cargo build && cargo nextest run` passes
- [ ] `cargo run -p tugtool -- --help` succeeds and shows launcher help
- [ ] `cargo run -p tugcode -- --help` succeeds and shows CLI help
- [ ] The temporary name `tug-launch` is completely gone
- [ ] Binary names are now correct: `tugtool` (launcher), `tugcode` (CLI)

**Rollback:**
- Revert commit; rename directory back

**Commit after all checkpoints pass.**

---

#### Step 6: Move Rust workspace into tugcode/ subdirectory {#step-6}

**Depends on:** #step-5

**Commit:** `refactor: move Rust workspace into tugcode/ subdirectory for mono-repo layout`

**References:** [D06] Move Rust workspace into tugcode/ subdirectory, [D09] Update build.rs relative paths after workspace move, [D10] CI/CD workflow updates are mandatory, Table T08 (#t08-step6b-move), Table T11 (#t11-ci-cd-workflows), (#strategy, #target-layout)

**Artifacts:**
- New directory `tugcode/` containing all Rust workspace infrastructure
- Updated `tugcode/crates/tugcast/build.rs` with corrected relative paths (3 levels to repo root instead of 2)
- Updated `.github/workflows/ci.yml` with `working-directory: tugcode` for all cargo steps
- Updated `.github/workflows/release.yml` with `working-directory: tugcode` for cargo build, and corrected paths for scripts and Formula
- Updated root `.gitignore` from `/target/` to `/tugcode/target/`
- Updated root CLAUDE.md crate structure paths
- Updated `scripts/release.sh` with corrected `Cargo.toml` path
- Removed `dist/app.js` (tugdeck build artifact, regenerated)

**Tasks:**
- [ ] Create `tugcode/` directory
- [ ] Move `Cargo.toml`, `Cargo.lock` into `tugcode/`
- [ ] Move `.cargo/` into `tugcode/`
- [ ] Move `clippy.toml`, `rust-toolchain.toml` into `tugcode/`
- [ ] Move `Justfile` into `tugcode/`
- [ ] Move `crates/` into `tugcode/`
- [ ] Move `tests/` into `tugcode/`
- [ ] Move `Formula/` into `tugcode/`
- [ ] Move `scripts/` into `tugcode/`
- [ ] Remove `dist/app.js` (tugdeck build artifact, regenerated by `bun run build`)
- [ ] In `tugcode/crates/tugcast/build.rs` line 13: add one more `.parent().unwrap()` to repo root resolution -- crate is now at `tugcode/crates/tugcast/` (3 levels deep, was 2); change `manifest_dir.parent().unwrap().parent().unwrap()` to `manifest_dir.parent().unwrap().parent().unwrap().parent().unwrap()` -- build-critical, without this cargo cannot find tugdeck/ and tugtalk/
- [ ] In `tugcode/crates/tugcast/build.rs` lines 150-155: update all `rerun-if-changed` paths from `../../tugdeck/` to `../../../tugdeck/` and `../../tugtalk/` to `../../../tugtalk/` (3 levels up instead of 2)
- [ ] In `.github/workflows/ci.yml`: add `working-directory: tugcode` to Build step (line 47), Run tests step (line 50), Check formatting step (line 63), and Run clippy step (line 91); update cache target path from `target` to `tugcode/target` (line 28)
- [ ] In `.github/workflows/release.yml` line 47: add `working-directory: tugcode` to Build binary step -- this makes both `cargo build` and `strip target/...` run from `tugcode/`, so the strip path resolves correctly without any prefix change (Step 4 already updated the binary name on this line)
- [ ] In `.github/workflows/release.yml` line 60: change `cp target/${{ matrix.target }}/release/tugcode release/bin/` to `cp tugcode/target/${{ matrix.target }}/release/tugcode release/bin/` -- the "Create release directory structure" step runs from repo root (no working-directory), so it needs the `tugcode/` prefix to find the binary built under `tugcode/target/`
- [ ] In `.github/workflows/release.yml` lines 167-168: change `./scripts/update-homebrew-formula.sh` to `./tugcode/scripts/update-homebrew-formula.sh`
- [ ] In `.github/workflows/release.yml` line 174: change `git add Formula/tugtool.rb` to `git add tugcode/Formula/tugtool.rb`
- [ ] In `tugcode/scripts/release.sh`: update `Cargo.toml` path references to work from tugcode/ directory context
- [ ] Update root `.gitignore`: change `/target/` to `/tugcode/target/`
- [ ] Update root `CLAUDE.md`: change crate structure paths to `tugcode/crates/` prefix; update build/test commands to `cd tugcode && cargo <command>` pattern
- [ ] Update `tugplug/CLAUDE.md`: update any cargo command references to use `cd tugcode && cargo <command>` pattern
- [ ] Verify `tugcode/Cargo.toml` workspace member paths still resolve correctly (they are relative to `tugcode/` already, e.g., `crates/tugcode`)

**Tests:**
- [ ] Unit test: `cd tugcode && cargo nextest run` passes
- [ ] Integration test: `cd tugcode && cargo build` succeeds (critical: verifies build.rs path resolution)

**Checkpoint:**
- [ ] `cd tugcode && cargo build && cargo nextest run` passes (this is the primary verification that build.rs paths are correct)
- [ ] `cd tugdeck && bun test && bun run build` passes
- [ ] Root directory no longer contains `Cargo.toml`, `Cargo.lock`, `.cargo/`, `crates/`, `tests/`
- [ ] `.gitignore` references `tugcode/target/`
- [ ] `grep -r "cargo build\|cargo test\|cargo clippy\|cargo fmt" .github/workflows/ci.yml` shows all cargo commands have `working-directory: tugcode` (or equivalent)

**Rollback:**
- Move all directories back to root; restore original .gitignore, build.rs, ci.yml, and release.yml from git

**Commit after all checkpoints pass.**

---

### 7.0.6 Target Layout {#target-layout}

After all steps complete, the project root will look like this:

```
/u/src/tugtool/                    (mono-repo root)
+-- CLAUDE.md                      (project-level guidelines)
+-- README.md
+-- .tugtool/                      (tugplan infrastructure)
+-- roadmap/                       (design documents)
|
+-- tugcode/                       (Rust workspace)
|   +-- Cargo.toml                 (workspace root)
|   +-- Cargo.lock
|   +-- .cargo/config.toml
|   +-- clippy.toml
|   +-- rust-toolchain.toml
|   +-- Justfile
|   +-- Formula/
|   +-- scripts/
|   +-- tests/                     (test fixtures)
|   +-- crates/
|       +-- tugcode/               (CLI: validate, init, worktree, merge)
|       +-- tugtool/               (launcher: starts tugcast, opens browser)
|       +-- tugtool-core/          (library: plan parsing, validation)
|       +-- tugcast/               (HTTP/WS server)
|       +-- tugcast-core/          (server library)
|
+-- tugdeck/                       (browser frontend -- TypeScript)
|   +-- src/
|   +-- styles/
|   +-- package.json
|
+-- tugplug/                       (Claude Code plugin)
|   +-- .claude-plugin/
|   +-- agents/
|   +-- skills/
|   +-- hooks/
|   +-- CLAUDE.md
|
+-- tugtalk/                       (protocol)
```

---

### 7.0.7 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Complete rename and reorganization transforming the tugtool project into a clean mono-repo with four subdirectory projects (tugcode/, tugdeck/, tugplug/, tugtalk/), all legacy naming debts resolved, and all builds passing.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero `--rn-` or `retronow` references in live CSS files (`grep -r "\-\-rn-\|retronow" --include='*.css' tugdeck/` returns 0)
- [ ] Zero `PanelManager`, `FloatingPanel`, `PanelState`, `floating-panel` references in live TS/CSS (`grep -r "PanelManager\|FloatingPanel\|PanelState\|floating-panel" --include='*.ts' --include='*.css' tugdeck/` returns 0)
- [ ] Zero `tugtool:` namespace references in plugin files (`grep -r "tugtool:" --include='*.md' --include='*.json' --include='*.sh' tugplug/` returns 0)
- [ ] Zero `tug-launch` references anywhere (`grep -r "tug-launch" .` returns 0)
- [ ] `cd tugcode && cargo build && cargo nextest run` passes
- [ ] `cd tugdeck && bun test && bun run build` passes
- [ ] Plugin loads from `tugplug/` directory
- [ ] Project root contains no Rust workspace files (no `Cargo.toml`, `Cargo.lock`, `.cargo/`, `crates/`, `tests/` at root level)
- [ ] Binary names are correct: `tugtool` = launcher, `tugcode` = CLI

**Acceptance tests:**
- [ ] Integration test: full `cargo build` from `tugcode/` produces both `tugtool` and `tugcode` binaries
- [ ] Integration test: `cd tugdeck && bun test` passes with all renames in place
- [ ] Integration test: `claude --plugin-dir tugplug` loads the plugin with `tugplug:` namespace
- [ ] Integration test: CI workflow yaml references correct paths (`tugcode/` for cargo steps, `tugplug/` for plugin assets)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Update README.md with new project structure documentation
- [ ] Consider adding a root-level Makefile or Justfile that delegates to `tugcode/Justfile`

| Checkpoint | Verification |
|------------|--------------|
| All old names purged | grep verification commands return 0 hits |
| All builds pass | `cargo build`, `cargo nextest run`, `bun test`, `bun run build` |
| Mono-repo layout correct | Root directory structure matches target layout |
| Binary names correct | `tugtool --help` shows launcher, `tugcode --help` shows CLI |

**Commit after all checkpoints pass.**
