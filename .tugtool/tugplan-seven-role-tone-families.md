<!-- tugplan-skeleton v2 -->

## 7-Role Tone Families, Token Cleanup, and Derivation Engine Update {#seven-role-tone-families}

**Purpose:** Ship uniform 5-token tone families for all 7 color roles (accent, active, agent, data, success, caution, danger), clean up ~100 unused tokens from tug-base.css, and update the derivation engine, theme overrides, pairing map, and all tests to match.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | seven-role-tone-families |
| Last updated | 2026-03-13 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current tug theme system defines 4 chromatic tone families (positive, warning, danger, info) with 20 tokens, plus 12 ad-hoc accent tokens (9 unused). A March 2026 audit of tug-base.css found that 93 of 251 tokens (37%) are completely unused. The 7-role color system roadmap (seven-role-color-system.md) specifies a uniform 5-token tone family per role, renames for clarity (positive to success, warning to caution), merging INFO into ACTIVE, and adding three new roles (ACCENT, AGENT, DATA).

This plan implements Plan 1 from the roadmap: tone families, token cleanup, and derivation engine updates. It treats the token additions and the audit-driven removals as a single operation to avoid touching every file twice.

#### Strategy {#strategy}

- Rename existing tone families first (positive to success, warning to caution) so all consumers are updated before new families are added.
- Merge INFO into ACTIVE by redirecting the 2 tug-code.css consumers to --tug-base-tone-active, then deleting all 5 info tokens. Clean cut, no aliases.
- Add new tone families (accent, active, agent, data) to deriveTheme() using the same 5-token pattern as existing families.
- Remove unused tokens in bulk: accent interaction (9), avatar (3), range (9), scrollbar (3), focus ring (3), motion patterns (8), stroke widths (4), field tokens (6). Retain selected/highlighted tokens (active consumers in tug-data.css and tug-code.css) and field-bg/fg/border-readOnly tokens (active consumers in tug-input.css).
- Fix the --tug-base-accent-fg bug (3 references in gallery-theme-generator-content.css) by replacing with --tug-base-fg-onAccent.
- Audit component CSS for hardcoded pixel values; replace only exact token-value matches (targeted, not speculative).
- Rename ThemeRecipe fields to match new token names (success, caution, active) for clean consistency.
- Remove POC artifacts (poc-seven-role.css, poc-seven-role-cards.tsx, registrations in action-dispatch/css-imports/main) as the last step.
- Update fg-bg-pairing-map.ts, theme overrides (bluenote.css, harmony.css), and all test files throughout.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run build` completes with zero errors (no undefined CSS variable warnings, no TS errors)
- `bun test` passes all theme-derivation-engine, theme-accessibility, gallery-theme-generator-content, step8-roundtrip-integration, cvd-preview-auto-fix, and disconnect-banner tests
- `grep -r "tone-positive\|tone-warning\b\|tone-info" tugdeck/styles/ tugdeck/src/` returns zero matches (all old names removed)
- `grep -r "accent-strong\|accent-muted\|accent-bg-subtle\|accent-bg-emphasis\|accent-border[^-]\|accent-border-hover\|accent-underline-active\|accent-guide\|accent-flash" tugdeck/styles/tug-base.css` returns zero matches (9 unused accent tokens removed)
- `grep -r "poc-seven-role" tugdeck/` returns zero matches (POC artifacts removed)
- deriveTheme() output token count is approximately 234 (down from 264); tug-base.css static definitions approximately 221 (down from 251)
- All 7 tone families (accent, active, agent, data, success, caution, danger) produce 5 tokens each in deriveTheme() output (35 total tone tokens)

#### Scope {#scope}

1. Rename tone-positive to tone-success and tone-warning to tone-caution across all CSS, TS, and test files
2. Merge tone-info into tone-active (redirect 2 consumers, delete 5 tokens)
3. Add 3 new tone families to deriveTheme(): tone-accent (5 tokens), tone-agent (5 tokens), tone-data (5 tokens)
4. Add tone-active family (5 tokens, derived from primary/blue hue)
5. Remove ~50 unused tokens from tug-base.css and derivation engine (selected/highlighted and field readOnly variants retained — actively consumed)
6. Fix --tug-base-accent-fg bug (3 references)
7. Rename ThemeRecipe fields (positive to success, warning to caution, info removed, primary renamed to active, new agent/data fields added)
8. Update fg-bg-pairing-map.ts with new token names
9. Update bluenote.css and harmony.css theme overrides
10. Targeted pixel-to-token audit of component CSS
11. Update all tests
12. Remove POC artifacts

#### Non-goals (Explicitly out of scope) {#non-goals}

- Button emphasis x role control token restructuring (Plan 2)
- TugBadge component (Plan 2)
- Form field validation token wiring (Plan 3)
- Selection control role prop (Plan 3)
- Theme generator UI updates for 7-role hue pickers (Plan 3)
- Adding tokens speculatively for Phase 8 components not yet built

#### Dependencies / Prerequisites {#dependencies}

- Theme Generator (PR #117) must be merged (it is — commit 5d6dbc33)
- roadmap/seven-role-color-system.md exists with complete specifications

#### Constraints {#constraints}

- ThemeRecipe field rename is a breaking change to saved recipe JSON; existing saved recipes will fail to parse with new field names. Acceptable per user answer — clean and consistent.
- Must use `bun` for all JS/TS operations (never npm)
- React 19.2.4 — verify any lifecycle-dependent behavior against React 19 semantics

#### Assumptions {#assumptions}

- The 5 tone-accent tokens (tone-accent, tone-accent-bg, tone-accent-fg, tone-accent-border, tone-accent-icon) are a new addition alongside the 3 retained structural aliases (accent-default, accent-cool-default, accent-subtle), bringing the accent system to 8 tokens total.
- The --tug-base-accent-fg bug fix in gallery-theme-generator-content.css replaces 3 occurrences of var(--tug-base-accent-fg) with var(--tug-base-fg-onAccent) per the roadmap audit finding.
- The deriveTheme() function token count changes from 264 to reflect new tone family additions and token removals; the docstring and any test assertions about exact token counts must be updated.
- The disconnect-banner.tsx inline style fallback (--tug-base-tone-warning, #f59e0b) must also be updated to --tug-base-tone-caution when warning is renamed.
- POC artifacts are removed as the final step since Plan 1 replaces their purpose.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows all anchor and reference conventions from the skeleton. All headings use explicit `{#anchor-name}` anchors. Steps use `**References:**` lines citing decisions, specs, and anchors. Steps use `**Depends on:**` lines citing step anchors.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token count mismatch after changes | med | med | Compute expected count before implementing; validate in checkpoint | Test assertion fails on token count |
| Saved ThemeRecipe JSON breaks | low | high | Breaking change accepted per user answer; no migration needed for dev-only tool | User reports recipe load failure |
| Hardcoded pixel audit introduces regressions | med | low | Only replace exact matches; visual review in gallery after changes | Visual glitch reported |

**Risk R01: Token count drift** {#r01-token-count-drift}

- **Risk:** The 264-token count in deriveTheme() will change after additions and removals. If the new count is calculated wrong, test assertions will fail or tokens will be missing.
- **Mitigation:** Calculate the expected new count explicitly before implementing: 264 - 50 (removed) + 20 (added) = 234. Validate with a test assertion.
- **Residual risk:** Manual count errors; mitigated by checkpoint grep verification.

**Risk R02: CSS variable reference chains** {#r02-css-variable-chains}

- **Risk:** Some tokens reference other tokens via var(). Renaming or removing a token could break a reference chain that isn't caught by simple grep.
- **Mitigation:** After each rename step, run `bun run build` to catch undefined variable warnings. The PostCSS tug-color plugin validates at build time.
- **Residual risk:** Runtime-only references in inline styles (like disconnect-banner.tsx) won't be caught by build; addressed by explicit task for that file.

---

### Design Decisions {#design-decisions}

#### [D01] Rename ThemeRecipe fields to match new role names (DECIDED) {#d01-recipe-field-rename}

**Decision:** Rename ThemeRecipe interface fields: `positive` to `success`, `warning` to `caution`, `info` removed entirely, `primary` to `active`. Add new optional fields: `agent` and `data`.

**Rationale:**
- Clean consistency between recipe fields and CSS token names eliminates cognitive overhead
- Breaking change is acceptable because this is a dev-only tool with no external consumers

**Implications:**
- All ThemeRecipe construction sites must be updated
- Test fixtures with ThemeRecipe objects must be updated
- The gallery theme generator content component's recipe handling must be updated

#### [D02] INFO merge is a clean cut — no aliases (DECIDED) {#d02-info-clean-cut}

**Decision:** Replace the 2 references to --tug-base-tone-info in tug-code.css with --tug-base-tone-active directly. Delete all 5 info tokens. No backward-compatible aliases.

**Rationale:**
- Only 2 consumers exist, both in tug-code.css — trivial to redirect
- Aliases add maintenance burden for zero benefit when consumer count is this low

**Implications:**
- tug-code.css must be updated (file-status-renamed, feed-handoff)
- tone-info entries removed from tug-base.css, derivation engine, fg-bg-pairing-map, theme overrides, all tests
- Gallery theme generator tone swatch list must remove the Info entry

#### [D03] Focus ring tokens removed after grep verification (DECIDED) {#d03-focus-ring-removal}

**Decision:** Remove all 3 focus-ring tokens (focus-ring-default, focus-ring-danger, focus-ring-offset) after verifying no component CSS references them.

**Rationale:**
- Grep confirms: focus-ring tokens appear only in tug-base.css definitions, bluenote.css/harmony.css overrides, derivation engine, and test files — no component CSS consumption
- These tokens will be re-added per-component during Phase 8 focus management work

**Implications:**
- Remove from tug-base.css, bluenote.css, harmony.css, derivation engine, accessibility tests, pairing map

#### [D04] Targeted pixel-to-token audit — exact matches only (DECIDED) {#d04-pixel-audit-targeted}

**Decision:** Replace hardcoded pixel values in component CSS files only when the value exactly matches a defined token value (e.g., `8px` matches `--tug-base-space-md`). Leave non-standard values as-is.

**Rationale:**
- Avoids regressions from mismatched replacements
- Non-standard values exist for a reason (visual tuning that doesn't map to the scale)

**Implications:**
- Audit scope is limited to font-size, line-height, and spacing properties
- Each replacement must be verified against the token scale defined in tug-base.css

#### [D05] New tone families use existing hue derivation patterns (DECIDED) {#d05-tone-derivation-pattern}

**Decision:** New tone families (accent, active, agent, data) follow the same 5-token setChromatic() pattern as existing families (danger, and the renamed success/caution). The hue source for each: accent uses accentHue, active uses primaryHue, agent uses a new recipe field (default violet/280), data uses a new recipe field (default teal/170).

**Rationale:**
- Uniform derivation ensures all tone families respond consistently to signalVividity and mode changes
- Agent and data hues must be recipe-configurable so themes can customize them

**Implications:**
- ThemeRecipe gains optional `agent?: string` and `data?: string` fields with defaults
- deriveTheme() adds 20 new setChromatic() calls (4 families x 5 tokens)
- Tone token count increases by 15 net new (20 added for 4 new families, 5 removed for info deletion)

#### [D06] infoHue consumers switch to primaryHue (blue) — intentional visual change (DECIDED) {#d06-info-to-blue}

**Decision:** When removing infoHue, all tokens currently derived from it — fg-link, fg-link-hover, focus-ring-default, field-border-focus, selection-bg, and the highlight tokens — switch to primaryHue (blue, 230). This changes these tokens from cyan to blue, which is an intentional visual change aligning with the roadmap's ACTIVE role definition.

**Rationale:**
- The roadmap defines ACTIVE (blue, 230) as "interactive controls, focus rings, selection, links" — exactly the semantic purpose of fg-link, focus-ring, and field-border-focus
- Maintaining cyan for these tokens would contradict the roadmap and require an awkward "activeHue defaults to cyan" workaround
- The visual change (cyan to blue) is subtle and aligns with the unified ACTIVE role identity

**Implications:**
- fg-link and fg-link-hover change from cyan-derived to blue-derived
- focus-ring-default changes from cyan to blue (though it is removed later in Step 4 as unused; mentioned for completeness)
- field-border-focus changes from cyan to blue
- selection-bg and highlight tokens change from cyan to blue
- All these changes happen in Step 2 when infoHue is removed

#### [D07] Rename fg-onWarning to fg-onCaution for consistency (DECIDED) {#d07-fg-on-caution}

**Decision:** Rename --tug-base-fg-onWarning to --tug-base-fg-onCaution in tug-base.css, harmony.css, deriveTheme(), and fg-bg-pairing-map.ts as part of the Step 1 warning-to-caution rename.

**Rationale:**
- Consistency: all "warning" references become "caution" throughout the token system
- fg-onWarning is used in the pairing map and harmony.css override — both must be updated

**Implications:**
- tug-base.css definition renamed
- harmony.css override renamed
- deriveTheme() setChromatic call and comment updated
- fg-bg-pairing-map.ts entry updated

---

### Specification {#specification}

#### Token Inventory After Plan 1 {#token-inventory}

**Table T01: Tone token families after Plan 1** {#t01-tone-families}

| Role | Token prefix | Hue source | New/Renamed/Unchanged |
|------|-------------|------------|----------------------|
| accent | `--tug-base-tone-accent-*` | accentHue (orange 55) | New |
| active | `--tug-base-tone-active-*` | primaryHue (blue 230) | New |
| agent | `--tug-base-tone-agent-*` | agentHue (violet 280) | New |
| data | `--tug-base-tone-data-*` | dataHue (teal 170) | New |
| success | `--tug-base-tone-success-*` | successHue (green 140) | Renamed from positive |
| caution | `--tug-base-tone-caution-*` | cautionHue (yellow 90) | Renamed from warning |
| danger | `--tug-base-tone-danger-*` | destructiveHue (red 25) | Unchanged |

Each family produces 5 tokens: `tone-{role}`, `tone-{role}-bg`, `tone-{role}-fg`, `tone-{role}-border`, `tone-{role}-icon`. Total: 35 tone tokens.

**Table T02: Tokens removed in Plan 1** {#t02-tokens-removed}

| Token group | Tokens | Count |
|-------------|--------|-------|
| Accent interaction (unused) | accent-strong, accent-muted, accent-bg-subtle, accent-bg-emphasis, accent-border, accent-border-hover, accent-underline-active, accent-guide, accent-flash | 9 |
| Avatar | avatar-bg, avatar-fg, avatar-ring | 3 |
| Range | range-track, range-fill, range-thumb, range-thumb-disabled, range-tick, range-scrub-active, range-label, range-annotation, range-value | 9 |
| Scrollbar | scrollbar-track, scrollbar-thumb, scrollbar-thumb-hover | 3 |
| Focus ring | focus-ring-default, focus-ring-danger, focus-ring-offset | 3 |
| Motion patterns | motion-pattern-fade-enter, -fade-exit, -overlay-enter, -overlay-exit, -collapse, -expand, -crossfade, -startup-reveal | 8 |
| Stroke widths | stroke-hairline, stroke-thin, stroke-medium, stroke-thick | 4 |
| Field tokens (unused) | field-helper, field-meta, field-counter, field-limit, field-dirty, field-readOnly | 6 |
| Info tone family | tone-info, tone-info-bg, tone-info-fg, tone-info-border, tone-info-icon | 5 |
| **Total removed** | | **50** |

Note: field-bg-readOnly, field-fg-readOnly, and field-border-readOnly are RETAINED — they are actively consumed by tug-input.css for read-only input styling.

**Table T03: Tokens added in Plan 1** {#t03-tokens-added}

| Token group | Count |
|-------------|-------|
| tone-accent family (5) | 5 |
| tone-active family (5) | 5 |
| tone-agent family (5) | 5 |
| tone-data family (5) | 5 |
| **Total added** | **20** |

**Net change:** 264 - 50 + 20 = **234 tokens** in deriveTheme() (approximate — exact count validated in checkpoint). Note: tug-base.css has ~251 static definitions vs. deriveTheme()'s 264 generated tokens; the two counts differ because deriveTheme() generates some tokens (e.g., disabled variants) that tug-base.css defines differently. Both counts decrease proportionally.

**List L01: ThemeRecipe field changes** {#l01-recipe-fields}

- `positive?: string` renamed to `success?: string`
- `warning?: string` renamed to `caution?: string`
- `info?: string` removed (no replacement — active uses primaryHue)
- `primary?: string` renamed to `active?: string`
- `destructive?: string` unchanged (maps to danger tone family)
- `agent?: string` added (default: "violet")
- `data?: string` added (default: "teal")

**List L02: Files requiring changes** {#l02-affected-files}

- `tugdeck/styles/tug-base.css` — token definitions
- `tugdeck/styles/bluenote.css` — theme overrides
- `tugdeck/styles/harmony.css` — theme overrides
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — deriveTheme()
- `tugdeck/src/components/tugways/theme-accessibility.ts` — tone name references
- `tugdeck/src/components/tugways/fg-bg-pairing-map.ts` — pairing entries
- `tugdeck/src/components/tugways/tug-code.css` — info to active redirect, tone renames
- `tugdeck/src/components/tugways/tug-dock.css` — tone-warning to tone-caution rename (dock-button-fg-attention)
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — tone swatch list, accent-fg fix
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` — accent-fg fix
- `tugdeck/src/components/chrome/disconnect-banner.tsx` — warning to caution rename
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — token counts, tone names
- `tugdeck/src/__tests__/theme-accessibility.test.ts` — tone name exclusions
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — tone names
- `tugdeck/src/__tests__/step8-roundtrip-integration.test.ts` — tone-info roundtrip entry
- `tugdeck/src/__tests__/cvd-preview-auto-fix.test.tsx` — tone name references
- `tugdeck/src/__tests__/disconnect-banner.test.tsx` — warning to caution
- `tugdeck/styles/poc-seven-role.css` — removed
- `tugdeck/src/components/tugways/cards/poc-seven-role-cards.tsx` — removed
- `tugdeck/src/action-dispatch.ts` — POC registration removed
- `tugdeck/src/css-imports.ts` — POC import removed
- `tugdeck/src/main.tsx` — POC registration removed
- Component CSS files (targeted pixel audit): various files in `tugdeck/src/components/`

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify deriveTheme() produces correct token names and count | Token additions/removals/renames |
| **Integration** | Verify theme round-trip (export/import), accessibility checks, CVD simulation with new token names | After derivation engine changes |
| **Contract** | Verify tug-base.css token definitions match deriveTheme() output | After each step |
| **Drift Prevention** | Grep verification that old token names are fully removed | After rename/removal steps |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rename tone-positive to tone-success and tone-warning to tone-caution {#step-1}

<!-- Step 1 has no dependencies (it is the root) -->

**Commit:** `refactor: rename tone-positive to tone-success, tone-warning to tone-caution`

**References:** [D01] ThemeRecipe field rename, [D07] fg-onWarning rename, Table T01, List L01, List L02, (#token-inventory, #strategy, #context)

**Artifacts:**
- Updated token names in tug-base.css (10 tone tokens renamed: 5 positive to success, 5 warning to caution; plus fg-onWarning renamed to fg-onCaution)
- Updated bluenote.css and harmony.css overrides for renamed tokens (including fg-onWarning to fg-onCaution in harmony.css)
- Updated deriveTheme() in theme-derivation-engine.ts (setChromatic calls, variable names, ThemeRecipe fields: positive to success, warning to caution)
- Updated theme-accessibility.ts CVD_SEMANTIC_PAIRS (tone-positive to tone-success, tone-warning to tone-caution)
- Updated fg-bg-pairing-map.ts entries (tone renames plus fg-onWarning to fg-onCaution)
- Updated gallery-theme-generator-content.tsx tone swatch labels
- Updated gallery-theme-generator-content.css (all tone-positive/warning references)
- Updated disconnect-banner.tsx inline style from tone-warning to tone-caution
- Updated tug-code.css references (tone-positive/warning to success/caution)
- Updated all test files referencing old token names

**Tasks:**
- [ ] In tug-base.css: rename all `tone-positive-*` tokens to `tone-success-*` (5 tokens) and all `tone-warning-*` to `tone-caution-*` (5 tokens); rename `fg-onWarning` to `fg-onCaution`
- [ ] In bluenote.css/harmony.css: rename overrides for positive/warning to success/caution; rename `fg-onWarning` to `fg-onCaution` in harmony.css
- [ ] In theme-derivation-engine.ts: rename ThemeRecipe fields `positive` to `success`, `warning` to `caution`; rename internal variables (positiveHue to successHue, etc.); rename setChromatic calls for tone tokens and fg-onWarning
- [ ] In theme-accessibility.ts: update CVD_SEMANTIC_PAIRS to reference tone-success and tone-caution instead of tone-positive and tone-warning
- [ ] In fg-bg-pairing-map.ts: update all tone-positive/warning entries to tone-success/caution; update fg-onWarning entry to fg-onCaution
- [ ] In gallery-theme-generator-content.tsx: update tone swatch list labels and token references
- [ ] In gallery-theme-generator-content.css: rename all 15 tone-positive/warning token references to tone-success/caution
- [ ] In disconnect-banner.tsx: change `var(--tug-base-tone-warning, #f59e0b)` to `var(--tug-base-tone-caution, #f59e0b)`
- [ ] In disconnect-banner.test.tsx: update assertion for caution token name
- [ ] In tug-code.css: rename any tone-positive/warning references to success/caution
- [ ] In theme-derivation-engine.test.ts: update all positive/warning references to success/caution
- [ ] In theme-accessibility.test.ts: update tone name exclusion patterns
- [ ] In gallery-theme-generator-content.test.tsx: update token name references
- [ ] In step8-roundtrip-integration.test.ts: update tone entries
- [ ] In cvd-preview-auto-fix.test.tsx: update tone name references
- [ ] In tug-data.css, tug-dock.css: update any tone-positive/warning references

**Tests:**
- [ ] All existing theme tests pass with renamed tokens
- [ ] `grep -r "tone-positive\|tone-warning" tugdeck/` returns zero matches (excluding git history and node_modules)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with zero errors
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `grep -rn "tone-positive\|tone-warning" tugdeck/styles/ tugdeck/src/` returns zero matches

---

#### Step 2: Merge INFO into ACTIVE, add all 4 new tone families, update ThemeRecipe {#step-2}

**Depends on:** #step-1

**Commit:** `feat: merge info into active, add accent/active/agent/data tone families`

**References:** [D01] ThemeRecipe field rename, [D02] INFO clean cut, [D05] Tone derivation pattern, [D06] infoHue to blue, Table T01, Table T02, Table T03, List L01, List L02, (#token-inventory, #strategy)

**Artifacts:**
- 2 tug-code.css consumers redirected from tone-info to tone-active
- 5 info tokens removed from tug-base.css and derivation engine
- All infoHue-derived tokens (fg-link, fg-link-hover, field-border-focus, selection-bg, highlights) switched to primaryHue (blue) per [D06]
- ThemeRecipe updated: `info` removed, `primary` renamed to `active`, `agent` and `data` fields added
- 4 new tone families added to deriveTheme() and tug-base.css: tone-accent (5), tone-active (5), tone-agent (5), tone-data (5)
- fg-bg-pairing-map.ts updated: info entries removed, accent/active/agent/data entries added
- Gallery theme generator: Info swatch removed, Accent/Active/Agent/Data swatches added
- bluenote.css and harmony.css: info overrides removed, new tone family overrides added as needed
- All test files updated

**Tasks:**
- [ ] In theme-derivation-engine.ts: remove ThemeRecipe `info` field; rename `primary` to `active`; add `agent?: string` (default "violet") and `data?: string` (default "teal")
- [ ] In deriveTheme(): remove infoHue variable and its 5 tone-info setChromatic calls
- [ ] In deriveTheme(): switch all remaining infoHue consumers to use primaryHue (renamed to activeHue) per [D06]:
  - `fg-link` and `fg-link-hover` (line ~729-730) — change from infoHue to activeHue
  - `field-border-focus` (line ~1184) — change from infoHue to activeHue
  - `selection-bg` (line ~995) — change from infoHue to activeHue
  - `highlight-dropTarget`, `highlight-preview`, `highlight-inspectorTarget`, `highlight-snapGuide` (lines ~1017-1026) — change from infoHue to activeHue
  - `focus-ring-default` (line ~818) — change from infoHue to activeHue (this token is removed later in Step 3, but must compile in this step)
- [ ] In deriveTheme(): add hue resolution for agent and data hues
- [ ] Add 5 setChromatic calls for tone-accent (using accentHue — tone family tokens, separate from structural accent-default/accent-cool-default/accent-subtle aliases)
- [ ] Add 5 setChromatic calls for tone-active (using activeHue)
- [ ] Add 5 setChromatic calls for tone-agent (using agentHue)
- [ ] Add 5 setChromatic calls for tone-data (using dataHue)
- [ ] In tug-base.css: remove all 5 tone-info-* token definitions; add tone-active (5), tone-accent (5), tone-agent (5), tone-data (5) families with appropriate --tug-color() values
- [ ] In tug-code.css: change `var(--tug-base-tone-info)` to `var(--tug-base-tone-active)` for file-status-renamed and feed-handoff
- [ ] Update deriveTheme() docstring with new token count
- [ ] In bluenote.css/harmony.css: remove tone-info override entries; add overrides for new tone families if theme-specific hue adjustments are needed
- [ ] In fg-bg-pairing-map.ts: remove tone-info entries; add pairing entries for tone-accent, tone-active, tone-agent, tone-data families
- [ ] In gallery-theme-generator-content.tsx: remove Info swatch; add Accent, Active, Agent, Data swatches to tone list
- [ ] In theme-accessibility.ts: update any references to info tokens
- [ ] In theme-accessibility.test.ts: update exclusion list (remove tone-info-bg, add tone-active-bg)
- [ ] In all test files: remove tone-info references; update ThemeRecipe construction sites (active instead of primary, remove info); add tone-active/accent/agent/data references where appropriate
- [ ] In step8-roundtrip-integration.test.ts: remove tone-info roundtrip entry

**Tests:**
- [ ] All theme tests pass with new tone families and without info tokens
- [ ] `grep -r "tone-info" tugdeck/styles/ tugdeck/src/` returns zero matches
- [ ] theme-derivation-engine.test.ts: verify deriveTheme() output contains all 35 tone tokens (7 roles x 5)
- [ ] theme-derivation-engine.test.ts: update token count assertion to new count
- [ ] Verify new tone tokens have correct hue derivation (accent from accentHue, active from activeHue/blue, agent from violet, data from teal)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `grep -rn "tone-info" tugdeck/styles/ tugdeck/src/` returns zero matches
- [ ] Verify 35 tone tokens in deriveTheme() output (7 roles x 5 tokens)

---

#### Step 3: Remove unused tokens from tug-base.css and derivation engine {#step-3}

**Depends on:** #step-2

**Commit:** `refactor: remove 45 unused tokens from tug-base.css and derivation engine`

**References:** [D03] Focus ring removal, Table T02, List L02, (#token-inventory, #strategy)

**Artifacts:**
- 45 tokens removed from tug-base.css (9 accent interaction + 3 avatar + 9 range + 3 scrollbar + 3 focus ring + 8 motion patterns + 4 stroke widths + 6 field tokens). Note: the 5 info tokens were already removed in Step 2, so this step removes 50 - 5 = 45.
- Corresponding setChromatic/set* calls removed from deriveTheme()
- bluenote.css and harmony.css overrides for removed tokens cleaned up
- fg-bg-pairing-map.ts entries for removed tokens cleaned up (specific entries: accent-strong pairings at ~lines 216, 299; accent-bg-subtle pairing at ~line 596; focus-ring-default/danger/offset pairings; avatar-bg/fg/ring pairings; range-track/fill/thumb/tick/scrub-active/label/annotation/value pairings; scrollbar-track/thumb/thumb-hover pairings; motion-pattern pairings; stroke-hairline/thin/medium/thick pairings; field-helper/meta/counter/limit/dirty/readOnly pairings)
- theme-accessibility.test.ts exclusion lists updated
- Token count docstring updated
- RETAINED (actively consumed): selected/highlighted tokens (tug-data.css, tug-code.css), field-bg-readOnly/field-fg-readOnly/field-border-readOnly (tug-input.css)

**Tasks:**
- [ ] Grep to confirm zero component CSS usage for each token group before removing:
  - `grep -rn "accent-strong\|accent-muted\|accent-bg-subtle\|accent-bg-emphasis\|accent-border[^-]\|accent-border-hover\|accent-underline-active\|accent-guide\|accent-flash" tugdeck/src/components/`
  - `grep -rn "avatar-bg\|avatar-fg\|avatar-ring" tugdeck/src/components/`
  - `grep -rn "range-track\|range-fill\|range-thumb\|range-tick\|range-scrub\|range-label\|range-annotation\|range-value\|scrollbar-track\|scrollbar-thumb" tugdeck/src/components/`
  - `grep -rn "focus-ring" tugdeck/src/components/` (excluding test files)
  - `grep -rn "motion-pattern-" tugdeck/src/components/`
  - `grep -rn "stroke-hairline\|stroke-thin\|stroke-medium\|stroke-thick" tugdeck/src/components/`
  - `grep -rn "field-helper\|field-meta\|field-counter\|field-limit\|field-dirty" tugdeck/src/components/` (note: field-readOnly standalone token is unused in CSS but field-bg/fg/border-readOnly are consumed by tug-input.css and retained)
- [ ] If any grep reveals unexpected usage, do NOT remove that token — flag it for investigation
- [ ] Remove token definitions from tug-base.css section by section
- [ ] Remove corresponding generation code from theme-derivation-engine.ts
- [ ] Remove overrides from bluenote.css and harmony.css (including focus-ring-offset overrides in both files)
- [ ] Remove entries from fg-bg-pairing-map.ts (specific entries to remove: accent-strong pairings at ~lines 216, 299; accent-bg-subtle pairing at ~line 596; focus-ring-default/danger/offset pairings; avatar pairings; range/scroll pairings; motion-pattern pairings; stroke pairings; field-helper/meta/counter/limit/dirty/readOnly pairings)
- [ ] Update token count in deriveTheme() docstring
- [ ] Update theme-accessibility.test.ts exclusion lists for removed tokens (including accent-strong exclusion at ~line 149)
- [ ] Update theme-derivation-engine.test.ts token count assertions

**Tests:**
- [ ] All theme tests pass with reduced token set
- [ ] Verify no component CSS references removed tokens

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] Verify actual token count matches expected: post-Step-2 count is ~279 (264 - 5 info + 20 new families), minus 45 removed in this step = ~234 in deriveTheme()

---

#### Step 4: Fix accent-fg bug and targeted pixel-to-token audit {#step-4}

**Depends on:** #step-3

**Commit:** `fix: replace undefined accent-fg with fg-onAccent, replace exact pixel matches with tokens`

**References:** [D04] Targeted pixel audit, List L02, (#token-inventory, #strategy, #assumptions)

**Artifacts:**
- 3 occurrences of var(--tug-base-accent-fg) in gallery-theme-generator-content.css replaced with var(--tug-base-fg-onAccent)
- Hardcoded pixel values in component CSS replaced with token references (exact matches only)

**Tasks:**
- [ ] In gallery-theme-generator-content.css: replace all 3 instances of `var(--tug-base-accent-fg)` with `var(--tug-base-fg-onAccent)`
- [ ] Audit component CSS files for hardcoded pixel values that exactly match token values:
  - Font sizes: 10px (--tug-base-font-size-2xs), 11px (--tug-base-font-size-xs), 12px (--tug-base-font-size-sm), 13px (--tug-base-font-size-base), 14px (--tug-base-font-size-md), 16px (--tug-base-font-size-lg), etc.
  - Spacing: 2px (--tug-base-space-2xs), 4px (--tug-base-space-xs), 6px (--tug-base-space-sm), 8px (--tug-base-space-md), 12px (--tug-base-space-lg), 16px (--tug-base-space-xl), 24px (--tug-base-space-2xl), 32px (--tug-base-space-3xl), 48px (--tug-base-space-4xl)
  - Border radius: check for exact matches to --tug-base-radius-* tokens
- [ ] Only replace values where the semantic intent clearly matches the token purpose (e.g., padding: 8px is likely --tug-base-space-md; but width: 8px on a decorative element might not be)
- [ ] Leave non-standard values as-is (e.g., 3px, 7px, 11px for spacing)
- [ ] Note: tug-dialog.css line 28 defines `--tug-badge-accent-fg: var(--tug-base-accent-default)` — this is a component-level alias, not the undefined accent-fg bug. Leave it as-is.

**Tests:**
- [ ] `grep -rn "accent-fg" tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` returns zero matches
- [ ] Visual review: gallery theme generator renders correctly

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `cd tugdeck && bun test` — all tests pass

---

#### Step 5: Remove POC artifacts {#step-5}

**Depends on:** #step-4

**Commit:** `chore: remove 7-role POC artifacts`

**References:** [D02] INFO clean cut, List L02, (#non-goals, #strategy, #assumptions)

**Artifacts:**
- `tugdeck/styles/poc-seven-role.css` deleted
- `tugdeck/src/components/tugways/cards/poc-seven-role-cards.tsx` deleted
- POC import removed from `tugdeck/src/css-imports.ts`
- POC registration removed from `tugdeck/src/main.tsx`
- POC card IDs and menu registration removed from `tugdeck/src/action-dispatch.ts`

**Tasks:**
- [ ] Delete `tugdeck/styles/poc-seven-role.css`
- [ ] Delete `tugdeck/src/components/tugways/cards/poc-seven-role-cards.tsx`
- [ ] In `tugdeck/src/css-imports.ts`: remove the `import "../styles/poc-seven-role.css"` line
- [ ] In `tugdeck/src/main.tsx`: remove the `import { registerPocCards }` line and its `registerPocCards()` call
- [ ] In `tugdeck/src/action-dispatch.ts`: remove the `import { POC_CARD_IDS }` line and any menu item registration that references POC cards
- [ ] Verify no other files reference poc-seven-role

**Tests:**
- [ ] `grep -r "poc-seven-role" tugdeck/` returns zero matches
- [ ] Build succeeds without POC artifacts

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `grep -rn "poc-seven-role" tugdeck/src/ tugdeck/styles/` returns zero matches

---

#### Step 6: Final Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] ThemeRecipe field rename, [D02] INFO clean cut, [D03] Focus ring removal, [D04] Targeted pixel audit, [D05] Tone derivation pattern, [D06] infoHue to blue, [D07] fg-onCaution rename, Table T01, Table T02, Table T03, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all 7 tone families produce correct tokens in deriveTheme() output
- [ ] Verify no old token names remain anywhere in the codebase
- [ ] Verify token count matches expected value
- [ ] Verify POC artifacts are fully removed
- [ ] Verify tug-base.css, bluenote.css, harmony.css are self-consistent

**Tests:**
- [ ] `cd tugdeck && bun test` — full test suite passes (aggregate verification of all steps)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with zero errors
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `grep -rn "tone-positive\|tone-warning\|tone-info" tugdeck/styles/ tugdeck/src/` returns zero matches
- [ ] `grep -rn "accent-strong\|accent-muted\|accent-bg-subtle\|accent-bg-emphasis\|accent-border[^-]\|accent-border-hover\|accent-underline-active\|accent-guide\|accent-flash" tugdeck/styles/tug-base.css` returns zero matches
- [ ] `grep -rn "poc-seven-role" tugdeck/` returns zero matches
- [ ] `grep -rn "accent-fg" tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` returns zero matches
- [ ] `grep -rn "fg-onWarning" tugdeck/styles/ tugdeck/src/` returns zero matches
- [ ] Count deriveTheme() output tokens and verify approximately 234 (264 - 50 removed + 20 added); count tug-base.css definitions and verify approximately 221 (251 - 50 removed + 20 added)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All 7 color roles have uniform 5-token tone families generated by deriveTheme(), ~100 unused tokens are removed, old names (positive/warning/info) are fully eliminated, ThemeRecipe uses clean role names, and POC artifacts are removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run build` succeeds with zero errors
- [ ] `bun test` passes all tests
- [ ] 35 tone tokens (7 x 5) present in deriveTheme() output
- [ ] Zero references to tone-positive, tone-warning, or tone-info in styles/ and src/
- [ ] Zero references to poc-seven-role in tugdeck/
- [ ] deriveTheme() output token count is approximately 234 (264 - 50 removed + 20 added); tug-base.css static definitions approximately 221 (251 - 50 removed + 20 added)
- [ ] ThemeRecipe fields use new role names (success, caution, active, agent, data)

**Acceptance tests:**
- [ ] theme-derivation-engine.test.ts passes with updated token count and all 7 tone families verified
- [ ] theme-accessibility.test.ts passes with updated tone exclusion patterns
- [ ] gallery-theme-generator-content.test.tsx passes with new swatch list
- [ ] step8-roundtrip-integration.test.ts passes with updated tone entries
- [ ] disconnect-banner.test.tsx passes with caution token name

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Plan 2: Button emphasis x role control tokens and TugBadge component
- [ ] Plan 3: Form field validation token wiring, selection control role prop, theme generator 7-role UI
- [ ] Phase 8 components will re-add tokens as needed (avatar, range/scroll, focus ring, etc.)

| Checkpoint | Verification |
|------------|--------------|
| Tone families complete | 35 tone tokens in deriveTheme() output |
| Old names eliminated | grep returns zero matches for positive/warning/info |
| Unused tokens removed | deriveTheme() ~234 tokens, tug-base.css ~221 definitions |
| POC removed | grep returns zero matches for poc-seven-role |
| All tests pass | `bun test` exits 0 |
