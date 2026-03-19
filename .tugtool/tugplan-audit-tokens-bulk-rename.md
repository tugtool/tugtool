## Phase 3.5-tooling: Enhance audit-tokens for Bulk Rename {#phase-35-tooling}

**Purpose:** Upgrade the `audit-tokens` rename infrastructure so it can generate a complete 373-token rename map and execute the Phase 3.5A rename (320+ tokens across 80+ files) safely and mechanically.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-19 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current `audit-tokens rename` subcommand has a hardcoded 7-entry rename map from Phase 1. Phase 3.5A requires renaming every structured token in the system (~320+ tokens) across every file that references them (~80+ files). The current tooling cannot generate a rename map programmatically, load one from an external file, handle component alias tokens or `@tug-renders-on` annotations, auto-discover all referencing files, or verify that no old names remain after rename. This plan upgrades the tooling to handle all of these.

#### Strategy {#strategy}

- Build the `rename-map` subcommand first — it is the foundation that encodes the naming convention as code, enabling iterate-until-correct workflows before touching any source files.
- Enhance the existing `rename` subcommand incrementally: JSON map loading, auto-discovery, alias handling, annotation handling, then `--verify` and `--stats` modes.
- Use `bun run audit:tokens` in every execution step for discovery and verification — no manual grep exploration.
- Seed the rename map from the complete rename table in the roadmap, then cross-reference it against the actual `audit-tokens tokens` inventory to guarantee completeness and correctness.
- Name all 373 tokens including the 32 chromatic tokens — no deferred "human must fill in" gaps.
- Keep the existing 7-entry hardcoded `RENAME_MAP` as the fallback when no `--map` flag is given.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run audit:tokens rename-map` produces a JSON map covering all 373 tokens with zero collisions (`bun run audit:tokens rename-map` exits 0)
- `bun run audit:tokens rename --map token-rename-map.json` (dry run) shows all expected replacements for every token-referencing file
- `bun run audit:tokens rename --map token-rename-map.json --apply` applies cleanly (exit 0)
- `bun run audit:tokens rename --verify --map token-rename-map.json` reports zero stale references (exit 0)
- `bun run audit:tokens rename --stats --map token-rename-map.json` prints a summary table with token count, file count, and per-file replacement counts
- `bun run audit:tokens lint` passes after rename (exit 0)
- `bun test` passes after rename (all 1891+ tests pass)
- Auto-discovery finds every `.ts`, `.tsx`, `.css` file under `tugdeck/` that contains `--tug-base-` references (currently ~86 files) — no hardcoded file list

#### Scope {#scope}

1. New `rename-map` subcommand that generates the complete old-to-new rename map as JSON
2. Enhanced `rename` subcommand: `--map` flag, auto-discovery, component alias handling, `@tug-renders-on` handling
3. New `--verify` mode for post-rename stale reference scanning
4. New `--stats` mode for pre-rename blast radius summary
5. Chromatic token naming convention decision and implementation for all 32 chromatic tokens
6. Two output modes: `--json` for flat map piped to file, default for human-readable report

#### Non-goals (Explicitly out of scope) {#non-goals}

- Actually executing the Phase 3.5A rename across the codebase (that is Phase 3.5A's scope)
- Changes to the derivation engine, pairing map, or contrast engine
- Changes to the six-slot naming convention itself (that is already decided in the roadmap)
- Formula field renames (that is Phase 3.5C)
- New tokens or removal of tokens

#### Dependencies / Prerequisites {#dependencies}

- Phase 1.5 complete: `audit-tokens.ts` exists with 6 subcommands (tokens, pairings, rename, inject, verify, lint)
- Phase 2 complete: contrast engine fix merged
- Phase 3 complete: independent recipes merged
- The rename table in `roadmap/theme-system-overhaul.md` Phase 3.5A section provides the seed map

#### Constraints {#constraints}

- All work is in TypeScript within `tugdeck/scripts/audit-tokens.ts` (~1443 lines) and the new `tugdeck/scripts/seed-rename-map.ts` (~750 lines for the seed map constant)
- Must use `bun` (never npm) for all script execution
- Auto-discovery must scan `.ts`, `.tsx`, `.css` files under `tugdeck/` recursively
- The existing `RENAME_MAP` (7 entries) must remain as fallback when no `--map` is given
- `bun run audit:tokens` must remain the canonical invocation for all subcommands

#### Assumptions {#assumptions}

- The 373-token inventory from `bun run audit:tokens tokens` is current and complete
- The rename table in the roadmap covers all non-chromatic structured tokens
- The `classifyToken()` function's existing classification (element/surface/chromatic/non-color) is correct
- Component alias tokens (`--tug-card-*`, `--tug-tab-*`) are defined in component CSS files already tracked by `COMPONENT_CSS_FILES`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All anchors in this plan use explicit `{#anchor-name}` syntax with kebab-case naming. See skeleton section 3 for anchor rules.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

*No open questions. All naming decisions are resolved in [D03] and [D04].*

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Rename map has collisions (two old tokens map to same new name) | high | low | Validation in rename-map generator rejects collisions before output | Any collision detected during generation |
| Auto-discovery misses files with token references | high | low | Cross-reference discovered files against `audit-tokens tokens` output; verify mode catches stale refs | Any stale reference found by --verify |
| Chromatic token naming convention produces awkward names | med | med | Review chromatic names before committing map; iterate naming convention in generator code | Names don't read naturally when applied |

**Risk R01: Rename map incompleteness** {#r01-map-incompleteness}

- **Risk:** The seed map from the roadmap might not cover every token in the actual inventory, leaving gaps.
- **Mitigation:** The rename-map generator cross-references against the live `extractTokens()` output. Any token present in the inventory but absent from the map is flagged as an error.
- **Residual risk:** If a token exists in source but not in the generated CSS (unlikely given the generation pipeline), it would be missed.

**Risk R02: Regex replacement false positives** {#r02-regex-false-positives}

- **Risk:** The token name regex could match partial strings, especially for short token names like `bg-app`.
- **Mitigation:** Existing word-boundary-aware regex (`(?=[^\w-]|$)`) prevents partial matches. The `--verify` mode provides a safety net after application.
- **Residual risk:** Token names appearing in prose comments could be renamed unnecessarily (acceptable — comments should use current names).

---

### Design Decisions {#design-decisions}

#### [D01] Seed map from roadmap, validated against token inventory (DECIDED) {#d01-seed-map-validated}

**Decision:** The rename-map generator starts from the complete rename table hardcoded as a seed map, then validates it against the live `audit-tokens tokens` output to ensure completeness and correctness. `audit-tokens` is the source of truth for what tokens exist.

**Rationale:**
- The roadmap already contains a carefully designed rename table covering ~340 structured tokens
- Hardcoding the seed map avoids the fragile heuristic of trying to parse old token names algorithmically
- Cross-referencing against the live inventory catches any drift between the roadmap table and reality

**Implications:**
- The seed map is a TypeScript `Record<string, string>` constant in a dedicated `seed-rename-map.ts` file (imported by `audit-tokens.ts`), keeping the ~750-line constant separate from the ~1443-line audit logic
- Non-color tokens (size, radius, font, motion, etc.) map to themselves (identity mapping) — they are not renamed
- Every token in the inventory must appear in the map; missing tokens cause a generation error

#### [D02] Pure auto-discovery for file targets (DECIDED) {#d02-auto-discovery}

**Decision:** The rename command discovers target files by recursively scanning all `.ts`, `.tsx`, `.css` files under `tugdeck/` for `--tug-base-` references. No hardcoded file list.

**Rationale:**
- The current hardcoded list misses ~15 files that reference tokens
- Auto-discovery eliminates the maintenance burden of updating the file list
- Recursive scan of `tugdeck/` is fast (<100ms with bun's fs APIs)

**Implications:**
- `getRenameTargetFiles()` is replaced with a recursive directory scan
- `node_modules/` and `dist/` directories are excluded from scanning
- The scan result is deterministic (sorted alphabetically) for reproducible dry runs

#### [D03] Chromatic tokens follow a three-slot convention (DECIDED) {#d03-chromatic-naming}

**Decision:** The 32 chromatic tokens do not fit the six-slot element/surface convention because they are standalone chromatic values (overlays, highlights, toggle tracks/thumbs, radio dots) that do not participate in standard element-on-surface contrast pairings. They follow a three-slot convention: `chromatic-<component>-<descriptor>`.

**Rationale:**
- Forcing chromatic tokens into the six-slot convention produces nonsensical names (e.g., `element-toggle-normal-on-track-rest` conflates plane/channel/state)
- The `chromatic` classification already exists in `classifyToken()` — this naming makes it explicit
- Three slots (component + descriptor) are sufficient to uniquely identify each chromatic token

**Implications:**
- All 32 tokens in the `CHROMATIC_TOKENS` set get `chromatic-` prefixed names
- The `classifyToken()` function recognizes `chromatic-` prefix tokens
- Examples: `tone-accent` becomes `chromatic-tone-accent`, `toggle-track-on` becomes `chromatic-toggle-trackOn`, `highlight-hover` becomes `chromatic-highlight-hover`, `overlay-dim` becomes `chromatic-overlay-dim`

#### [D04] Complete chromatic rename map (DECIDED) {#d04-chromatic-complete-map}

**Decision:** All 32 chromatic tokens are mapped in the seed map with concrete new names. No tokens are deferred for human decision.

**Rationale:**
- The user explicitly requires a complete 373-token map with no gaps
- The three-slot convention from [D03] provides a mechanical rule for all 32 tokens
- Iteration is cheap — regenerate, preview, adjust — because the naming convention is encoded as code

**Implications:**
- The seed map includes all 32 entries from the `CHROMATIC_TOKENS` set
- The rename-map generator validates that all 32 chromatic tokens are present and well-formed

**Table T01: Chromatic Token Rename Map** {#t01-chromatic-rename-map}

| Current | Proposed |
|---------|----------|
| `accent-default` | `chromatic-accent-default` |
| `accent-cool-default` | `chromatic-accent-coolDefault` |
| `accent-subtle` | `chromatic-accent-subtle` |
| `tone-accent` | `chromatic-tone-accent` |
| `tone-active` | `chromatic-tone-active` |
| `tone-agent` | `chromatic-tone-agent` |
| `tone-data` | `chromatic-tone-data` |
| `tone-success` | `chromatic-tone-success` |
| `tone-caution` | `chromatic-tone-caution` |
| `tone-danger` | `chromatic-tone-danger` |
| `highlight-hover` | `chromatic-highlight-hover` |
| `highlight-dropTarget` | `chromatic-highlight-dropTarget` |
| `highlight-preview` | `chromatic-highlight-preview` |
| `highlight-inspectorTarget` | `chromatic-highlight-inspectorTarget` |
| `highlight-snapGuide` | `chromatic-highlight-snapGuide` |
| `highlight-flash` | `chromatic-highlight-flash` |
| `overlay-dim` | `chromatic-overlay-dim` |
| `overlay-scrim` | `chromatic-overlay-scrim` |
| `overlay-highlight` | `chromatic-overlay-highlight` |
| `toggle-track-off` | `chromatic-toggle-trackOff` |
| `toggle-track-off-hover` | `chromatic-toggle-trackOffHover` |
| `toggle-track-on` | `chromatic-toggle-trackOn` |
| `toggle-track-on-hover` | `chromatic-toggle-trackOnHover` |
| `toggle-track-disabled` | `chromatic-toggle-trackDisabled` |
| `toggle-track-mixed` | `chromatic-toggle-trackMixed` |
| `toggle-track-mixed-hover` | `chromatic-toggle-trackMixedHover` |
| `toggle-thumb` | `chromatic-toggle-thumb` |
| `toggle-thumb-disabled` | `chromatic-toggle-thumbDisabled` |
| `radio-dot` | `chromatic-radio-dot` |
| `field-tone-danger` | `chromatic-field-toneDanger` |
| `field-tone-caution` | `chromatic-field-toneCaution` |
| `field-tone-success` | `chromatic-field-toneSuccess` |

#### [D05] Two output modes for rename-map (DECIDED) {#d05-output-modes}

**Decision:** `rename-map` supports two output modes: `--json` outputs a flat `{"old": "new"}` JSON object (suitable for piping to a file), and the default outputs a human-readable report with classification groups, flags, and validation errors to stdout.

**Rationale:**
- Machine-readable JSON is needed for `rename --map` consumption
- Human-readable output is needed for review and iteration during the naming design phase
- Separating the modes avoids mixing prose and JSON in a single output

**Implications:**
- `bun run audit:tokens rename-map --json > token-rename-map.json` produces the map file
- `bun run audit:tokens rename-map` produces a grouped report with statistics
- Both modes run the same validation; errors go to stderr in JSON mode

#### [D06] Annotation and alias handling in rename (DECIDED) {#d06-annotation-alias-handling}

**Decision:** The rename command handles three additional reference patterns beyond the existing CSS custom property and bare string patterns: (1) `@tug-renders-on` annotations, (2) component alias `var()` references, and (3) `@tug-pairings` comment block references.

**Rationale:**
- `@tug-renders-on` annotations contain token names as `/* @tug-renders-on: --tug-base-{name} */` — these must be updated or the lint subcommand will fail
- Component aliases like `--tug-card-bg: var(--tug-base-surface-overlay)` reference base tokens that will be renamed
- `@tug-pairings` blocks list token names that need updating (alternatively, `inject --apply` can regenerate them, but rename should handle them for completeness)

**Implications:**
- The regex in `cmdRename()` already handles `--tug-base-{name}` with word boundaries — this naturally covers annotations and alias `var()` references since they use the same `--tug-base-` prefix
- No additional regex patterns are needed for these cases; the existing replacement logic is sufficient
- After rename, `bun run audit:tokens inject --apply` should be run to regenerate `@tug-pairings` blocks from fresh analysis

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: rename-map subcommand** {#s01-rename-map}

| Aspect | Detail |
|--------|--------|
| Input | Live token inventory from `extractTokens()` + hardcoded seed map |
| Output (default) | Human-readable report to stdout: grouped by classification, with statistics |
| Output (`--json`) | Flat JSON object `{"old-short": "new-short"}` to stdout |
| Validation | All 373 tokens mapped, no collisions, all new names well-formed |
| Error handling | Missing tokens logged to stderr; exit code 1 if any token unmapped |

**Spec S02: rename --map flag** {#s02-rename-map-flag}

| Aspect | Detail |
|--------|--------|
| Flag | `--map <path>` |
| Format | JSON file containing `{"old-short": "new-short"}` entries |
| Fallback | When `--map` is not specified, use the existing hardcoded `RENAME_MAP` (7 entries) |
| Validation | JSON parse errors are reported with file path and error message; exit code 1 |

**Spec S03: rename --verify mode** {#s03-rename-verify}

| Aspect | Detail |
|--------|--------|
| Flag | `--verify` (requires `--map`) |
| Behavior | Scans all auto-discovered files using the SAME two regex patterns that `cmdRename` uses for replacement: (1) `--tug-base-{old-name}` with word-boundary lookahead `(?=[^\w-]|$)`, and (2) bare `"{old-name}"` with colon lookahead `(?=\s*:)`. This ensures verify detects exactly the references that rename would change — no more, no less. |
| Output | Reports every stale reference with file path, line number, and old name |
| Exit code | 0 if zero stale references, 1 if any remain |

**Spec S04: rename --stats mode** {#s04-rename-stats}

| Aspect | Detail |
|--------|--------|
| Flag | `--stats` (requires `--map`) |
| Behavior | Counts tokens to rename, files to modify, and replacements per file without modifying anything |
| Output | Summary table to stdout: total tokens, total files, per-file replacement count |
| Exit code | Always 0 |

**Spec S05: Auto-discovery** {#s05-auto-discovery}

| Aspect | Detail |
|--------|--------|
| Scan root | `tugdeck/` directory |
| File types | `.ts`, `.tsx`, `.css` |
| Pattern | Files containing the string `--tug-base-` |
| Exclusions | `node_modules/`, `dist/`, `.git/`, `scripts/audit-tokens.ts`, `scripts/seed-rename-map.ts` (contain token names as map keys/constants, not as references to rename). Generated CSS files (e.g., `tug-base.css`, theme files) are NOT excluded — they are included in auto-discovery so that dry-run/stats output accurately reflects the full blast radius. Phase 3.5A will regenerate them via `bun run generate:tokens` after the rename apply step. |
| Sort | Alphabetical by relative path for deterministic output |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/scripts/seed-rename-map.ts` | Dedicated file for the ~750-line `SEED_RENAME_MAP` constant, keeping it separate from audit logic |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SEED_RENAME_MAP` | const | `seed-rename-map.ts` | Complete 373-entry `Record<string, string>` seed map from roadmap tables + chromatic map; exported and imported by `audit-tokens.ts` |
| `cmdRenameMap()` | fn | `audit-tokens.ts` | New subcommand handler: generates and validates the rename map |
| `discoverTokenFiles()` | fn | `audit-tokens.ts` | Recursive scanner replacing `getRenameTargetFiles()` |
| `cmdRename()` | fn (modified) | `audit-tokens.ts` | Signature changed from `(apply: boolean)` to `(opts: { apply, mapPath?, verify, stats })`. Enhanced: `--map`, `--verify`, `--stats` flags; uses `discoverTokenFiles()` |
| `validateRenameMap()` | fn | `audit-tokens.ts` | Validates map completeness, no collisions, well-formed new names |
| `loadExternalMap()` | fn | `audit-tokens.ts` | Reads and parses a JSON rename map file |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Integration** | End-to-end subcommand invocation via `bun run audit:tokens` | Every subcommand: rename-map, rename --map, rename --verify, rename --stats |
| **Golden / Contract** | Compare rename-map JSON output against expected structure | Validate map completeness and format |
| **Drift Prevention** | Existing `bun test` suite (1891+ tests) must pass unchanged | After any code change to audit-tokens.ts |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add auto-discovery function {#step-1}

**Commit:** `feat(audit-tokens): add auto-discovery for token-referencing files`

**References:** [D02] Pure auto-discovery, Spec S05, (#inputs-outputs, #strategy)

**Artifacts:**
- New `discoverTokenFiles()` function in `audit-tokens.ts`
- Modified `cmdRename()` to use `discoverTokenFiles()` instead of `getRenameTargetFiles()`

**Tasks:**
- [ ] Add `discoverTokenFiles()` that recursively scans `tugdeck/` for `.ts`, `.tsx`, `.css` files containing `--tug-base-`, excluding `node_modules/`, `dist/`, `.git/`, `scripts/audit-tokens.ts`, and `scripts/seed-rename-map.ts` (these contain token names as map keys/constants, not as references to rename). Generated CSS files and `scripts/generate-tug-tokens.ts` are included in discovery so that dry-run/stats output accurately reflects the full blast radius; Phase 3.5A will regenerate generated CSS via `bun run generate:tokens` after the rename apply step
- [ ] Sort results alphabetically by relative path
- [ ] Replace `getRenameTargetFiles()` call in `cmdRename()` with `discoverTokenFiles()`
- [ ] Remove the `getRenameTargetFiles()` function entirely (dead code would trigger lint or unused-function warnings; no reason to defer removal since `discoverTokenFiles()` is the complete replacement)

**Tests:**
- [ ] `bun run audit:tokens rename` (dry run with existing 7-entry map) produces output listing auto-discovered files
- [ ] Verify discovered files include all files from the old hardcoded list plus additional files like `src/__tests__/contrast-exceptions.ts`, `src/globals.css`, `styles/tug-base.css`

**Checkpoint:**
- [ ] `bun run audit:tokens rename` exits 0 (dry run)
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes

---

#### Step 2: Add rename-map subcommand with seed map {#step-2}

**Depends on:** #step-1

**Commit:** `feat(audit-tokens): add rename-map subcommand with complete seed map`

**References:** [D01] Seed map validated, [D03] Chromatic naming, [D04] Chromatic complete map, [D05] Output modes, Spec S01, Table T01, (#context, #strategy)

**Artifacts:**
- New `tugdeck/scripts/seed-rename-map.ts` file with exported `SEED_RENAME_MAP` constant (~373 entries)
- `validateRenameMap()` function
- `cmdRenameMap()` function
- New `rename-map` case in main switch

**Tasks:**
- [ ] Run `bun run audit:tokens tokens` to get the full token inventory (use `extractTokens()` output as the authoritative count — do not hardcode 373; the actual count may drift as the codebase evolves)
- [ ] Create `tugdeck/scripts/seed-rename-map.ts` with an exported `SEED_RENAME_MAP` constant covering all tokens from `extractTokens()` output: (a) the ~118 explicit rename entries from the roadmap Phase 3.5A table, (b) additional control (element/surface) tokens expanded from the roadmap's pattern notes (e.g., "same pattern repeats for action, danger..." — systematically apply the six-slot naming convention to each control role: accent, action, option, danger, agent, data, success, caution — matching `ROLE_ORDER` in `generate-tug-tokens.ts`). Note: the roadmap pattern note omits "option" from the listed roles, but 24 option-role tokens exist (outlined-option and ghost-option variants) — include them per ROLE_ORDER, (c) the 32 chromatic entries from Table T01, (d) identity mappings for all remaining non-color tokens (size, radius, font, motion, etc.)
- [ ] Add `import { SEED_RENAME_MAP } from "./seed-rename-map"` to `audit-tokens.ts`
- [ ] Add `validateRenameMap()` that checks: (a) every token from `extractTokens()` is present in the map, (b) no two old names map to the same new name (collision check), (c) all new names are well-formed (no empty strings, no leading/trailing hyphens). Well-formedness checks on NEW names must not enforce a fixed set of state-slot suffixes because some renamed tokens have non-state trailing segments (e.g., shadow tokens like `shadow-lg` are classified as `element` by `classifyToken()` and get full six-slot renames per the roadmap table — they are NOT identity-mapped — producing names like `element-global-normal-plain-shadow-xs` where the final segment is a size descriptor, not a state slot). Validation should accept any well-formed kebab-case new name regardless of suffix
- [ ] Add `cmdRenameMap()` that calls `extractTokens()`, runs validation, and outputs the map in default (human-readable) or `--json` mode
- [ ] Wire `rename-map` into the main switch statement
- [ ] Cross-reference the seed map against `bun run audit:tokens tokens` output to verify all 373 tokens are covered

**Tests:**
- [ ] `bun run audit:tokens rename-map` outputs grouped report with zero errors
- [ ] `bun run audit:tokens rename-map --json` outputs valid JSON parseable by `JSON.parse()`
- [ ] `bun run audit:tokens rename-map --json | bun -e "const m = await Bun.stdin.json(); console.log(Object.keys(m).length)"` prints the count matching `extractTokens()` output (373 as of plan authoring)

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map` exits 0 with zero validation errors
- [ ] `bun run audit:tokens rename-map --json > /tmp/test-map.json && cat /tmp/test-map.json | python3 -c "import json,sys; m=json.load(sys.stdin); print(len(m))"` prints the count matching `extractTokens()` output (373 as of plan authoring)
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes

---

#### Step 3: Add --map flag to rename subcommand {#step-3}

**Depends on:** #step-2

**Commit:** `feat(audit-tokens): add --map flag for external rename map loading`

**References:** [D01] Seed map validated, Spec S02, (#inputs-outputs)

**Artifacts:**
- `loadExternalMap()` function in `audit-tokens.ts`
- Modified `cmdRename()` to accept `--map <path>` flag

**Tasks:**
- [ ] Add `loadExternalMap(mapPath: string)` that reads and parses a JSON file, validates it is a `Record<string, string>`, and returns the map
- [ ] Refactor the main arg parsing: the current `const flags = new Set(args.slice(1))` pattern cannot extract `--map <path>` because Set-based parsing discards positional relationships. Replace with index-based arg extraction that finds `--map` by index and reads `args[index + 1]` as the path value
- [ ] Change `cmdRename()` signature from `cmdRename(apply: boolean)` to accept an options object `{ apply: boolean; mapPath?: string; verify: boolean; stats: boolean }` so all flags (including the path from `--map`) can be passed cleanly
- [ ] Update the `case "rename":` switch branch to build the options object from the parsed args and pass it to `cmdRename()`
- [ ] Inside `cmdRename()`, when `mapPath` is provided, call `loadExternalMap(mapPath)` instead of using `RENAME_MAP`
- [ ] Ensure the hardcoded `RENAME_MAP` (7 entries) remains the fallback when `--map` is not specified

**Tests:**
- [ ] Generate a test map: `bun run audit:tokens rename-map --json > /tmp/test-rename-map.json`
- [ ] `bun run audit:tokens rename --map /tmp/test-rename-map.json` (dry run) shows all expected replacements
- [ ] `bun run audit:tokens rename` (no --map) still uses the hardcoded 7-entry map

**Checkpoint:**
- [ ] `bun run audit:tokens rename --map /tmp/test-rename-map.json` exits 0 (dry run shows replacements)
- [ ] `bun run audit:tokens rename` exits 0 (fallback to hardcoded map)
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes

---

#### Step 4: Add --stats mode to rename {#step-4}

**Depends on:** #step-3

**Commit:** `feat(audit-tokens): add --stats mode for rename blast radius preview`

**References:** Spec S04, (#success-criteria)

**Artifacts:**
- `--stats` flag handling in `cmdRename()`

**Tasks:**
- [ ] Add `--stats` flag detection in `cmdRename()`
- [ ] When `--stats` is set, count tokens-to-rename, files-to-modify, and replacements-per-file without modifying anything, then print a summary table
- [ ] The summary includes: total map entries with changes (non-identity), total files with at least one match, per-file replacement count sorted by count descending

**Tests:**
- [ ] `bun run audit:tokens rename --map /tmp/test-rename-map.json --stats` prints a summary table
- [ ] The summary shows total tokens, total files, and per-file counts

**Checkpoint:**
- [ ] `bun run audit:tokens rename --map /tmp/test-rename-map.json --stats` exits 0
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes

---

#### Step 5: Add --verify mode to rename {#step-5}

**Depends on:** #step-3

**Commit:** `feat(audit-tokens): add --verify mode for post-rename stale reference detection`

**References:** Spec S03, Risk R01, (#success-criteria)

**Artifacts:**
- `--verify` flag handling in `cmdRename()`

**Tasks:**
- [ ] Add `--verify` flag detection in `cmdRename()` (requires `--map`)
- [ ] When `--verify` is set, scan all auto-discovered files using the SAME two regex patterns that `cmdRename` uses for replacement: (1) `--tug-base-{old-name}` with word-boundary lookahead `(?=[^\w-]|$)`, and (2) bare `"{old-name}"` with colon lookahead `(?=\s*:)`. Only check non-identity entries (where old-name differs from new-name). This ensures verify and rename are perfectly consistent — verify detects exactly the references that rename would change.
- [ ] Report every stale reference with file path (relative to `tugdeck/`), line number, and the old token name found
- [ ] Exit code 1 if any stale references remain, 0 if clean

**Tests:**
- [ ] `bun run audit:tokens rename --verify --map /tmp/test-rename-map.json` reports stale references (since we have not applied the rename, all old names still exist)
- [ ] After a hypothetical apply, verify would report zero stale references (tested in integration checkpoint)

**Checkpoint:**
- [ ] `bun run audit:tokens rename --verify --map /tmp/test-rename-map.json` exits 1 (expected — old names still present)
- [ ] Output includes file paths, line numbers, and old token names
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes

---

#### Step 6: Clean up and update help text {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `refactor(audit-tokens): update help text and docs for new subcommands`

**References:** [D02] Pure auto-discovery, [D06] Annotation and alias handling, (#specification)

**Artifacts:**
- Updated help text in the default switch case
- Updated file header comment

**Tasks:**
- [ ] Update the usage text in the default switch case to document `rename-map`, `--map`, `--verify`, `--stats`
- [ ] Update the file header JSDoc comment to include the `rename-map` subcommand
- [ ] Verify the `COMPONENT_CSS_FILES` array is still needed (used by `pairings`, `inject`, `verify`, `lint` subcommands — keep it)
- [ ] Verify the `COMPONENT_CSS_FILES` comment matches the actual array count and fix if mismatched

**Tests:**
- [ ] `bun run audit:tokens` (no subcommand) prints updated help text showing all options
- [ ] All existing subcommands still work: `tokens`, `pairings`, `rename`, `inject`, `verify`, `lint`

**Checkpoint:**
- [ ] `bun run audit:tokens` prints help text that includes `rename-map` and `--map`/`--verify`/`--stats` documentation
- [ ] `bun run audit:tokens rename-map` exits 0
- [ ] `bun run audit:tokens rename --map /tmp/test-rename-map.json --stats` exits 0
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes

---

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Seed map validated, [D02] Pure auto-discovery, [D03] Chromatic naming, [D04] Chromatic complete map, Spec S01, Spec S02, Spec S03, Spec S04, Spec S05, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify the full rename-map-to-verify pipeline works end-to-end
- [ ] Verify all 373 tokens are covered in the map
- [ ] Verify the chromatic tokens follow the three-slot convention from [D03]

**Tests:**
- [ ] End-to-end pipeline: generate map, preview stats, dry-run rename, verify stale refs — all exit codes match expectations

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map --json > /tmp/final-map.json` exits 0
- [ ] `bun run audit:tokens rename --map /tmp/final-map.json --stats` shows expected file and token counts
- [ ] `bun run audit:tokens rename --map /tmp/final-map.json` (dry run) shows all expected replacements
- [ ] `bun run audit:tokens rename --verify --map /tmp/final-map.json` exits 1 (old names still present — expected before actual Phase 3.5A rename)
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run audit:tokens pairings` shows zero unresolved
- [ ] `bun run audit:tokens verify` exits 0
- [ ] `bun test` passes (all 1891+ tests)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** An upgraded `audit-tokens.ts` with a `rename-map` subcommand that generates a complete 373-token rename map, and an enhanced `rename` subcommand with `--map`, `--verify`, and `--stats` modes — ready for Phase 3.5A to execute the actual rename.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run audit:tokens rename-map` produces a validated map covering all 373 tokens (exit 0)
- [ ] `bun run audit:tokens rename-map --json` outputs valid JSON with 373 entries
- [ ] `bun run audit:tokens rename --map <map.json>` loads and applies an external map
- [ ] `bun run audit:tokens rename --verify --map <map.json>` scans for stale references
- [ ] `bun run audit:tokens rename --stats --map <map.json>` shows blast radius summary
- [ ] Auto-discovery finds all token-referencing files (~86 files, no hardcoded list; excludes `audit-tokens.ts` itself)
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun test` passes (all 1891+ tests)

**Acceptance tests:**
- [ ] Generate map, preview rename, verify — full pipeline with zero errors on the tooling side
- [ ] Existing 7-entry `RENAME_MAP` still works as fallback when `--map` is not specified

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3.5A: Execute the actual rename using the map and tools built here
- [ ] Phase 3.5B: Design vocabulary updates (semantic text types, contrast roles, recipe inputs)
- [ ] Phase 3.5C: Formula field name spelling-out

| Checkpoint | Verification |
|------------|--------------|
| Rename map completeness | `bun run audit:tokens rename-map` exits 0 with zero validation errors |
| External map loading | `bun run audit:tokens rename --map <file>` exits 0 |
| Stale reference detection | `bun run audit:tokens rename --verify --map <file>` reports findings |
| Blast radius preview | `bun run audit:tokens rename --stats --map <file>` prints summary |
| All tests pass | `bun test` exits 0 |
