# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing docs: framework-architecture, tuglaws (now H3 law headings + {#lNN} anchors after Step 6), design-decisions, pane-model, card-state-model (renamed from selection-model), state-preservation, lifecycle-delegates, app-test-harness, responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton, INDEX. Source edits inline-comment-only per [D06].

## Files touched
- tuglaws/INDEX.md — Step 1; ≤150 lines.
- tuglaws/card-state-model.md — Step 2 rename; Cross-Links → lifecycle-delegates.
- tuglaws/state-preservation.md — Step 3 (274 lines).
- tuglaws/lifecycle-delegates.md — Step 4 (211 lines).
- tuglaws/app-test-harness.md — Step 5 NEW (155 lines).
- tests/app-test/README.md — Step 5 reduced to 258 lines.
- tuglaws/pane-model.md — Cross-Links link selection→card-state-model.
- tuglaws/component-authoring.md, tuglaws/responder-chain.md — link target updated.
- tugdeck/src/components/tugways/{selection-guard.ts,use-copyable-text.tsx} — comment path updates.
- tuglaws/tuglaws.md — Step 6: 25 `**LNN. ...**` → `### LNN. ... {#lNN}` H3 headings; body text now a paragraph below each heading. 153 lines total.
- tuglaws/framework-architecture.md — Step 6: stripped "Appendix: Laws referenced" block (was lines 284-352). Replaced with `## Laws referenced in this document` H2 section + 9-item bulleted list (L24, L02, L07, L11, L03, L06, L08, L04, L05) each as `**LNN** — summary. [full text](tuglaws.md#lNN)`. 297 lines total.

## Patterns established
- SC07 banner: `# Title` + italic tagline + `*Cross-references: [D##]→design-decisions.md. [L##]→tuglaws.md.*` + `---`.
- INDEX entries (D05): one line `- [name](name) — desc`.
- AT-tag prose refs use bare `[AT0008]`.
- TODO-candidate-law comment (Q01): `<!-- TODO: candidate law? roadmap disagrees on X — ... -->`.
- Top-of-doc pointer pattern: README starts "For architecture see X; this doc is procedure".
- Files section split: "primary canonical authority" / "secondary implementation source" / "historical / secondary planning".
- Law heading convention (Step 6 / Q02): `### LNN. <Title>. {#lNN}` with body text as a paragraph below. Trailing-attribute anchors use lowercase L + two-digit number (e.g. `{#l02}`, `{#l24}`). Per OF6 these resolve on GitHub web preview, not strict CommonMark.
- FA cross-ref list shape: `**LNN** — one-line summary. [full text](tuglaws.md#lNN)` per item, in citation order.

## Build / test notes
- tugdeck/node_modules populated; `bun x tsc --noEmit` exits 0 (Step 5 sanity).
- Step 6 gates (all pass): `grep -c '^### L' tuglaws.md`=25; awk anchor count=25; `grep -c '^### L0' framework-architecture.md`=0; `grep -c '^## Laws referenced in this document' framework-architecture.md`=1; all 9 `tuglaws.md#lNN` link targets resolve.
- Step 6 has no bun/tsc/cargo gates — pure docs structural rewrite.

## Hints for upcoming steps
- Step 7 SC08: tuglaws.md L23 → state-preservation.md; L09 → lifecycle-delegates.md. (Now that L23 and L09 are H3 anchored at `{#l23}` and `{#l09}`, cross-refs from other docs may target those anchors.)
- Step 7 SC09: pane-model.md Cross-Links (NOT Files table per OF8) needs state-preservation.md + lifecycle-delegates.md.
- Step 7 SC10: 7 [A9] paragraphs in app-test-inventory.md need state-preservation.md links each (awk RS="" gate).
- Step 7 may add inventory backlinks to lifecycle-delegates.md from [AT0008]/[AT0019].
- Step 8: full SC01–SC13 audit, plan status flip, audit subsection appended. Includes visual GitHub-preview verification of `tuglaws.md#l02`, `#l11`, `#l24` anchors per OF6.
- Plan decisions: [D01] promote selection-model. [D02] state-preservation=mechanism, card-state-model=contract. [D03] harness=arch / README=procedure. [D04] strip FA appendix (shipped Step 6). [D05] one-line INDEX. [D06] comment-only source edits. [D07] card-lifecycle.ts is lifecycle authority.
