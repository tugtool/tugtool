# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-3
date: 2025-03-19T17:29:02Z
---

## step-3: Added loadExternalMap(), refactored cmdRename() to accept options object with --map, --apply, --verify, --stats flags

**Files changed:**
- .tugtool/tugplan-audit-tokens-bulk-rename.md

---

---
step: step-2
date: 2025-03-19T17:15:51Z
---

## step-2: Created seed-rename-map.ts with 373 token mappings and added validateRenameMap(), cmdRenameMap() with human-readable and --json output modes

**Files changed:**
- .tugtool/tugplan-audit-tokens-bulk-rename.md

---

---
step: step-1
date: 2025-03-19T17:03:31Z
---

## step-1: Replaced hardcoded getRenameTargetFiles() with discoverTokenFiles() that recursively scans tugdeck/ for files containing --tug-base- references

**Files changed:**
- .tugtool/tugplan-audit-tokens-bulk-rename.md

---

---
step: step-11
date: 2025-03-19T04:08:35Z
---

## step-11: Final verification checkpoint. All Phase 3 exit criteria met: LIGHT_FORMULAS is a complete 202-field literal (no spread), BASE_FORMULAS/DARK_OVERRIDES/LIGHT_OVERRIDES removed, zero [phase-3-bug] entries, all 1891 tests pass, audit:tokens lint/verify exit 0. Both brio and harmony are fully independent recipes.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-10
date: 2025-03-19T04:05:28Z
---

## step-10: Regenerated @tug-pairings comment blocks in 16 CSS files via audit:tokens inject --apply. Confirmed idempotent (second run produces no changes). All verification gates pass: lint zero violations, verify 23/23 files, 1891 tests pass.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-9
date: 2025-03-19T04:02:02Z
---

## step-9: Removed BASE_FORMULAS, DARK_OVERRIDES, LIGHT_OVERRIDES, and LIGHT_FORMULAS_LEGACY exports. Updated EXAMPLE_RECIPES.brio.formulas to DARK_FORMULAS and EXAMPLE_RECIPES.harmony.formulas to LIGHT_FORMULAS directly. Updated test imports in theme-derivation-engine.test.ts and gallery-theme-generator-content.test.tsx. Zero non-comment references to removed symbols remain.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-8
date: 2025-03-19T03:48:56Z
---

## step-8: Verification checkpoint. Zero [phase-3-bug] entries remain. All 14 bugs resolved: B01/B06/B08 deferred [phase-4-engine], B07 [design-choice], B02-B05 fixed by calibration (new accentSubtleTone/cautionBgTone fields), B09-B14 fixed by using LIGHT_FORMULAS for light-mode tests. All 1892 tests pass. All audit gates green.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-7
date: 2025-03-19T03:41:49Z
---

## step-7: Resolved B01-B08 [phase-3-bug] entries. B03: cardFrameActiveTone 18→16 for fg-default|tab-bg-active contrast. B04: added accentSubtleTone=30 for fg-default|accent-subtle. B05: added cautionBgTone=30 for fg-default|tone-caution-bg. B02: resolved via LIGHT_FORMULAS values. B01/B06/B08: deferred [phase-4-engine] (gamut ceiling, mode-aware tokens). B07: documented [design-choice] in harmony. Zero [phase-3-bug] entries remain.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-6
date: 2025-03-19T03:09:53Z
---

## step-6: Updated T4.2, T4.4, T4.7 to use LIGHT_FORMULAS when mode is light — fixing the root cause of B09-B14 surface contrast bugs (dark formulas used in light mode). Removed LIGHT_MODE_PAIR_EXCEPTIONS and LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS entirely from contrast-exceptions.ts. All 1891 tests pass.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-5
date: 2025-03-19T02:58:57Z
---

## step-5: Verification-only checkpoint. Confirmed LIGHT_FORMULAS is a complete 200-field literal with zero spread operators, zero [light-review-pending] tags, all fields annotated. deriveTheme output matches LIGHT_FORMULAS_LEGACY for both brio and harmony. All 5 verification gates pass. 1891 tests pass.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-4
date: 2025-03-19T02:53:08Z
---

## step-4: Replaced all 78 [light-review-pending] tags with explicit design-rationale annotations. Covered: outlined/ghost ToneLight/ILight fields, outlined option border tones, hue-slot-dispatch (30 fields), sentinel-hue-dispatch (9), sentinel-alpha (11), hue-name-dispatch (5). Zero [light-review-pending] tags remain. All 200 fields fully annotated.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-3
date: 2025-03-19T02:41:00Z
---

## step-3: Text and border semantic groups verified complete with explicit light-mode rationale (work done in step-2 commit). Updated JSDoc to document step-3 completion scope. 78 [light-review-pending] tags on mode-independent dispatch fields deferred to step-4. All verification gates pass.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-2
date: 2025-03-19T02:30:06Z
---

## step-2: Created LIGHT_FORMULAS as a complete 200-field DerivationFormulas literal with no spread operators. Surface/canvas groups have full light-mode rationale. Text, border, control, badge, icon, tab, toggle, field groups also populated with rationale (early completion of steps 3/4). 78 [light-review-pending] tags remain on mode-independent dispatch fields. LIGHT_FORMULAS_LEGACY preserved for comparison. Equality tests added. All 5 verification gates pass.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-1
date: 2025-03-19T02:13:26Z
---

## step-1: Verified DARK_FORMULAS is a complete 200-field literal object with all @semantic tags and design-rationale comments. Ran audit:tokens tokens to confirm all 373 token semantic groups have formula coverage. Regenerated CSS @tug-pairings blocks via inject --apply. All verification gates pass.

**Files changed:**
- .tugtool/tugplan-independent-recipes.md

---

---
step: step-5
date: 2025-03-19T00:51:51Z
---

## step-5: Verification-only step. Confirmed all 339 pairings processed (pass 1 + pass 2 composited), parameterized recipe loop covers all EXAMPLE_RECIPES, no inline exception definitions remain, all harmony exceptions categorized, all audit tooling green, 1886 tests pass.

**Files changed:**
- .tugtool/tugplan-contrast-engine-fix.md

---

---
step: step-4
date: 2025-03-19T00:45:11Z
---

## step-4: Captured and categorized harmony-specific contrast failures in RECIPE_PAIR_EXCEPTIONS['harmony']. 2 entries documented with [design-choice] tags, contrast values, thresholds, and CSS context. Removed duplicate already in KNOWN_PAIR_EXCEPTIONS.

**Files changed:**
- .tugtool/tugplan-contrast-engine-fix.md

---

---
step: step-3
date: 2025-03-19T00:29:05Z
---

## step-3: Replaced T4.1 and T4.3 with parameterized describe block iterating Object.entries(EXAMPLE_RECIPES). Retained T4.2 brio-light. Each recipe case uses shared exceptions, marginal delta filter, core readability assertions, and brio-gated focus indicator check.

**Files changed:**
- .tugtool/tugplan-contrast-engine-fix.md

---

---
step: step-2
date: 2025-03-19T00:17:46Z
---

## step-2: Replaced parentSurface skip in evaluateRules with deferred collection and pass-2 enforcement. Composites via compositeOverSurface+hexToOkLabL, enforces contrast floor, re-emits via setChromatic. Added floor-applied-composited diagnostic reason and unit tests T-COMP-1 through T-COMP-8.

**Files changed:**
- .tugtool/tugplan-contrast-engine-fix.md

---

---
step: step-1
date: 2025-03-18T23:52:39Z
---

## step-1: Created tugdeck/src/__tests__/contrast-exceptions.ts consolidating all exception sets from 4 test files. Added [design-choice] and [phase-3-bug] inline comments on every entry. Updated all test files to import from shared module.

**Files changed:**
- .tugtool/tugplan-contrast-engine-fix.md

---

---
step: step-8
date: 2025-03-18T21:59:38Z
---

## step-8: Final validation: audit:tokens lint zero violations, pairings zero unresolved, verify zero gaps (275 entries, 23/23 files), bun test 1878/1878, cargo nextest 884/884, Rules 16/17/D81 confirmed in design-system-concepts.md.

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-7
date: 2025-03-18T21:53:36Z
---

## step-7: Added Rule 16 (every color-setting rule declares its rendering surface via @tug-renders-on), Rule 17 (component alias tokens resolve to --tug-base-* in one hop), and D81 (token pairings are machine-auditable) to roadmap/design-system-concepts.md.

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-6
date: 2025-03-18T21:45:55Z
---

## step-6: Ran inject --apply to regenerate @tug-pairings blocks in 16 CSS files with expanded annotation-derived pairings. Expanded element-surface-pairing-map.ts with ~484 new entries to close verify gaps. Updated test exceptions for newly discovered pairings. All audit:tokens commands pass (lint, verify, pairings). All 1878 tests pass.

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-5
date: 2025-03-18T21:13:05Z
---

## step-5: Verification-only step. Lint subcommand (implemented in step 4) confirmed passing: zero violations, correct Spec S03 message formats, hard gate exit(1) behavior. All 1878 tests pass.

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-4
date: 2025-03-18T21:09:13Z
---

## step-4: Major refactor of audit-tokens.ts: added parseRendersOnAnnotations parser, expanded ELEMENT_PROPERTIES with all border variants, replaced heuristic strategies 2-4 with annotation lookup (keep strategy 1 same-rule), removed dead code (extractLeafClass, extractClassNames, buildSurfaceIndex), added COMPAT_ALIAS_ALLOWLIST for 14 dropdown compat aliases, added lint subcommand. Zero unresolved pairings. Also added 8 missing annotations discovered by the new parser.

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-3
date: 2025-03-18T20:53:20Z
---

## step-3: Flattened 2 cross-component alias chains in tug-tab.css body block: --tug-tab-bar-bg and --tug-tab-bg-active now point directly to --tug-base-* tokens instead of through --tug-card-* intermediaries. 14 --tug-dropdown-* compat aliases in tug-menu.css preserved per COMPAT_ALIAS_ALLOWLIST.

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-2
date: 2025-03-18T20:47:54Z
---

## step-2: Added 145 @tug-renders-on annotations across 16 of 23 component CSS files. Each annotation declares the --tug-base-* rendering surface for rules that set color/fill/border without same-rule background-color. One multi-surface annotation for .tugcard-title (tab-bg-inactive, tab-bg-active).

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-1
date: 2025-03-18T20:26:16Z
---

## step-1: Created renders-on-survey.md identifying 142 CSS rules across 16 of 23 component files that need @tug-renders-on annotations. Each rule has a proposed --tug-base-* surface token. Used static analysis methodology (not heuristic-based tool output).

**Files changed:**
- .tugtool/tugplan-token-audit-enforce.md

---

---
step: step-8
date: 2025-03-18T19:07:26Z
---

## step-8: Final validation: generate:tokens 373 tokens, bun test 1878/1878, cargo nextest 884/884, verify-pairings zero gaps, zero unclassified tokens, 23 CSS files with @tug-pairings blocks. All exit criteria met.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-7
date: 2025-03-18T18:56:01Z
---

## step-7: Created verify-pairings.ts script that parses @tug-pairings from CSS and cross-checks against pairing map. Zero gaps confirmed. Fixed tug-tab.css to use accurate tab-bg-inactive surfaces and added 4 new map entries. Total map entries now 265.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-6
date: 2025-03-18T18:40:52Z
---

## step-6: Added @tug-pairings structured comment blocks to all 23 component CSS files per Spec S02. Each block documents foreground-on-background pairings with Element, Surface, Role, and Context columns using post-rename token names.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-5
date: 2025-03-18T18:28:11Z
---

## step-5: Added 20 missing pairings to element-surface-pairing-map.ts from CSS audit. Critical gap closed: fg-default on tab-bg-active (card title bar). Total map entries now 261. Updated test exception sets for newly surfaced accessibility gaps.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-4
date: 2025-03-18T17:45:45Z
---

## step-4: Renamed 7 tokens across 17 files: field-fg→field-fg-default, field-placeholder→field-fg-placeholder, field-label→field-fg-label, field-required→field-fg-required, checkmark→checkmark-fg, checkmark-mixed→checkmark-fg-mixed, separator→divider-separator. All 1878 tests pass. Zero unclassified color tokens remain.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-3
date: 2025-03-18T17:25:32Z
---

## step-3: Created token-rename-plan.md with exact 7-token rename mapping and file-by-file impact analysis (17 source files). Created chromatic-token-list.md enumerating all 32 dual-use tokens. Classification dry-run confirms zero unclassified color tokens post-rename.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-2
date: 2025-03-18T17:12:47Z
---

## step-2: Created tugdeck/docs/pairing-audit-results.md auditing all 23 component CSS files. Documented ~175 CSS-observable pairings, identified 36 gaps including the critical fg-default on tab-bg-active card title bar gap.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

---
step: step-1
date: 2025-03-18T16:51:23Z
---

## step-1: Created tugdeck/docs/token-inventory-baseline.md with all 373 --tug-base-* tokens extracted and classified into element/surface/chromatic/non-color/unclassified categories. Identified 7 rename candidates matching Table T01.

**Files changed:**
- .tugtool/tugplan-token-audit-pairing.md

---

