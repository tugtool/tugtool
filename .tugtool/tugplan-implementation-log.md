# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-10
date: 2025-03-17T13:43:26Z
---

## step-10: Fixed 2 remaining isLight comment references. Deleted .tugtool/baseline-tokens.txt. Verified: zero isLight/ModePreset/DARK_PRESET/LIGHT_PRESET across all source. 1814 tests pass, tokens byte-identical.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-9
date: 2025-03-17T13:36:42Z
---

## step-9: Deleted ModePreset interface, DARK_PRESET, LIGHT_PRESET (~890 lines). Cleaned up all references. Rewrote T-PRESET-EXPORTS as T-FORMULAS-EXPORTS. ThemeRecipe.formulas is now the sole formula source. 1814 tests pass, baseline match.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-8
date: 2025-03-17T13:22:04Z
---

## step-8: Changed Expr type, StructuralRule, evaluateRules() from ModePreset to DerivationFormulas. Renamed ~200 preset refs to formulas in derivation-rules.ts. Replaced ~35 isLight branches with unified field reads. Refactored outlinedFgRules factory. Zero isLight and zero preset remain in derivation-rules.ts. 1814 tests pass, baseline match.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-7
date: 2025-03-17T12:53:20Z
---

## step-7: Added 75 unified per-state control emphasis fields (Table T01) to DerivationFormulas interface and BRIO_DARK_FORMULAS: outlined-action/agent/option fg/icon (60), ghost-action/option fg/icon (24 subset already existed), plus 9 non-control branch fields. Purely additive.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-6
date: 2025-03-17T12:45:05Z
---

## step-6: Changed computeTones() from (preset: ModePreset) to (formulas: DerivationFormulas). Replaced 7 isLight branches with number|null override fields. Deleted T-TONES-LIGHT, T-RULES-LIGHT-MATCH, T-ACC-1 light sub-test (clean break per D06). deriveTheme() fallback simplified to recipe.formulas ?? BRIO_DARK_FORMULAS. 1814 tests pass, baseline match.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

