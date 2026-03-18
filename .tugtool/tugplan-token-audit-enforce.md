<!-- tugplan-skeleton v2 -->

## Phase 1.5: Make Token Pairings Machine-Auditable {#token-audit-enforce}

**Purpose:** Eliminate the 104 unresolved pairings in audit-tokens.ts by adding `@tug-renders-on` CSS annotations (including for `border` shorthand rules) and a `lint` subcommand, so that Phase 2 work can lean on deterministic tooling instead of heuristic-based grep/bash exploration.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | token-audit-enforce |
| Last updated | 2026-03-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Phase 1 audit-tokens.ts script (commit 47b50170) extracts token pairings from CSS in under 100ms, but 104 of 362 pairings (29%) are unresolved because static CSS cannot express "I render on whatever my parent provides." The 4-strategy heuristic (same-rule, ancestor prefix, class-name extension, class-name truncation) is clever but fundamentally limited by missing information. Strategies 2-4 are guesses; when they guess wrong, pairings go unresolved or resolve incorrectly.

The fix is to put the missing information directly in the CSS via `@tug-renders-on` annotations, then enforce completeness with a lint subcommand. This makes every foreground-on-background pairing deterministically extractable from CSS alone, enabling Phase 2 to trust the tool output without manual verification.

#### Strategy {#strategy}

- Add `@tug-renders-on` annotations to ~130 CSS rules that set `color`/`fill`/`border-color`/`border` (shorthand)/directional border shorthands/directional border-color longhands without setting `background-color` in the same rule, making their rendering surface explicit.
- Flatten alias chains in component CSS `body {}` blocks to 1 hop (every component alias points directly to its `--tug-base-*` target), with an exemption for deliberate backward-compat alias layers.
- Replace heuristic strategies 2-4 in the `pairings` subcommand with `@tug-renders-on` annotation parsing, keeping only strategy 1 (same-rule match).
- Add a `lint` subcommand that hard-fails on violations: missing annotations, multi-hop alias chains, missing `@tug-pairings` blocks, unresolved pairings.
- Enhance the `inject` subcommand to include pairings from `@tug-renders-on` annotations (currently skips unresolved ones).
- Codify the new conventions as Rule 16, Rule 17, and D81 in `design-system-concepts.md`.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run audit:tokens lint` exits 0 with zero violations (how to measure: run the command)
- `bun run audit:tokens pairings` reports zero unresolved pairings (how to measure: grep output for "unresolved")
- `bun run audit:tokens verify` exits 0 with zero gaps (how to measure: run the command)
- All existing tests pass: `bun test` and `cd tugcode && cargo nextest run` (how to measure: run both)
- Rules 16, 17 and D81 are present in `roadmap/design-system-concepts.md` (how to measure: grep for "Rule 16", "Rule 17", "D81")

#### Scope {#scope}

1. Add `@tug-renders-on` annotations to ~130 CSS rules across the 23 component CSS files that set `color`/`fill`/`border-color`/`border` (shorthand)/directional border shorthands/directional border-color longhands without a same-rule `background-color`
2. Flatten alias chains to 1 hop in component CSS `body {}` blocks (~10 files), with backward-compat alias layer exemption
3. Add `lint` subcommand to `audit-tokens.ts` that enforces annotation completeness, alias chain depth, `@tug-pairings` block presence, and zero unresolved pairings
4. Replace heuristic strategies 2-4 in `pairings` subcommand with `@tug-renders-on` parsing
5. Enhance `inject` subcommand to include annotation-derived pairings
6. Add Rule 16, Rule 17, and D81 to `roadmap/design-system-concepts.md`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the contrast engine algorithm or enforcement logic (Phase 2)
- Modifying recipe formulas or `DerivationFormulas` interface (Phase 3)
- Adding new tokens that do not already exist in the system
- Changing the `@tug-pairings` comment block format (established in Phase 1)
- Renaming any tokens (completed in Phase 1)

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 (tugplan-token-audit-pairing) must be complete: token rename done, `@tug-pairings` blocks present in all 23 CSS files, pairing map updated, verify script functional
- audit-tokens.ts exists with `tokens`, `pairings`, `rename`, `inject`, `verify` subcommands (commit 47b50170)

#### Constraints {#constraints}

- `@tug-renders-on` annotations must be parseable by the existing `parseRules` infrastructure in audit-tokens.ts (comments are currently stripped; the parser must read annotations before stripping)
- The `lint` subcommand must exit 1 on any violation, consistent with the existing `verify` subcommand behavior
- Only alias chains in the explicit compat allowlist (`COMPAT_ALIAS_ALLOWLIST` in audit-tokens.ts) are exempt from 1-hop flattening; all other multi-hop chains must be flattened

#### Assumptions {#assumptions}

- The `@tug-renders-on` annotation format is exactly `/* @tug-renders-on: --tug-base-{surface} */` and the lint parser will match this specific syntax
- The existing 23 component CSS files listed in `COMPONENT_CSS_FILES` are the complete scope — no new files need to be added
- The `@tug-renders-on` annotation is the single source of truth for rendering surface; `@tug-pairings` blocks become derived outputs, not inputs
- The tug-card.css aliases (e.g., `--tug-card-title-bar-bg-active` -> `--tug-base-tab-bg-active`) are already 1-hop and do not require flattening
- Rules 16, 17, and D81 will be inserted following Rule 14 (the current last rule) in design-system-concepts.md, but numbered 16 and 17 per the user's explicit numbering request
- `outline` and `box-shadow` properties are excluded from element property scanning: `outline` is used for transient focus rings (not persistent contrast-critical UI), and `box-shadow` colors are decorative depth cues that do not create foreground-on-background text/icon readability pairings. Note: tug-tab.css uses `inset box-shadow` as a visual border substitute — this is a known exception that does not require annotation because the inset shadow color is a decorative accent indicator, not a text/icon readability pairing

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` anchors on all headings that are referenced elsewhere. All anchors are kebab-case, lowercase, no phase numbers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Annotation count is higher than ~130 | low | medium | Start with a survey pass; adjust scope if count exceeds 160 | Survey step reveals > 160 rules |
| Some CSS rules genuinely render on multiple surfaces | medium | medium | Multi-surface annotation syntax supports comma-separated surfaces | Lint reports false positives |
| Alias chains have hidden compat dependencies | medium | low | Audit all chains before flattening; preserve compat exemptions | Flattening breaks a component at runtime |

**Risk R01: Annotation count exceeds estimate** {#r01-annotation-count}

- **Risk:** The ~130 estimate for rules needing `@tug-renders-on` may be too low, expanding scope. The estimate includes ~60 rules setting `color`/`fill`/`border-color`, ~60 rules using `border` shorthand with color tokens, and ~10 rules using directional border shorthands or directional border-color longhands.
- **Mitigation:**
  - Step 1 performs a survey to get the exact count before any annotation work begins
  - If count exceeds 160, batch the annotation work into groups by component file
- **Residual risk:** Higher count means more manual work but no architectural risk.

**Risk R02: Multi-surface rules create ambiguous pairings** {#r02-multi-surface}

- **Risk:** Some foreground tokens genuinely render on different surfaces depending on parent state (e.g., active vs inactive tab), creating multiple valid pairings per annotation.
- **Mitigation:**
  - The annotation syntax explicitly supports multi-surface: `/* @tug-renders-on: --tug-base-tab-bg-active, --tug-base-tab-bg-inactive */`
  - Each listed surface generates a separate pairing entry
- **Residual risk:** A rule may render on a surface not known at annotation time (e.g., dynamically injected parent).

**Risk R03: Flattening alias chains breaks compat layers** {#r03-alias-flatten}

- **Risk:** Some multi-hop alias chains exist for backward compatibility; flattening them could break components that rely on the intermediate alias.
- **Mitigation:**
  - Only aliases in the explicit `COMPAT_ALIAS_ALLOWLIST` are exempt from flattening (documented in [D02])
  - The allowlist is code-reviewed, so accidental exemptions are unlikely
  - Cross-component chains (e.g., tug-tab -> tug-card) are intentionally NOT exempt and must be flattened
- **Residual risk:** A runtime-only dependency on an intermediate alias could surface after flattening; visual spot-checks mitigate this.

---

### Design Decisions {#design-decisions}

#### [D01] @tug-renders-on is the single source of truth for rendering surface (DECIDED) {#d01-renders-on-source}

**Decision:** The `@tug-renders-on` annotation in CSS rule comments is the authoritative declaration of what surface a foreground token renders on. The `@tug-pairings` comment blocks become derived outputs generated by the `inject` subcommand, not manually maintained inputs.

**Rationale:**
- Heuristic strategies 2-4 are fundamentally limited by missing information — they guess which ancestor sets the background
- Putting the information at the rule level (where the foreground property is set) is the most local and maintainable location
- Making `@tug-pairings` blocks derived from annotations + same-rule matches eliminates the possibility of annotation/block drift

**Implications:**
- Every CSS rule that sets `color`, `fill`, `border-color`, `border` (shorthand containing a color token), directional border shorthands (`border-top`, `border-right`, `border-bottom`, `border-left`) containing a color token, `border-top-color`, `border-right-color`, `border-bottom-color`, `border-left-color`, or `-webkit-text-fill-color` and does NOT set `background-color` in the same rule must have a `@tug-renders-on` annotation
- Rules that set both foreground and background are self-documenting (strategy 1 / same-rule match) and need no annotation
- The `inject` subcommand regenerates `@tug-pairings` blocks from annotations + same-rule matches
- The `lint` subcommand enforces annotation presence

#### [D02] Alias chains flatten to 1 hop with explicit compat allowlist (DECIDED) {#d02-alias-flatten}

**Decision:** Every component alias token in a CSS `body {}` block must point directly to its `--tug-base-*` target in one hop. Only alias chains explicitly listed in a `COMPAT_ALIAS_ALLOWLIST` constant in audit-tokens.ts are exempt. The only currently known compat layer is `--tug-dropdown-*` -> `--tug-menu-*` (14 alias entries covering bg, fg, border, shadow, item-bg-hover, item-bg-selected, item-fg, item-fg-disabled, item-fg-danger, item-meta, item-shortcut, item-icon, item-icon-danger, item-chevron). Cross-component dependency chains (e.g., `--tug-tab-bar-bg` -> `--tug-card-title-bar-bg-inactive` -> `--tug-base-tab-bg-inactive`) are NOT exempt and must be flattened.

**Rationale:**
- Multi-hop alias chains make it impossible to statically resolve a component token to its `--tug-base-*` target without executing the chain
- The audit tool's `resolveToken` function already follows chains, but chains introduce fragility and make CSS harder to read
- A naming-convention heuristic (e.g., "source and target share no common prefix") is too broad — it would falsely exempt cross-component dependencies like `tug-tab` -> `tug-card` that should be flattened
- An explicit allowlist ensures only intentional compat layers are exempt, and new exemptions require a deliberate decision

**Implications:**
- ~10 CSS files need alias flattening in their `body {}` blocks, including tug-tab.css which has cross-component chains to tug-card tokens
- The lint subcommand checks alias chain depth against the explicit allowlist
- Adding a new compat exemption requires updating `COMPAT_ALIAS_ALLOWLIST` in audit-tokens.ts

#### [D03] Lint subcommand is the hard gate; pairings subcommand is soft (DECIDED) {#d03-lint-hard-gate}

**Decision:** The `lint` subcommand exits with code 1 on any violation and is the enforcement gate. The `pairings` subcommand reports unresolved pairings as warnings but does not fail, preserving its role as a diagnostic/exploration tool.

**Rationale:**
- The `pairings` subcommand is useful for exploratory analysis even when annotations are incomplete
- A hard-failing lint is appropriate for CI enforcement
- Separating enforcement from exploration avoids making the diagnostic tool unusable during incremental annotation work

**Implications:**
- `bun run audit:tokens lint` is the command that CI/pre-commit would run
- `bun run audit:tokens pairings` remains a diagnostic tool with soft warnings
- Exit criteria require lint to pass, not pairings to have zero warnings (though both should be true at phase exit)

#### [D04] Heuristic strategies 2-4 are replaced, not augmented (DECIDED) {#d04-replace-heuristics}

**Decision:** Heuristic strategies 2-4 (ancestor prefix, class-name extension, class-name truncation) in `findSurfaceForSelector` are removed and replaced with `@tug-renders-on` annotation parsing. Strategy 1 (same-rule match) is retained.

**Rationale:**
- The heuristics produced 104 unresolved pairings and an unknown number of incorrect resolutions
- Annotations are deterministic — they cannot guess wrong
- Keeping the heuristics alongside annotations would create two resolution paths with potential conflicts
- Removing dead code simplifies the tool

**Implications:**
- `findSurfaceForSelector` becomes a two-strategy function: same-rule match, then `@tug-renders-on` annotation lookup
- Any rule without same-rule bg and without annotation will report as unresolved
- The transition period (partially annotated) will show more unresolved pairings than the heuristic did, but they will be honest unresolveds

---

### Specification {#specification}

#### @tug-renders-on Annotation Format {#annotation-format}

**Spec S01: @tug-renders-on Annotation** {#s01-renders-on}

The annotation is a CSS comment placed immediately before the CSS rule it applies to:

```css
/* @tug-renders-on: --tug-base-surface-default */
.tugcard-title {
  color: var(--tug-card-title-bar-fg);
}
```

Multi-surface variant (for rules that render on different surfaces depending on state):

```css
/* @tug-renders-on: --tug-base-tab-bg-active, --tug-base-tab-bg-inactive */
.tugcard-title-bar .tugcard-close-icon {
  fill: var(--tug-card-title-bar-icon-active);
}
```

Rules:
- The annotation is a `/* ... */` comment, NOT a `/** ... */` docblock
- It must appear on the line(s) immediately preceding the CSS rule it annotates, with no intervening comments between the annotation and the rule's opening brace (whitespace-only lines are allowed)
- The value is one or more full `--tug-base-*` token names, comma-separated
- Each listed surface generates a separate pairing entry in the tool output
- Rules that set `background-color` in the same rule do NOT need an annotation (they are self-documenting)
- The annotation parser reads comments BEFORE the rule stripper removes them

#### Alias Chain Rules {#alias-chain-rules}

**Spec S02: Alias Chain Depth Enforcement** {#s02-alias-chains}

In component CSS `body {}` blocks:

```css
/* VALID: 1-hop alias */
body {
  --tug-card-bg: var(--tug-base-surface-overlay);
}

/* INVALID: multi-hop alias (--tug-card-bg resolves through intermediate) */
body {
  --tug-card-bg: var(--tug-card-surface);  /* intermediate alias */
  --tug-card-surface: var(--tug-base-surface-overlay);
}

/* EXEMPT: compat layer (final hop resolves to --tug-base-*) */
body {
  --tug-dropdown-bg: var(--tug-menu-bg);       /* compat alias */
  --tug-menu-bg: var(--tug-base-surface-overlay); /* final hop to base */
}
```

Rules:
- Every component alias must resolve to a `--tug-base-*` token
- Direct 1-hop resolution is required unless the alias is listed in `COMPAT_ALIAS_ALLOWLIST`
- The allowlist is an explicit constant in audit-tokens.ts, currently containing the `--tug-dropdown-*` -> `--tug-menu-*` compat layer (14 alias entries)
- Cross-component dependency chains (e.g., `--tug-tab-bar-bg` -> `--tug-card-title-bar-bg-inactive`) are NOT compat layers and must be flattened
- The lint subcommand reports multi-hop chains that are not in the allowlist

#### Lint Subcommand Checks {#lint-checks}

**Spec S03: Lint Enforcement Rules** {#s03-lint-rules}

The `lint` subcommand performs four checks:

1. **Annotation completeness:** Every CSS rule that sets any element property from `ELEMENT_PROPERTIES` (see below) and does NOT set `background-color` in the same rule must have a `@tug-renders-on` annotation. `ELEMENT_PROPERTIES` includes: `color`, `fill`, `border-color`, `border` (shorthand containing a color token), directional border shorthands (`border-top`, `border-right`, `border-bottom`, `border-left`) containing a color token, directional border-color longhands (`border-top-color`, `border-right-color`, `border-bottom-color`, `border-left-color`), and `-webkit-text-fill-color`. Violation message: `MISSING_ANNOTATION: {file}:{selector} sets {property} without background-color and has no @tug-renders-on`

2. **Alias chain depth:** No multi-hop alias chains in `body {}` blocks (compat layers exempt). Violation message: `MULTI_HOP_ALIAS: {file}: {alias} resolves through {count} hops (max 1)`

3. **@tug-pairings block presence:** Every CSS file in `COMPONENT_CSS_FILES` must contain a `@tug-pairings` comment block. Violation message: `MISSING_PAIRINGS_BLOCK: {file}`

4. **Zero unresolved pairings:** After annotation parsing, no pairings may have an unresolved surface. Violation message: `UNRESOLVED_PAIRING: {file}:{selector} — {element_token} has no deterministic surface`

Exit code: 0 if zero violations; 1 if any violation found. All violations are printed before exit.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/docs/renders-on-survey.md` | Survey of all CSS rules needing `@tug-renders-on` annotations, grouped by file |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `cmdLint` | fn | `tugdeck/scripts/audit-tokens.ts` | New lint subcommand implementation |
| `parseRendersOnAnnotations` | fn | `tugdeck/scripts/audit-tokens.ts` | Parses `@tug-renders-on` comments from CSS text, returns map of selector -> surface tokens |
| `checkAnnotationCompleteness` | fn | `tugdeck/scripts/audit-tokens.ts` | Lint check: every fg rule without same-rule bg has annotation |
| `checkAliasChainDepth` | fn | `tugdeck/scripts/audit-tokens.ts` | Lint check: no multi-hop alias chains (compat exempt) |
| `checkPairingsBlockPresence` | fn | `tugdeck/scripts/audit-tokens.ts` | Lint check: every CSS file has @tug-pairings block |
| `checkZeroUnresolved` | fn | `tugdeck/scripts/audit-tokens.ts` | Lint check: no unresolved pairings after annotation parsing |
| `parseRules` | fn (modify) | `tugdeck/scripts/audit-tokens.ts` | Add whitespace collapsing to selector normalization: `.trim().replace(/\s+/g, ' ')` |
| `findSurfaceForSelector` | fn (modify) | `tugdeck/scripts/audit-tokens.ts` | Replace strategies 2-4 with annotation lookup |
| `cmdInject` | fn (modify) | `tugdeck/scripts/audit-tokens.ts` | Include annotation-derived pairings |
| `COMPAT_ALIAS_ALLOWLIST` | const | `tugdeck/scripts/audit-tokens.ts` | Explicit allowlist of exempt compat alias chains (currently `--tug-dropdown-*` -> `--tug-menu-*`, 14 entries) |
| `ELEMENT_PROPERTIES` | const (modify) | `tugdeck/scripts/audit-tokens.ts` | Unify all border variants: add `border`, `border-top`, `border-right`, `border-bottom`, `border-left`, `border-top-color`, `border-right-color`, `border-bottom-color`, `border-left-color`; remove the separate border-shorthand code blocks in `cmdPairings` and `cmdInject` |
| `extractLeafClass` | fn (remove) | `tugdeck/scripts/audit-tokens.ts` | Dead after strategy 2-4 removal |
| `extractClassNames` | fn (remove) | `tugdeck/scripts/audit-tokens.ts` | Dead after strategy 2-4 removal |
| `buildSurfaceIndex` | fn (remove) | `tugdeck/scripts/audit-tokens.ts` | Dead after strategy 2-4 removal (strategy 1 checks same-rule directly) |

---

### Documentation Plan {#documentation-plan}

- [ ] Add Rule 16 (every color-setting rule declares its rendering surface) to `roadmap/design-system-concepts.md`
- [ ] Add Rule 17 (component alias tokens resolve to --tug-base-* in one hop) to `roadmap/design-system-concepts.md`
- [ ] Add D81 (token pairings are machine-auditable) to `roadmap/design-system-concepts.md`
- [ ] Update audit-tokens.ts file-level docblock to document the `lint` subcommand

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Integration** | Run `lint`, `pairings`, `verify`, `inject` subcommands and check exit codes and output | Every step that modifies audit-tokens.ts |
| **Golden / Contract** | Verify lint output format matches Spec S03 violation messages | After lint implementation |
| **Drift Prevention** | `bun run audit:tokens lint` in CI catches new rules missing annotations | After all annotations are in place |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Survey CSS rules needing @tug-renders-on annotations {#step-1}

**Commit:** `chore(tokens): survey CSS rules needing @tug-renders-on annotations`

**References:** [D01] @tug-renders-on source of truth, [D04] Replace heuristics, Spec S01, (#context, #strategy, #scope)

**Artifacts:**
- `tugdeck/docs/renders-on-survey.md` — list of every CSS rule across the 23 component files that sets any element property (`color`/`fill`/`border-color`/`border` shorthand/directional border shorthands/directional border-color longhands/`-webkit-text-fill-color`) without a same-rule `background-color`, grouped by file, with the surface token that should be annotated

**Tasks:**
- [ ] For each of the 23 CSS files in `COMPONENT_CSS_FILES`, parse all rules and identify those that set an element property (including `border` shorthand, directional border shorthands like `border-bottom`, and directional border-color longhands like `border-bottom-color`, all containing a color token) without a same-rule surface property
- [ ] For each identified rule, determine the correct rendering surface by examining the component's DOM structure, parent selectors, and existing `@tug-pairings` block
- [ ] Record the rule's selector, the element property, the element token, and the correct `--tug-base-*` surface token
- [ ] Count the total rules needing annotation (expected: ~130 — approximately ~60 for color/fill/border-color, ~60 for border shorthand, and ~10 for directional border shorthands/longhands)
- [ ] Identify any rules that render on multiple surfaces (needing comma-separated annotations)

**Tests:**
- [ ] Survey document lists a count for each of the 23 files
- [ ] Total count is recorded and compared against the ~130 estimate

**Checkpoint:**
- [ ] `renders-on-survey.md` exists with all 23 files covered
- [ ] Every identified rule has a proposed surface token

---

#### Step 2: Add @tug-renders-on annotations to component CSS files {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tokens): add @tug-renders-on annotations to component CSS files`

**References:** [D01] @tug-renders-on source of truth, Spec S01, (#annotation-format, #scope)

**Artifacts:**
- All 23 component CSS files updated with `@tug-renders-on` annotations before every rule identified in Step 1

**Tasks:**
- [ ] For each rule identified in the survey, add a `/* @tug-renders-on: --tug-base-{surface} */` comment immediately before the rule's selector line. The annotation must be placed AFTER any section-header comments (e.g., `/* --- Hover states --- */`) and immediately before the CSS rule selector, with no intervening comments — only whitespace-only lines are allowed between annotation and selector per Spec S01
- [ ] For rules rendering on multiple surfaces, use comma-separated syntax per Spec S01
- [ ] Verify annotations do not break CSS parsing (no syntax errors)
- [ ] Spot-check 5 annotations against the component DOM to confirm correctness

**Tests:**
- [ ] CSS files parse without errors (no build failures)
- [ ] `grep -rc "@tug-renders-on" tugdeck/src/components/tugways/ --include="*.css"` total count matches the survey total (use `-r` for recursive matching to include `cards/*.css`)

**Checkpoint:**
- [ ] All rules from the survey have annotations
- [ ] `bun run check` passes (TypeScript/CSS compilation)
- [ ] `bun test` passes

---

#### Step 3: Flatten alias chains to 1 hop in component CSS body blocks {#step-3}

**Depends on:** #step-1

**Commit:** `refactor(tokens): flatten alias chains to 1 hop in component CSS`

**References:** [D02] Alias chain flattening, Spec S02, (#alias-chain-rules, #constraints)

**Artifacts:**
- ~10 component CSS files updated with flattened alias chains in `body {}` blocks

**Tasks:**
- [ ] For each of the 23 CSS files, inspect the `body {}` block for alias chains (a component alias that points to another component alias instead of directly to `--tug-base-*`)
- [ ] Flatten each multi-hop chain to point directly to the `--tug-base-*` target — this includes cross-component chains like `--tug-tab-bar-bg: var(--tug-card-title-bar-bg-inactive)` in tug-tab.css, which must become `--tug-tab-bar-bg: var(--tug-base-tab-bg-inactive)`
- [ ] Similarly flatten `--tug-tab-bg-active: var(--tug-card-title-bar-bg-active)` to `--tug-tab-bg-active: var(--tug-base-tab-bg-active)` in tug-tab.css
- [ ] Preserve only aliases listed in `COMPAT_ALIAS_ALLOWLIST` (currently `--tug-dropdown-*` -> `--tug-menu-*`, 14 entries)
- [ ] Verify no runtime CSS resolution is broken by checking that the resolved value is unchanged

**Tests:**
- [ ] `bun run check` passes
- [ ] `bun test` passes
- [ ] No component alias in any `body {}` block resolves through more than 1 hop (except exempt compat layers)

**Checkpoint:**
- [ ] All non-exempt alias chains are 1-hop
- [ ] `bun test` passes
- [ ] Visual spot-check of 3 components confirms no rendering change

---

#### Step 4: Implement @tug-renders-on annotation parser in audit-tokens.ts {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tokens): add @tug-renders-on annotation parser to audit-tokens.ts`

**References:** [D01] @tug-renders-on source of truth, [D04] Replace heuristics, Spec S01, (#annotation-format, #symbols)

**Artifacts:**
- New `parseRendersOnAnnotations` function in `audit-tokens.ts`
- Modified `findSurfaceForSelector` function — strategies 2-4 replaced with annotation lookup

**Tasks:**
- [ ] Implement `parseRendersOnAnnotations(css: string): Map<string, string[]>` with this algorithm: (1) match each `/* @tug-renders-on: ... */` comment via regex; (2) from the end of the match, scan forward past whitespace only (no intervening comments allowed per Spec S01) to find the next `selector {` block — if a `/*` comment is encountered before a selector, emit a warning and skip this annotation; (3) extract the selector text up to `{`; (4) normalize the selector by trimming and collapsing all internal whitespace (newlines, tabs, multiple spaces) to single spaces via `.trim().replace(/\s+/g, ' ')`. This same normalization must also be applied in `parseRules` (change `m[1].trim()` to `m[1].trim().replace(/\s+/g, ' ')`) so that both parsers produce identical selector strings for multi-line selectors; (5) parse the annotation value as comma-separated `--tug-base-*` tokens; (6) return a `Map<string, string[]>` mapping normalized selector to its surface token array
- [ ] The parser must handle multi-surface annotations (comma-separated)
- [ ] The parser must read annotations BEFORE the comment-stripping step in `parseRules` — call `parseRendersOnAnnotations` on the raw CSS, then strip comments for `parseRules`
- [ ] Modify `findSurfaceForSelector` to use a two-strategy approach: (1) same-rule match (check if the rule itself sets `background-color`), (2) annotation lookup (check the annotation map for the selector). Remove the `surfaceIndex` parameter — it is no longer needed
- [ ] Unify all border variant handling into `ELEMENT_PROPERTIES`: add `border`, `border-top`, `border-right`, `border-bottom`, `border-left`, `border-top-color`, `border-right-color`, `border-bottom-color`, `border-left-color` to the `ELEMENT_PROPERTIES` set. Remove the separate border-shorthand code blocks in `cmdPairings` (lines 607-625) and `cmdInject` (lines 956-975) — all element property scanning now uses a single `ELEMENT_PROPERTIES` loop
- [ ] Remove dead code from strategy 2-4 removal: `extractLeafClass` (fn, remove), `extractClassNames` (fn, remove), `buildSurfaceIndex` (fn, remove). These are no longer called after heuristic removal
- [ ] Remove all `buildSurfaceIndex` calls in `cmdPairings` and `cmdInject`

**Tests:**
- [ ] `bun run audit:tokens pairings` runs without errors
- [ ] Unresolved pairing count drops to zero (all 104 previously unresolved pairings now resolved via annotations)
- [ ] Previously resolved pairings (from strategy 1) remain unchanged
- [ ] Multi-line selector annotation matching works correctly: verify that an annotation before a multi-line selector (e.g., `.foo,\n.bar { color: ... }`) correctly associates with the normalized selector

**Checkpoint:**
- [ ] `bun run audit:tokens pairings` reports zero unresolved pairings
- [ ] Output pairing count is >= the previous total (no pairings lost)

---

#### Step 5: Implement lint subcommand in audit-tokens.ts {#step-5}

**Depends on:** #step-4, #step-3

**Commit:** `feat(tokens): add lint subcommand to audit-tokens.ts`

**References:** [D03] Lint hard gate, Spec S03, (#lint-checks, #symbols)

**Artifacts:**
- New `cmdLint` function and supporting check functions in `audit-tokens.ts`
- Updated CLI help text and main switch statement

**Tasks:**
- [ ] Implement `checkAnnotationCompleteness`: for each CSS file, parse rules and verify every rule that sets an element property (from the expanded `ELEMENT_PROPERTIES` set including directional border shorthands/longhands) without a same-rule `background-color` has a `@tug-renders-on` annotation
- [ ] Implement `checkAliasChainDepth`: for each CSS file, parse `body {}` aliases and verify no multi-hop chains (compat layers exempt)
- [ ] Implement `checkPairingsBlockPresence`: verify every file in `COMPONENT_CSS_FILES` has a `@tug-pairings` block
- [ ] Implement `checkZeroUnresolved`: run pairing extraction and verify zero unresolved pairings
- [ ] Implement `cmdLint` that runs all four checks, collects violations, prints them, and exits 1 if any found
- [ ] Add `lint` case to the main CLI switch and update the help text
- [ ] Violation messages must match the format in Spec S03

**Tests:**
- [ ] `bun run audit:tokens lint` exits 0 with zero violations (after all annotations and flattening are in place)
- [ ] Temporarily removing an annotation causes lint to report a `MISSING_ANNOTATION` violation and exit 1
- [ ] Temporarily adding a multi-hop alias causes lint to report a `MULTI_HOP_ALIAS` violation

**Checkpoint:**
- [ ] `bun run audit:tokens lint` exits 0
- [ ] Lint output format matches Spec S03 message patterns

---

#### Step 6: Enhance inject subcommand to include annotation-derived pairings {#step-6}

**Depends on:** #step-4

**Commit:** `feat(tokens): enhance inject subcommand with annotation-derived pairings`

**References:** [D01] @tug-renders-on source of truth, (#symbols, #scope)

**Artifacts:**
- Modified `cmdInject` function in `audit-tokens.ts`
- Regenerated `@tug-pairings` blocks in all 23 CSS files (via `inject --apply`)

**Tasks:**
- [ ] Modify `cmdInject` to use the annotation-aware `findSurfaceForSelector` (which now uses annotations instead of heuristics)
- [ ] Previously, `cmdInject` skipped unresolvable pairings — now all pairings should resolve via annotations, so no skipping should occur
- [ ] Run `bun run audit:tokens inject --apply` to regenerate all `@tug-pairings` blocks
- [ ] Verify the regenerated blocks include pairings that were previously skipped (the 104 unresolved ones)

**Tests:**
- [ ] `bun run audit:tokens inject` (dry run) reports zero skipped pairings
- [ ] `bun run audit:tokens verify` passes after injection

**Checkpoint:**
- [ ] `bun run audit:tokens inject --apply` succeeds
- [ ] `bun run audit:tokens verify` exits 0
- [ ] Pairing count in `@tug-pairings` blocks is higher than before (includes previously unresolved)

---

#### Step 7: Add Rule 16, Rule 17, and D81 to design-system-concepts.md {#step-7}

**Depends on:** #step-5

**Commit:** `docs(design): add Rule 16, Rule 17, and D81 for machine-auditable token pairings`

**References:** [D01] @tug-renders-on source of truth, [D02] Alias chain flattening, [D03] Lint hard gate, (#documentation-plan, #scope)

**Artifacts:**
- Updated `roadmap/design-system-concepts.md` with Rule 16, Rule 17, and D81

**Tasks:**
- [ ] Add Rule 16 to the Rules of Tugways section: "Every color-setting rule declares its rendering surface. If a CSS rule sets color, fill, or border-color and does NOT set background-color in the same rule, it must include a @tug-renders-on annotation. Rules that set both are self-documenting. audit-tokens lint enforces this. [D81]"
- [ ] Add Rule 17: "Component alias tokens resolve to --tug-base-* in one hop. No alias-to-alias chains. Deliberate backward-compat alias layers are exempt, but the final alias in any chain must point directly to --tug-base-*. audit-tokens lint flags multi-hop chains. [D81]"
- [ ] Add D81 to the design decisions table and section: "Token pairings are machine-auditable. Every foreground-on-background rendering relationship is deterministically extractable from CSS alone — either via same-rule background-color or via @tug-renders-on annotation. audit-tokens lint enforces this."
- [ ] Update the design decisions summary table to include D81

**Tests:**
- [ ] `grep "Rule 16" roadmap/design-system-concepts.md` returns a match
- [ ] `grep "Rule 17" roadmap/design-system-concepts.md` returns a match
- [ ] `grep "D81" roadmap/design-system-concepts.md` returns a match

**Checkpoint:**
- [ ] All three additions are present in the file
- [ ] The file renders correctly as markdown (no broken formatting)

---

#### Step 8: Final validation checkpoint {#step-8}

**Depends on:** #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] @tug-renders-on source of truth, [D02] Alias chain flattening, [D03] Lint hard gate, [D04] Replace heuristics, Spec S01, Spec S02, Spec S03, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run `bun run audit:tokens lint` and confirm zero violations, exit 0
- [ ] Run `bun run audit:tokens pairings` and confirm zero unresolved pairings
- [ ] Run `bun run audit:tokens verify` and confirm zero gaps, exit 0
- [ ] Run `bun test` and confirm all tests pass
- [ ] Run `cd tugcode && cargo nextest run` and confirm all tests pass
- [ ] Confirm Rules 16, 17 and D81 are in `roadmap/design-system-concepts.md`

**Tests:**
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run audit:tokens pairings` — zero "unresolved" in output
- [ ] `bun run audit:tokens verify` exits 0
- [ ] `bun test` passes
- [ ] `cargo nextest run` passes

**Checkpoint:**
- [ ] All five verification commands pass
- [ ] All exit criteria met

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Machine-enforceable token pairing completeness — every foreground-on-background rendering relationship is deterministically extractable from CSS alone via `@tug-renders-on` annotations and same-rule matching, enforced by `audit-tokens lint` with zero violations.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run audit:tokens lint` passes with zero violations (`bun run audit:tokens lint; echo $?` → 0)
- [ ] `bun run audit:tokens pairings` reports zero unresolved pairings (grep output for "unresolved")
- [ ] `bun run audit:tokens verify` reports zero gaps (`bun run audit:tokens verify; echo $?` → 0)
- [ ] All existing tests pass (`bun test` and `cd tugcode && cargo nextest run`)
- [ ] Rules 16, 17 and D81 are in `roadmap/design-system-concepts.md`

**Acceptance tests:**
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run audit:tokens pairings` — zero unresolved in output
- [ ] `bun run audit:tokens verify` exits 0
- [ ] `bun test` passes
- [ ] `cd tugcode && cargo nextest run` passes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: Fix the contrast engine to enforce all pairings (including composited surfaces)
- [ ] Phase 3: Build independent recipes using the complete pairing map for validation
- [ ] Add `audit:tokens lint` to CI/pre-commit hooks
- [ ] Auto-generate `@tug-pairings` blocks in a pre-commit hook (lint + inject --apply)

| Checkpoint | Verification |
|------------|--------------|
| Annotations complete | `bun run audit:tokens lint` — zero MISSING_ANNOTATION violations |
| Alias chains flattened | `bun run audit:tokens lint` — zero MULTI_HOP_ALIAS violations |
| Zero unresolved pairings | `bun run audit:tokens pairings` — zero unresolved |
| Cross-check passes | `bun run audit:tokens verify` exits 0 |
| All tests pass | `bun test && cd tugcode && cargo nextest run` |
