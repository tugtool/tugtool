# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing docs: framework-architecture, tuglaws (H3 law headings + {#lNN} anchors), design-decisions, pane-model, card-state-model (renamed from selection-model), state-preservation, lifecycle-delegates, app-test-harness, responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton, INDEX. Source edits inline-comment-only per [D06].

## Files touched
- tuglaws/INDEX.md — Step 1; ≤150 lines.
- tuglaws/card-state-model.md — Step 2 rename; Cross-Links → lifecycle-delegates.
- tuglaws/state-preservation.md — Step 3 (274 lines).
- tuglaws/lifecycle-delegates.md — Step 4 (211 lines).
- tuglaws/app-test-harness.md — Step 5 NEW (155 lines).
- tests/app-test/README.md — Step 5 reduced to 258 lines.
- tuglaws/pane-model.md — Step 2 + Step 7: Cross-Links now also links state-preservation.md and lifecycle-delegates.md.
- tuglaws/component-authoring.md, tuglaws/responder-chain.md — Step 2 link target updates.
- tugdeck/src/components/tugways/{selection-guard.ts,use-copyable-text.tsx} — Step 2 comment path updates.
- tuglaws/tuglaws.md — Step 6: 25 H3 law headings with {#lNN} anchors. Step 7: L23 cross-refs state-preservation.md; L09 cross-refs lifecycle-delegates.md. 153 lines.
- tuglaws/framework-architecture.md — Step 6: appendix → cross-ref list (9 items, citation order). 297 lines.
- tuglaws/app-test-inventory.md — Step 7: 7 [A9] paragraphs each carry a state-preservation.md link.

## Patterns established
- SC07 banner: `# Title` + italic tagline + `*Cross-references: [D##]→design-decisions.md. [L##]→tuglaws.md.*` + `---`.
- INDEX entries (D05): one line `- [name](name) — desc`.
- AT-tag prose refs use bare `[AT0008]`.
- TODO-candidate-law comment (Q01): `<!-- TODO: candidate law? roadmap disagrees on X — ... -->`.
- Top-of-doc pointer pattern: README starts "For architecture see X; this doc is procedure".
- Files section split: "primary canonical authority" / "secondary implementation source" / "historical / secondary planning".
- Law heading convention (Step 6 / Q02): `### LNN. <Title>. {#lNN}` with body text as a paragraph below. Lowercase L + two-digit anchors per OF6 (GitHub web preview, not strict CommonMark).
- FA cross-ref list shape: `**LNN** — one-line summary. [full text](tuglaws.md#lNN)` per item, in citation order.
- Step 7 [A9] linking pattern: inline `(see [state-preservation.md](state-preservation.md))` after `[A9]` mention; awk gate uses paragraph blocks (RS="") so each `####` block + bullets is one paragraph and needs ≥1 link.

## Build / test notes
- Step 7 gates (all pass): `grep -c 'state-preservation.md' tuglaws.md`=1, `grep -c 'lifecycle-delegates.md' tuglaws.md`=1, `grep -c 'state-preservation.md\|lifecycle-delegates.md' pane-model.md`=2, awk SC10 gate emits no MISSING, `grep -c 'state-preservation.md' app-test-inventory.md`=7 matching `[A9]` count=7. `bun x tsc --noEmit` exits 0; `bun test` 2414 pass / 0 fail.
- Step 7 residual `selection-model.md` grep (Task 4 / Risk R02): hits only in roadmap/ and .tugtool/ planning files; SC11 paths (tuglaws/, tugdeck/src/, tests/) are clean. Non-gating per task spec.

## Hints for upcoming steps
- Step 8: full SC01–SC13 audit, plan status flip, audit subsection appended. Includes visual GitHub-preview verification of `tuglaws.md#l02`, `#l11`, `#l24` anchors per OF6.
- Step 8 close-out should record the residual selection-model.md grep result (roadmap/ + .tugtool/ only) per Risk R02.
- Plan decisions: [D01] promote selection-model. [D02] state-preservation=mechanism, card-state-model=contract. [D03] harness=arch / README=procedure. [D04] strip FA appendix. [D05] one-line INDEX. [D06] comment-only source edits. [D07] card-lifecycle.ts is lifecycle authority.
