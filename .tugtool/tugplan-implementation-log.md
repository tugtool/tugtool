# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-11
date: 2025-03-16T00:45:03Z
---

## step-11: Final integration checkpoint. 1678 pass, 0 fail (62 new tests from baseline of 1616). All exit criteria met: gray pseudo-hue, tokenizer rewrite, source spans, soft warnings, unmatched paren detection, dispatch refactor, error recovery, achromatic gallery strip.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-10
date: 2025-03-16T00:39:09Z
---

## step-10: Added TugAchromaticStrip to palette gallery with black, 5 gray tones (t=0/25/50/75/100), and white. Renders above hue strip. 2 new tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-9
date: 2025-03-16T00:30:44Z
---

## step-9: Changed tokenize() to TokenizeResult, skip-and-continue on bad chars. parseTugColor merges tokenizer errors, within-group failures mark slots attempted. 7 new recovery tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-8
date: 2025-03-16T00:21:48Z
---

## step-8: Replaced duplicated if/else slot dispatch chains with SLOT_DISPATCH record. Pure internal refactor, no behavior change.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-7
date: 2025-03-16T00:17:04Z
---

## step-7: Added findTugColorCallsWithWarnings returning {calls, warnings}. Unmatched --tug-color( parens produce TugColorWarning. Existing findTugColorCalls delegates for backward compat. PostCSS logs scan warnings. 7 new tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-6
date: 2025-03-16T00:11:10Z
---

## step-6: Added TugColorWarning interface and optional warnings on ParseResult ok:true. Five suspicious-value conditions per Spec S04 with explicit-vs-default distinction. PostCSS logs warnings. 13 new tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-5
date: 2025-03-16T00:04:30Z
---

## step-5: Added bare-minus detection in parseNumericTokens with slot-specific error messages. 5 new tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-4
date: 2025-03-15T23:59:49Z
---

## step-4: Rewrote tokenizer to handle uppercase A-Z (normalized to lowercase), CSS hex escape sequences (backslash + 1-6 hex digits), and NBSP as whitespace. 10 new tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-3
date: 2025-03-15T23:53:46Z
---

## step-3: Added end:number to TugColorError and Token interfaces. Updated all 26 error-producing paths with source spans. Added assertAllErrorsHaveSpans helper covering all existing error tests. 6 new span tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

---
step: step-2
date: 2025-03-15T23:44:35Z
---

## step-2: Added gray as achromatic pseudo-hue with canonical L=0.5, C=0 always. Gray uses tone formula for lightness, intensity ignored. Added to KNOWN_HUES in postcss-tug-color.ts with expandTugColor branch. 12 new tests.

**Files changed:**
- .tugtool/tugplan-gray-parser-rewrite.md

---

