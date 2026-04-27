# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing files: framework-architecture, tuglaws, design-decisions, pane-model, selection-model (renaming), responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton. New files: INDEX.md (Step 1), state-preservation.md (Step 3), lifecycle-delegates.md (Step 4), app-test-harness.md (Step 5). Rename selection-model.md → card-state-model.md (Step 2). No code changes except inline comment updates referencing the old filename.

## Files touched
- tuglaws/INDEX.md — One-page reading guide; 35 lines; lists all 17 docs (existing 13 minus selection-model + 4 future). Per [D05] format `- [name](name) — desc`. Sections: Start here / Component & UI architecture / Theming, palette, tokens / Testing & build infrastructure / Templates.

## Patterns established
- INDEX entry format per [D05]: `- [doc-name.md](doc-name.md) — one-sentence description.` Single-line only, ≤ 150 lines, H2 only no H3 nesting.
- Tuglaws doc canonical header: `# Title` + italic tagline + `*Cross-references: [D##] → design-decisions.md. [L##] → tuglaws.md.*` + `---` (see responder-chain.md, action-naming.md, component-authoring.md). Per SC07 every new doc and renamed card-state-model.md must open with this banner format.
- Spec S01 uses INDEX entries that point at future-but-not-yet-existing files (card-state-model.md, state-preservation.md, lifecycle-delegates.md, app-test-harness.md). Steps 2–5 create those targets.

## Build / test notes
- Step 1 touches no .ts/.tsx, so SC12/SC13 not exercised; main was clean per A06.
- Verified: `wc -l tuglaws/INDEX.md` = 35; `grep -c '^## '` = 5 (≥ 4); `grep -c '^### '` = 0; all 17 expected entries present exactly once via per-file `grep -Fc "(name)"` loop.

## Hints for upcoming steps
- Step 2 (rename selection-model.md → card-state-model.md): per [D06], also fix inline comments in `tugdeck/src/lib/selection-guard.ts` and `tugdeck/src/components/.../use-copyable-text.tsx` that reference selection-model.md. SC11 gate: `grep -r 'tuglaws/selection-model' tuglaws/ tugdeck/src/ tests/` returns 0 lines after Step 2.
- Step 2 must also insert canonical Cross-references banner into card-state-model.md (the file lacks one as selection-model.md). Per SC07 OF3.
- Step 2's "Scroll Persistence Attributes" heading is renamed to "Scroll Preservation Attributes" — content otherwise verbatim (Spec S02 §7).
- Step 3 SC03 identifier loop: useComponentStatePreservation, useCardStatePreservation, ComponentStatePreservationRegistry, CardStatePreservationContext, CardStatePreservationContextValue, CardStatePreservationCallbacks, FocusSnapshot, CardStateBag, data-tug-state-key, data-tug-focus-key, data-tug-scroll-key, data-tug-prompt-input-root, onCardActivated, onSave, onRestore — must each appear at least once in `tuglaws/state-preservation.md`.
- Step 4 SC04 identifier loop: cardDidFinishConstruction, cardWillActivate, cardDidActivate, cardWillDeactivate, cardDidDeactivate, cardWillMove, cardDidMove, cardWillResize, cardDidResize, cardWillBeginDestruction, TugCardDelegate, CardHost — each must appear in `tuglaws/lifecycle-delegates.md`. Lifecycle delegates doc is strictly about deck-level event pipe; preservation callbacks belong in state-preservation.md (per OQ1).
- Step 5: lift overview from `tests/app-test/README.md`; reduce that README to procedural sections only.
- Step 6: strip law-text appendix from `framework-architecture.md` — `grep -c '^### L0' tuglaws/framework-architecture.md` must equal 0 after.
- Step 7 SC10: every paragraph in `app-test-inventory.md` containing `[A9]` must also contain `state-preservation.md` link (awk RS="" gate).
- Step 8: final audit runs all SC checks plus tugdeck `bun x tsc --noEmit` and `bun test`.
- Plan canonical decisions: [D01] promote selection-model rather than create sibling. [D02] state-preservation = mechanism, card-state-model = contract. [D03] app-test-harness.md = architecture, README = procedure. [D04] strip law-text appendix from framework-architecture.md. [D05] one-line INDEX entries. [D06] only inline-comment source edits. [D07] card-lifecycle.ts is lifecycle source-of-truth.
