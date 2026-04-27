# Session Memory — tuglaws-tidyup-ae990f1-1

## Project map
Pure-docs plan in `tuglaws/`. Existing docs: framework-architecture, tuglaws, design-decisions, pane-model, card-state-model (renamed from selection-model), state-preservation, lifecycle-delegates, app-test-harness (NEW Step 5), responder-chain, action-naming, component-authoring, token-naming, color-palette, theme-engine, app-test-inventory, code-signing-mac, tugplan-skeleton, INDEX. Source edits inline-comment-only per [D06].

## Files touched
- tuglaws/INDEX.md — Step 1; ≤150 lines; lists app-test-harness.md L29.
- tuglaws/card-state-model.md — Step 2 rename; Cross-Links → lifecycle-delegates.
- tuglaws/state-preservation.md — Step 3 (274 lines).
- tuglaws/lifecycle-delegates.md — Step 4 (211 lines); SC04 11 idents + SC07 banner.
- tuglaws/app-test-harness.md — Step 5 NEW (155 lines); SC05 5 idents (TestHarness, isTrusted, CGEvent.post, WKWebView, APP_TEST_SKIP_RESIGN) + SC07 banner.
- tests/app-test/README.md — Step 5 reduced 445→258 lines. Stripped: lifecycle, fidelity envelope, Phase A surface, Accessibility preflight + grant failure modes, Smoke vs scenario. Retained: Related docs (added app-test-harness.md), Running, Env vars (added APP_TEST_SKIP_RESIGN row), Live-mode, Adding a new test (consolidates canonical shape + holdModifier), Lint, Directory layout, TUGAPP_APP_TEST note.
- tuglaws/pane-model.md — Cross-Links link selection→card-state-model.
- tuglaws/component-authoring.md, tuglaws/responder-chain.md — link target updated.
- tugdeck/src/components/tugways/{selection-guard.ts,use-copyable-text.tsx} — comment path updates.

## Patterns established
- SC07 banner: `# Title` + italic tagline + `*Cross-references: [D##]→design-decisions.md. [L##]→tuglaws.md.*` + `---`. app-test-harness.md banner additionally redirects internal [D##] refs (D02/D12/Q05) to roadmap/tugplan-in-app-bridge.md + harness-extensions.md.
- INDEX entries (D05): one line `- [name](name) — desc`.
- AT-tag prose refs use bare `[AT0008]`; per-AT slug links exist somewhere in corpus.
- TODO-candidate-law comment (Q01): `<!-- TODO: candidate law? roadmap disagrees on X — ... -->`.
- Top-of-doc pointer pattern: README starts "For architecture see X; this doc is procedure"; mirror "procedural reference for test authors" entry in harness-doc Files block.
- Files section split: "primary canonical authority" / "secondary implementation source" / "historical / secondary planning".

## Build / test notes
- tugdeck/node_modules populated; `bun x tsc --noEmit` exits 0 (Step 5 sanity, no .ts/.tsx touched).
- Step 5 gates: file exists ✓; SC07 banner=1 ✓; README wc -l=258<320 ✓; "Accessibility grant failure modes" count=0 ✓.
- Step 5's plan tests do NOT include bun test / tsc — those are gated on Steps 2, 7, 8.

## Hints for upcoming steps
- Step 6: structural rewrite of tuglaws.md — every `**LNN. ...**` law line → `### LNN. ... {#lNN}` heading. Currently bold prose, not headings. Then strip framework-architecture.md "Appendix: Laws referenced" block; replace with one-liner-list pointing at new anchors (D04). Verify anchors render on GitHub web preview (OF6), not strict local CommonMark.
- Step 7 SC10: 7 [A9] paragraphs in app-test-inventory.md need state-preservation.md links each (awk RS="" gate); state-preservation.md exists.
- Step 7 SC09: pane-model.md Cross-Links (NOT Files table per OF8) needs state-preservation.md + lifecycle-delegates.md.
- Step 7 SC08: tuglaws.md L23 → state-preservation.md; L09 → lifecycle-delegates.md.
- Step 7 may add inventory backlinks to lifecycle-delegates.md from [AT0008]/[AT0019].
- Step 8: full SC01–SC13 audit, plan status flip, audit subsection appended.
- Plan decisions: [D01] promote selection-model. [D02] state-preservation=mechanism, card-state-model=contract. [D03] harness=arch / README=procedure (shipped Step 5). [D04] strip FA appendix. [D05] one-line INDEX. [D06] comment-only source edits. [D07] card-lifecycle.ts is lifecycle authority.
