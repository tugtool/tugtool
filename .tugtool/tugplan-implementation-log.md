# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-2
date: 2025-03-15T16:55:24Z
---

## step-2: Refactored autoAdjustContrast with 4th pairingMap param, SAFETY_CAP=20 replacing MAX_ITERATIONS=3, convergence detection, per-token oscillation guards, Lc sign-based bump direction, and full re-validation via validateThemeContrast. Added T3.8 oscillation, T3.9 convergence, T3.10 cascade tests.

**Files changed:**
- .tugtool/tugplan-perceptual-contrast-conformance.md

---

---
step: step-1
date: 2025-03-15T16:38:34Z
---

## step-1: Renamed all symbols from WCAG-normative/fg-bg naming to Lc-normative/element-surface naming across 11 files. Flipped normative pass/fail gate from WCAG ratio to Lc threshold, increased large-text threshold from 45 to 60.

**Files changed:**
- .tugtool/tugplan-perceptual-contrast-conformance.md

---

---
step: step-8
date: 2025-03-15T01:17:28Z
---

## step-8: Final verification checkpoint: 1566 tests pass, generation idempotent, build succeeds, CSS structure correct. Plan tugplan-mode-preset-formulas complete.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-7
date: 2025-03-15T01:14:00Z
---

## step-7: Restructured tug-base.css body{} with hand-authored preamble (zoom, chart aliases, shiki bridge) and single @generated:tokens:begin/end region covering all 350 tokens. Removed old control-tokens and chrome-tokens markers. Generation is idempotent.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-6
date: 2025-03-15T01:05:53Z
---

## step-6: Added ModePreset interface and DARK_PRESET/LIGHT_PRESET constants. Refactored deriveTheme() to use preset.paramName references instead of inline isLight ternaries for ~40 numeric parameters. Hue-selection branches remain as isLight code per D03. Output unchanged — T-BRIO-MATCH passes.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-5
date: 2025-03-15T00:53:35Z
---

## step-5: Verification-only checkpoint: T-BRIO-MATCH passes with 0 mismatches across all 291 chromatic tokens. All 13 derivation-engine tests green.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-4
date: 2025-03-15T00:51:07Z
---

## step-4: Activated T-BRIO-MATCH test: it.todo replaced with real assertion. All 291 chromatic tokens match deriveTheme(brio) output exactly. 1564 tests pass, 0 fail.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-3
date: 2025-03-15T00:45:32Z
---

## step-3: Fixed makeShadowToken verbose black form (D06), makeTugColor verbose alpha for canonical tokens, muted preset (i:50 t:42), accent/tone tokens using canonical i=50 instead of signalI. Remaining mismatches reduced to control/field/toggle/tab scope.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-2
date: 2025-03-15T00:25:37Z
---

## step-2: Corrected all dark-mode surface tone/intensity/hue formulas, fg tier offsets and tone anchors, icon formulas, and added interactive hue field (cyan) per D05. Surface/fg/icon mismatches reduced from 38 to 23.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: step-1
date: 2025-03-15T00:07:30Z
---

## step-1: Extracted 291 chromatic tokens and 59 structural tokens from tug-base.css into BRIO_GROUND_TRUTH and BRIO_STRUCTURAL_TOKENS constants. Added T-BRIO-MATCH test as it.todo with 38-token mismatch baseline.

**Files changed:**
- .tugtool/tugplan-mode-preset-formulas.md

---

---
step: audit-fix
date: 2025-03-14T19:47:24Z
---

## audit-fix: Audit fix: Patched setup-rtl.ts Window.prototype.SyntaxError for all instances. Added happy-dom SelectorParser.js instance method forwarding to fix getSelectorGroups crash. Added 12 option fg/icon pairings to fg-bg-pairing-map.ts. Added 4 option bg tokens to accessibility exclusion list. Full suite: 1585 pass, 0 fail.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: audit-fix
date: 2025-03-14T19:27:02Z
---

## audit-fix: Audit fix: Added cleanup() to top-level afterEach in tug-popup-menu.test.tsx to prevent DOM pollution cascading to subsequent test files.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-9
date: 2025-03-14T19:10:25Z
---

## step-9: Integration checkpoint verification: 24 option tokens generated, zero tug-dropdown imports, broad fallback removed, style inspector preserved, build clean, all tests pass across 9 steps.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-8
date: 2025-03-14T19:06:04Z
---

## step-8: Added option to TugCheckboxRole and TugSwitchRole as independent type unions. Changed default role from accent to option. Restructured role logic into three branches: option (fg-muted tokens), other non-accent (tone-map), accent (no injection). Updated 18 tests.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-7
date: 2025-03-14T18:58:27Z
---

## step-7: Deleted tug-dropdown.tsx and tug-dropdown.test.tsx. All call sites migrated in steps 5-6. Test coverage replicated in tug-popup-menu.test.tsx and tug-popup-button.test.tsx. Zero functional imports of tug-dropdown remain.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-6
date: 2025-03-14T18:52:59Z
---

## step-6: Replaced TugDropdown in tug-tab-bar.tsx with TugPopupMenu + TugButton ghost-option triggers for [+] and overflow buttons. Removed trailing-icon hiding CSS hack. Updated comments and test descriptions. Added trailing-icon absence tests. 23 tests pass.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-5
date: 2025-03-14T18:45:00Z
---

## step-5: Migrated all TugDropdown call sites in gallery files to TugPopupButton. Updated imports, renamed demo component, updated tab title, CSS class names, and test assertions. Zero TugDropdown imports remain in cards/.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-4
date: 2025-03-14T18:32:27Z
---

## step-4: Created TugPopupButton as thin composition of TugPopupMenu + TugButton. Fixed visual identity: outlined/option/rounded=none/ChevronDown. Props: label, items, onSelect, size, className, aria-label. Added 11-test file covering trigger structure and prop passthrough.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-3
date: 2025-03-14T18:28:03Z
---

## step-3: Created TugPopupMenu component as headless extraction from TugDropdown. Accepts trigger ReactNode prop, copies blink animation logic, preserves tug-dropdown CSS class names per D05, uses fixed 3px sideOffset. Added test file with 11 tests including item-class verification. Fixed setup-rtl.ts SyntaxError patch for happy-dom querySelector.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-2
date: 2025-03-14T18:14:27Z
---

## step-2: Added option to TugButtonRole type union. Added outlined-option and ghost-option CSS variant rules with rest/hover/active states. Added disabled selectors. Added data-state=open rules for option variants in tug-menu.css and removed broad fallback selector per D03.

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-1
date: 2025-03-14T18:08:14Z
---

## step-1: Added outlined-option and ghost-option token generation blocks to theme-derivation-engine.ts with neutral text hue borders. Updated generate-tug-control-tokens.ts to recognize option role. Regenerated tug-base.css with 24 new tokens. Updated tests for new token counts (343 total, 156 emphasis-role).

**Files changed:**
- .tugtool/tugplan-option-role-popup-menu.md

---

---
step: step-6
date: 2025-03-14T16:00:49Z
---

## step-6: Integration checkpoint: 1567 tests pass, TypeScript clean, zero deprecated patterns. Fixed pre-existing gallery-theme-generator test count and JSDoc after agent role removal.

**Files changed:**
- .tugtool/tugplan-button-hierarchy-refactor.md

---

---
step: step-5
date: 2025-03-14T15:54:06Z
---

## step-5: Added T17-T20 tests for TugTabBar TugDropdown migration: [+] button via TugDropdown, overflow button happy-dom limitation, close button bare per D08. 21 tests pass.

**Files changed:**
- .tugtool/tugplan-button-hierarchy-refactor.md

---

---
step: step-4
date: 2025-03-14T15:47:26Z
---

## step-4: Replaced TugDropdown trigger prop with label/emphasis/role/size/icon/className props, renders internal TugButton with ChevronDown. Migrated 9 caller sites. Added tests T12-T16. Also pulled forward step-5 tug-tab-bar.tsx and tug-tab.css changes.

**Files changed:**
- .tugtool/tugplan-button-hierarchy-refactor.md

---

---
step: step-3
date: 2025-03-14T15:33:54Z
---

## step-3: Changed TugButtonSubtype union (push→text, removed three-state), deleted all three-state infrastructure, migrated all gallery call sites to TugPushButton, updated tests with T03-T07

**Files changed:**
- .tugtool/tugplan-button-hierarchy-refactor.md

---

