# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing: framework-architecture, tuglaws, design-decisions, pane-model, card-state-model (renamed from selection-model), responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton, INDEX. Future: state-preservation.md (Step 3), lifecycle-delegates.md (Step 4), app-test-harness.md (Step 5). Source edits are inline-comment-only per [D06].

## Files touched
- tuglaws/INDEX.md — Step 1 reading guide; ≤150 lines; format `- [doc](doc) — desc`.
- tuglaws/card-state-model.md — Renamed from selection-model.md; canonical banner; "Persistence" → "Preservation" heading; new Form-control Value Preservation section; ResponderChainProvider section reduced to cross-ref; new Cross-Links closing section.
- tuglaws/pane-model.md — Cross-Links link `selection-model.md` → `card-state-model.md`.
- tuglaws/component-authoring.md — Selection-and-Focus link target updated.
- tuglaws/responder-chain.md — Additive Sibling-docs bullet pointing at card-state-model.md for focus-refusal.
- tugdeck/src/components/tugways/selection-guard.ts — comment path update.
- tugdeck/src/components/tugways/use-copyable-text.tsx — comment path update.

## Patterns established
- Canonical doc header (SC07): `# Title` + italic tagline + `*Cross-references: [D##]→design-decisions.md. [L##]→tuglaws.md.*` + `---`.
- INDEX entries (per [D05]): one line, `- [name](name) — desc`.
- [D06]: source-code edits limited to inline JSDoc/comments; no production code.
- Cross-refs in card-state-model.md → state-preservation.md appear at top of each preservation section + Cross-Links closing block.

## Build / test notes
- Worktree starts with NO `tugdeck/node_modules` — run `cd tugdeck && bun install` before tsc.
- After install: `bun x tsc --noEmit` clean; `bun test` 2414 pass / 0 fail in ~10.7s.
- SC11 grep `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/` returns 0 lines.

## Hints for upcoming steps
- Step 3 SC03: state-preservation.md must mention each of: useComponentStatePreservation, useCardStatePreservation, ComponentStatePreservationRegistry, CardStatePreservationContext, CardStatePreservationContextValue, CardStatePreservationCallbacks, FocusSnapshot, CardStateBag, data-tug-state-key, data-tug-focus-key, data-tug-scroll-key, data-tug-prompt-input-root, onCardActivated, onSave, onRestore. Spec S03 sections at plan lines 784–839.
- Step 3: card-state-model.md already cross-refs state-preservation.md from Focus, Scroll, Form-control, and Cross-Links. The reciprocal back-link must be added in Step 3.
- Step 4 SC04: lifecycle-delegates.md must mention each of: cardDidFinishConstruction, cardWillActivate, cardDidActivate, cardWillDeactivate, cardDidDeactivate, cardWillMove, cardDidMove, cardWillResize, cardDidResize, cardWillBeginDestruction, TugCardDelegate, CardHost. Per OQ1, preservation callbacks (onCardActivated/onSave/onRestore) belong in state-preservation.md, not here.
- Step 5: reduce `tests/app-test/README.md` to procedural sections only; gate `wc -l < 320`.
- Step 6: strip law-text appendix from framework-architecture.md; promote `**LNN. ...**` → `### LNN. ... {#lNN}` in tuglaws.md.
- Step 7 SC10: every paragraph in app-test-inventory.md containing `[A9]` must also contain a state-preservation.md link (awk RS="" gate).
- Plan decisions: [D01] promote selection-model. [D02] state-preservation=mechanism, card-state-model=contract. [D03] harness=architecture, README=procedure. [D04] strip FA appendix. [D05] one-line INDEX. [D06] comment-only source edits. [D07] card-lifecycle.ts is lifecycle authority.
