# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing: framework-architecture, tuglaws, design-decisions, pane-model, card-state-model (renamed from selection-model), state-preservation, lifecycle-delegates (NEW Step 4), responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton, INDEX. Future: app-test-harness.md (Step 5). Source edits are inline-comment-only per [D06].

## Files touched
- tuglaws/INDEX.md — Step 1 reading guide; ≤150 lines; format `- [doc](doc) — desc`. Already lists lifecycle-delegates.md.
- tuglaws/card-state-model.md — Renamed from selection-model.md; Cross-Links has lifecycle-delegates backlink at L272.
- tuglaws/state-preservation.md — Step 3 (274 lines). Cross-Links L269 backlink to lifecycle-delegates.md.
- tuglaws/lifecycle-delegates.md — Step 4 NEW (211 lines). SC04 12 identifiers + SC07 banner. Authored from `tugdeck/src/lib/card-lifecycle.ts` ([D07] primary) and `tugdeck/src/components/chrome/card-host.tsx` (secondary). Includes one TODO-candidate-law comment about roadmap-vs-source disagreement on move/resize geometry payloads.
- tuglaws/pane-model.md — Cross-Links link `selection-model.md` → `card-state-model.md`.
- tuglaws/component-authoring.md — Selection-and-Focus link target updated.
- tuglaws/responder-chain.md — Sibling-docs bullet pointing at card-state-model.md.
- tugdeck/src/components/tugways/selection-guard.ts — comment path update.
- tugdeck/src/components/tugways/use-copyable-text.tsx — comment path update.

## Patterns established
- Canonical doc header (SC07): `# Title` + italic tagline + `*Cross-references: [D##]→design-decisions.md. [L##]→tuglaws.md.*` + `---`.
- INDEX entries (per [D05]): one line, `- [name](name) — desc`.
- [D06]: source-code edits limited to inline JSDoc/comments; no production code.
- AT-tag refs use `[AT0008](app-test-inventory.md#at0008-...)` slug-anchor form. lifecycle-delegates.md uses bare `[AT0008]` style citations in prose (no slug links) — fine; per-AT slug links only need to exist somewhere in the docs corpus.
- TODO-candidate-law comment per [Q01]: `<!-- TODO: candidate law? roadmap doc disagrees on X — ... -->`.
- Identifier code-block style: short `interface` literal copy from source for clarity (used in lifecycle-delegates.md).

## Build / test notes
- Worktree has `tugdeck/node_modules` populated (Step 1 install persists).
- `bun x tsc --noEmit` clean after Step 4 docs-only addition.
- SC11 grep `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/` returns 0 lines.
- Step 4 SC04 file-exists + 12-identifier loop both pass; SC07 banner gate = 1.
- Step 3 SC03 identifier loop passes (all 15 idents present).

## Hints for upcoming steps
- Step 5 SC05: app-test-harness.md must mention each of: TestHarness, isTrusted, CGEvent.post, WKWebView, APP_TEST_SKIP_RESIGN. Lift content from `tests/app-test/README.md` per Spec S05. Reduce README to procedural sections only; gate `wc -l < 320`. Source-of-truth files for harness: `tugapp/Tests/AppTests/Harness/*` (Swift bridge), `tests/app-test/lib/*.ts` (JS side).
- Step 6: strip law-text appendix from framework-architecture.md; promote `**LNN. ...**` → `### LNN. ... {#lNN}` in tuglaws.md.
- Step 7 SC10: every paragraph in app-test-inventory.md containing `[A9]` must also contain a state-preservation.md link (awk RS="" gate). state-preservation.md exists now so links can be added.
- Step 7 may also want to review lifecycle-delegates.md cross-refs from app-test-inventory.md entries [AT0008]/[AT0019] (currently no backlink from inventory).
- Plan decisions: [D01] promote selection-model. [D02] state-preservation=mechanism, card-state-model=contract. [D03] harness=architecture, README=procedure. [D04] strip FA appendix. [D05] one-line INDEX. [D06] comment-only source edits. [D07] card-lifecycle.ts is lifecycle authority.
