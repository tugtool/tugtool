# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing: framework-architecture, tuglaws, design-decisions, pane-model, card-state-model (renamed from selection-model), state-preservation (NEW Step 3), responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton, INDEX. Future: lifecycle-delegates.md (Step 4), app-test-harness.md (Step 5). Source edits are inline-comment-only per [D06].

## Files touched
- tuglaws/INDEX.md — Step 1 reading guide; ≤150 lines; format `- [doc](doc) — desc`.
- tuglaws/card-state-model.md — Renamed from selection-model.md; canonical banner; Persistence→Preservation; Form-control Value Preservation section; ResponderChainProvider reduced to cross-ref; Cross-Links closing section. Three axis sections (Focus L73, Scroll L95, Form-control L128) and Cross-Links L271 backlink to state-preservation.md.
- tuglaws/state-preservation.md — Step 3 new file (274 lines). Two-layer protocol doc (component-level + card-level). Contains all 15 SC03 identifiers; SC07 banner; AT-tag table; FocusSnapshot/CardStateBag depth sections; authoring rules; Files; Cross-Links.
- tuglaws/pane-model.md — Cross-Links link `selection-model.md` → `card-state-model.md`.
- tuglaws/component-authoring.md — Selection-and-Focus link target updated.
- tuglaws/responder-chain.md — Sibling-docs bullet pointing at card-state-model.md.
- tugdeck/src/components/tugways/selection-guard.ts — comment path update.
- tugdeck/src/components/tugways/use-copyable-text.tsx — comment path update.

## Patterns established
- Canonical doc header (SC07): `# Title` + italic tagline + `*Cross-references: [D##]→design-decisions.md. [L##]→tuglaws.md.*` + `---`.
- INDEX entries (per [D05]): one line, `- [name](name) — desc`.
- [D06]: source-code edits limited to inline JSDoc/comments; no production code.
- state-preservation.md identifiers section: defining-file linked at head of each cluster, then bullet per identifier with one-line purpose. Greppable.
- AT-tag refs use `[AT0008](app-test-inventory.md#at0008-...)` slug-anchor form.

## Build / test notes
- Worktree has `tugdeck/node_modules` populated (Step 1 install persists).
- `bun x tsc --noEmit` clean after Step 3 docs-only addition.
- SC11 grep `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/` returns 0 lines.
- Step 3 SC03 identifier loop passes (all 15 idents present); SC07 banner gate passes (1 match anchored).

## Hints for upcoming steps
- Step 4 SC04: lifecycle-delegates.md must mention each of: cardDidFinishConstruction, cardWillActivate, cardDidActivate, cardWillDeactivate, cardDidDeactivate, cardWillMove, cardDidMove, cardWillResize, cardDidResize, cardWillBeginDestruction, TugCardDelegate, CardHost. Per OQ1, preservation callbacks (onCardActivated/onSave/onRestore) belong in state-preservation.md (already done in Step 3).
- Step 4 spec at plan lines 841–946 (Spec S04). Authoritative source: `tugdeck/src/lib/card-lifecycle.ts` ([D07] tie-breaker). Document the strict ordering invariant: `cardWillDeactivate(A)` → `cardWillActivate(B)` → `cardDidDeactivate(A)` → `cardDidActivate(B)`. MessageChannel-backed drain queue at lines ~735–795.
- Step 4 cross-link to state-preservation.md from lifecycle-delegates.md (preservation callbacks ride atop the delegate pipe). state-preservation.md already has reciprocal cross-link to lifecycle-delegates.md in the Cross-Links section.
- Step 5: reduce `tests/app-test/README.md` to procedural sections only; gate `wc -l < 320`.
- Step 6: strip law-text appendix from framework-architecture.md; promote `**LNN. ...**` → `### LNN. ... {#lNN}` in tuglaws.md.
- Step 7 SC10: every paragraph in app-test-inventory.md containing `[A9]` must also contain a state-preservation.md link (awk RS="" gate). state-preservation.md exists now so links can be added.
- Plan decisions: [D01] promote selection-model. [D02] state-preservation=mechanism, card-state-model=contract. [D03] harness=architecture, README=procedure. [D04] strip FA appendix. [D05] one-line INDEX. [D06] comment-only source edits. [D07] card-lifecycle.ts is lifecycle authority.
