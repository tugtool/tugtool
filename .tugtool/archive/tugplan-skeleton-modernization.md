## Skeleton Modernization {#skeleton-modernization}

**Purpose:** Modernize the tugplan skeleton by applying 12 targeted changes that remove dead features (Beads), eliminate unused complexity (multi-phase numbering, audit templates), and trim verbose sections -- resulting in a leaner skeleton that consumes fewer tokens and matches how plans are actually written.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | plan |
| Status | draft |
| Target branch | skeleton-modernization |
| Tracking issue/PR | — |
| Last updated | 2026-02-25 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugplan skeleton has accumulated features over many iterations. Some reflect systems that no longer exist (Beads), some impose structure that every plan ignores (multi-phase X.Y numbering), and some add bulk without helping the author-agent write better plans or the coder-agent implement them. A comprehensive audit documented in `roadmap/skeleton-modernization.md` identifies 12 specific changes with full downstream impact analysis.

The changes span four layers: the skeleton document itself, two Rust source files (validator.rs and worktree.rs), approximately 440 test references across 25 files, and 8 agent/skill documentation files. No database or migration changes are required.

#### Strategy {#strategy}

- Apply all 12 skeleton changes in a single step since they are interdependent text edits to one file
- Update Rust source code (validator W007 check, worktree artifact dirs) in a dedicated step with focused testing
- Mass-update test fixtures and test assertions in a separate step to isolate the large mechanical change
- Update agent and skill documentation last, after the code and tests confirm the new conventions
- Keep the parser.rs rollback sentinel for backward compatibility with historical plans
- Do not migrate existing tugplans; old plans with step-0 coexist with new plans using step-1

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable. Avoid "works well".

- The modernized skeleton is under 450 lines (down from ~900)
- The skeleton contains none of the removed content (Beads, step-0, Rollback template, Stakeholders, X.Y numbering, Document Size Guidance, Audit pattern)
- `cargo nextest run` passes with zero failures after all test updates
- No agent or skill doc references step-0, Rollback (as a required step field), Beads, or X.Y numbering
- New plans authored against the modernized skeleton pass `tugcode validate` without step-0-related W007 warnings

#### Scope {#scope}

1. Rewrite `.tugtool/tugplan-skeleton.md` with all 12 changes from the roadmap proposal
2. Update `validator.rs` W007 check: `step.number != "0"` becomes `step.number != "1"`
3. Update `worktree.rs` artifact dir creation: use step anchor instead of enumerate index
4. Mass-update ~440 `step-0` references across 25 test files to `step-1` (with corresponding renumbering)
5. Update 7 agent docs: conformance-agent, author-agent, critic-agent, architect-agent, coder-agent, overviewer-agent, reviewer-agent
6. Update 1 skill doc: `implement/SKILL.md`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migrating existing tugplans to the new format
- Updating the `tugcode/.tugtool/` copy of the skeleton (synced separately per user answer)
- Changing the parser.rs rollback sentinel (kept for backward compatibility)
- Modifying the validator's I001 document size check (independent of skeleton guidance removal)
- Changing tugstate/DB schema (anchor-string-agnostic, old and new plans coexist)

#### Dependencies / Prerequisites {#dependencies}

- The roadmap document `roadmap/skeleton-modernization.md` must be complete (it is)
- Beads removal must be done (confirmed: `tugplan-remove-beads.md` exists and Beads code is removed)

#### Constraints {#constraints}

- Warnings are errors: `-D warnings` enforced via `tugcode/.cargo/config.toml`
- The parser must continue to parse historical plans that use step-0, Rollback sections, and Bead lines
- All changes must pass `cargo nextest run` before committing

#### Assumptions {#assumptions}

- The 12 changes are implemented in a single plan covering all layers: skeleton, Rust code, Rust tests, agent docs, and skill docs
- The reviewer-agent.md does not need changes (confirmed by inspection: no step-0 or Rollback references present)
- The parser.rs rollback sentinel (header_lower.contains("rollback")) will be kept for backward compatibility
- The "Commit after all checkpoints pass." note will be stated once in the Execution Steps preamble blockquote
- Existing tugplans with step-0 are not migrated; only the skeleton and new-plan infrastructure is updated
- The W007 validator change will update `"0"` to `"1"` in check_step_dependencies
- The worktree.rs artifact dir change will use the step anchor from the all_steps Vec element directly for top-level steps; substeps share their parent directory

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Steps start at 1, not 0 (DECIDED) {#d01-steps-start-at-one}

**Decision:** Execution steps are numbered starting at 1. Step 0 is retired. Step anchors follow the pattern step-1, step-2, step-3, and so on.

**Rationale:**
- The 0-based convention is a programmer affectation; Step 1 is the natural first step
- "Prep/bootstrapping" is a planning concern expressed in the step title, not a numbering convention

**Implications:**
- Validator W007 must exempt step 1 (not step 0) from the dependency requirement
- Worktree artifact dirs must use step anchors, not enumerate indices
- All test fixtures and assertions referencing step-0 must be updated
- Agent and skill docs must be updated

#### [D02] Retire multi-phase X.Y numbering (DECIDED) {#d02-retire-phase-numbering}

**Decision:** Remove the X.Y phase numbering system, the Section Numbering Convention table, and all X.Y prefixes from section headings.

**Rationale:**
- Every plan uses "Phase 1.0"; the multi-phase system never materialized
- Sections are identified by anchors, not by numbers
- No code, agent, or validator references the X.Y numbering

**Implications:**
- Document title heading becomes `## <Plan Title> {#phase-slug}` without phase prefix
- Section headings lose number prefixes: `### Design Decisions` instead of `### 1.0.0 Design Decisions`

#### [D03] Remove all Beads content (DECIDED) {#d03-remove-beads}

**Decision:** Delete Beads linkage sections (5, 5b), all Bead comments in step templates, and the Beads Root metadata row.

**Rationale:**
- Beads has been removed from the codebase
- Only 7 legacy plans reference Beads, all predating the removal
- Parser backward-compat test (`test_historical_bead_lines_parse_without_error`) is kept independently

**Implications:**
- Plan Metadata table loses the Beads Root row
- Step templates lose `**Bead:**` comments and `**Beads:**` hints blocks

#### [D04] Remove Document Size Guidance section (DECIDED) {#d04-remove-size-guidance}

**Decision:** Delete the entire Document Size Guidance section from the skeleton.

**Rationale:**
- No plan has ever needed splitting
- Plans that are too long are a quality problem for the critic-agent, not a structural skeleton concern
- The validator's I001 check (2000+ lines info warning) remains independently

**Implications:**
- ~25 lines removed from skeleton

#### [D05] Remove Audit step pattern (DECIDED) {#d05-remove-audit-pattern}

**Decision:** Delete the Audit / Improvement Round step pattern template from the skeleton.

**Rationale:**
- This is a specific step type embedded in a general skeleton
- Plans that need audit steps describe them in their own step content
- The auditor-agent in the implement workflow handles post-implementation audit independently

**Implications:**
- ~60 lines removed from skeleton
- No downstream code or agent references

#### [D06] Trim Test Plan Concepts section (DECIDED) {#d06-trim-test-plan}

**Decision:** Keep the Test Plan Concepts heading and test categories table. Remove fixture directory structure, fixture manifest format, fixture requirements, and golden test workflow subsections.

**Rationale:**
- Fixture schemas are prescriptive boilerplate that plans never follow
- Real plans put test strategy in simple lists or tables
- Test concepts are useful; fixture schemas are noise

**Implications:**
- ~60 lines removed from the Test Plan Concepts section

#### [D07] Trim Specification section to a menu (DECIDED) {#d07-trim-specification}

**Decision:** Replace the 10 fully-expanded specification subsection templates with a menu of one-line descriptions. The author-agent picks what is relevant per plan.

**Rationale:**
- Most subsections are relevant only to specific plan types (CLI tools, APIs)
- Plans routinely include only 1-3 subsections and ignore the rest
- The fully-expanded templates force authors to mentally skip past irrelevant content

**Implications:**
- ~180 lines replaced with ~15 lines
- The Specification section is not a required section in the validator, so no code impact

#### [D08] State commit rule once in preamble (DECIDED) {#d08-commit-rule-once}

**Decision:** Remove the per-step "Commit after all checkpoints pass." footer. State the rule once in the Execution Steps preamble blockquote.

**Rationale:**
- This is a universal rule enforced mechanically by the implement skill's orchestration loop
- Repeating it in every step wastes tokens

**Implications:**
- Per-step template loses ~1 line
- Preamble gains one sentence

#### [D09] Drop Rollback from step template (DECIDED) {#d09-drop-rollback}

**Decision:** Remove `**Rollback:**` from the step template. Plans with genuinely complex rollback needs document them in their step's Tasks section.

**Rationale:**
- For virtually every step, rollback is "revert the commit" -- obvious and adds noise
- The implement skill does not use rollback instructions; failed steps are retried by the coder
- The parser.rs rollback sentinel is kept for backward compatibility with old plans

**Implications:**
- Per-step template loses ~2 lines
- conformance-agent.md removes Rollback from required step fields list
- critic-agent.md removes rollback-related review checklist items
- author-agent.md removes "strengthen rollback procedures" guidance

#### [D10] Remove Stakeholders section (DECIDED) {#d10-remove-stakeholders}

**Decision:** Delete the Stakeholders / Primary Customers section from the Phase Overview.

**Rationale:**
- Every plan fills this with formulaic entries ("Implementer agent", "Plan users")
- For a single-user internal project, this is pure noise
- Not checked by the validator or referenced by any agent

**Implications:**
- ~3 lines removed from skeleton

#### [D11] Mark Compatibility/Migration as optional (DECIDED) {#d11-compat-optional}

**Decision:** Ensure the Compatibility / Migration / Rollout heading includes "(Optional)". Keep section in place; no new wrapper section.

**Rationale:**
- Only 8 of 44 plans use this section, and most briefly
- Useful when applicable but should not appear to be a first-class required section
- User answer specified: add "(Optional)" to heading, keep section in place

**Implications:**
- The current skeleton already has "(Optional)" on this heading (line 533). This is a no-op change, but the checkpoint confirms it remains after the rewrite.

#### [D12] Consolidate reference conventions (DECIDED) {#d12-consolidate-refs}

**Decision:** Keep 8 actively-used anchor prefixes (step-N, dNN, tNN, sNN, rNN, lNN, mNN, qNN, plus domain anchors). Drop 7 unused prefixes (cNN, diagNN, op-, cmd-, type-, seq-, fixture-).

**Rationale:**
- Empirical audit of 44 plans shows the 7 dropped prefixes have 0-3 occurrences total
- The extensive prefix table creates the illusion that all conventions are expected
- The surviving 8 prefixes cover all actual usage patterns

**Implications:**
- Reference conventions section becomes shorter and more focused
- No code impact: the validator's E005 anchor format check uses a generic regex

---

### Specification {#specification}

> This plan's specification is the 12 changes enumerated in the roadmap document. Each change is a self-contained edit with clear before/after. The design decisions above capture the rationale. The execution steps below specify exactly what to edit in each file.

**Spec S01: Validator W007 Change** {#s01-validator-w007}

In `tugcode/crates/tugtool-core/src/validator.rs`, function `check_step_dependencies` (line 850): change `step.number != "0"` to `step.number != "1"`. The comment on line 849 changes from "Step 0 is allowed" to "Step 1 is allowed".

**Spec S02: Worktree Artifact Dir Change** {#s02-worktree-artifact-dirs}

In `tugcode/crates/tugcode/src/commands/worktree.rs`, the per-step artifact directory loop (line 625): replace `format!("step-{}", idx)` with direct use of the step anchor from the `all_steps` Vec. For top-level steps, the anchor (e.g., "step-1") becomes the directory name. Substeps share their parent step's directory (no separate artifact dirs for substeps).

**Spec S03: Agent Doc Updates** {#s03-agent-doc-updates}

| File | Change |
|------|--------|
| `conformance-agent.md` | "except Step 0" -> "except Step 1" (3 occurrences: rule prose line 149, rule template line 154, example JSON output line 326); remove "Rollback" from required step fields list |
| `author-agent.md` | "except Step 0" -> "except Step 1"; remove "strengthen rollback procedures" from completeness guidance |
| `critic-agent.md` | Remove "Are rollback procedures realistic?" from completeness checklist; remove rollback from review process |
| `architect-agent.md` | Update example `step-0` -> `step-1`; update `all_steps` example arrays |
| `coder-agent.md` | Update example `step_anchor: "step-0"` -> `"step-1"` |
| `overviewer-agent.md` | Update "Step-0" -> "Step-1" in example JSON finding (line 63) |

**Spec S04: Skill Doc Updates** {#s04-skill-doc-updates}

In `tugplug/skills/implement/SKILL.md`: update all `step-0` references to `step-1` in examples and prose. Update `all_steps` example arrays. Change "spawned during step 0" to "spawned during step 1". Update agent spawn table (step 0 -> step 1 column).

---

### Symbol Inventory {#symbol-inventory}

> No new crates, files, or symbols are introduced. This plan modifies existing files only.

**Table T01: Files Modified** {#t01-files-modified}

| File | Change Type |
|------|-------------|
| `.tugtool/tugplan-skeleton.md` | Rewrite (12 changes applied) |
| `tugcode/crates/tugtool-core/src/validator.rs` | 1-line code change (Step 2) + W007 test restructure (Step 2) + ~27 test assertion updates + ~5 comment/error-message updates (Step 3) |
| `tugcode/crates/tugcode/src/commands/worktree.rs` | ~5-line code change |
| `tugcode/crates/tugtool-core/src/parser.rs` | ~23 test assertion updates (no production code change) |
| `tugcode/crates/tugtool-core/src/state.rs` | ~186 test assertion updates (no production code change) |
| `tugcode/crates/tugtool-core/src/types.rs` | ~1 test assertion update (no production code change) |
| `tugcode/crates/tugcode/src/commands/commit.rs` | ~9 test assertion updates (no production code change) |
| `tugcode/crates/tugcode/src/commands/status.rs` | ~1 test assertion update (no production code change) |
| `tugcode/crates/tugcode/src/commands/doctor.rs` | ~2 test assertion updates (no production code change) |
| `tugcode/crates/tugcode/src/commands/log.rs` | ~12 test assertion updates (no production code change) |
| `tugcode/crates/tugcode/src/cli.rs` | ~7 test assertion updates (no production code change) |
| `tugcode/crates/tugcode/tests/state_integration_tests.rs` | ~139 test assertion updates |
| `tugcode/crates/tugcode/tests/cli_integration_tests.rs` | ~4 test assertion updates |
| `tugcode/crates/tugcode/tests/worktree_integration_tests.rs` | ~4 test assertion updates |
| `tugcode/tests/fixtures/valid/*.md` | 5 fixture files updated |
| `tugcode/tests/fixtures/invalid/*.md` | 5 fixture files updated |
| `tugcode/tests/fixtures/golden/status_fallback.json` | 5 reference updates |
| `tugcode/tests/bin/claude-mock-plan` | 3 reference updates |
| `tugplug/agents/conformance-agent.md` | Step numbering + Rollback field removal |
| `tugplug/agents/author-agent.md` | Step numbering + rollback guidance removal |
| `tugplug/agents/critic-agent.md` | Rollback checklist removal |
| `tugplug/agents/architect-agent.md` | Step numbering in examples |
| `tugplug/agents/coder-agent.md` | Step numbering in examples |
| `tugplug/agents/overviewer-agent.md` | Step numbering in example JSON |
| `tugplug/skills/implement/SKILL.md` | Step numbering throughout |

---

### Test Plan Concepts {#test-plan-concepts}

> The primary test strategy is to run the existing test suite (`cargo nextest run`) after making changes. The tests themselves are being updated, not new tests added.

| Category | Purpose | Application |
|----------|---------|-------------|
| **Existing unit tests** | Verify parser, validator, state logic | Update step-0 -> step-1 references in assertions; verify W007 now exempts step 1 |
| **Existing integration tests** | Verify CLI commands, worktree, commit flow | Update step-0 -> step-1 in test plan fixtures and assertions |
| **Existing golden tests** | Verify output format stability | Update `status_fallback.json` golden file |
| **Grep checks** | Verify skeleton content removal | Grep for removed keywords (Beads, step-0, Rollback, etc.) to confirm absence |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **Patterns:**
> - If a step is big, split into **substeps** (`Step 2.1`, `Step 2.2`, ...) with separate commits and checkpoints.
> - After completing a multi-substep step, add a **Step N Summary** block.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name).

#### Step 1: Rewrite the Skeleton {#step-1}

<!-- Step 1 is intentionally the root step with no dependencies. The current validator (W007) exempts step-0, not step-1, so this step triggers a spurious warning. Step 2 of this plan updates the W007 exemption to step-1. -->

**Commit:** `refactor(skeleton): apply 12 modernization changes`

**References:** [D01] Steps start at 1, [D02] Retire phase numbering, [D03] Remove Beads, [D04] Remove size guidance, [D05] Remove audit pattern, [D06] Trim test plan, [D07] Trim specification, [D08] Commit rule once, [D09] Drop Rollback, [D10] Remove Stakeholders, [D11] Compat optional, [D12] Consolidate refs, (#design-decisions, #strategy)

**Artifacts:**
- `.tugtool/tugplan-skeleton.md` (rewritten)

**Tasks:**
- [ ] Remove the `Phase X.Y:` prefix from the document title heading
- [ ] Remove the Section Numbering Convention table and all X.Y references from headings
- [ ] Remove the Beads Root row from Plan Metadata
- [ ] Delete Beads linkage section (section 5) and Beads hints block (section 5b)
- [ ] Remove all `**Bead:**` comments from step templates
- [ ] Remove "beads-compatible" from Depends-on section title and Beads mapping paragraph
- [ ] Delete the Document Size Guidance section entirely
- [ ] Delete the Audit / Improvement Round step pattern entirely
- [ ] Trim Test Plan Concepts: keep heading and test categories table, remove fixture subsections
- [ ] Replace Specification subsection templates with a menu of one-liners
- [ ] Remove per-step `**Commit after all checkpoints pass.**` footer; add the rule once in the Execution Steps preamble
- [ ] Remove `**Rollback:**` from all step templates
- [ ] Remove the Stakeholders / Primary Customers subsection from Phase Overview
- [ ] Preserve the existing "(Optional)" marker on the Compatibility / Migration / Rollout heading (already present in current skeleton)
- [ ] Trim reference conventions: keep 8 active prefixes, drop 7 unused prefixes
- [ ] Renumber step examples: Step 0/1/2 become Step 1/2/3; update all anchors accordingly
- [ ] Update `**Depends on:**` examples to reference `#step-1` instead of `#step-0`
- [ ] Verify the resulting skeleton is under 450 lines

**Tests:**
- [ ] Grep: skeleton contains no references to Beads, step-0, `**Rollback:**`, Stakeholders, Document Size Guidance, Audit / Improvement Round
- [ ] Grep: skeleton contains no `X.Y` section numbering (no `### X.Y` or `#### X.Y` headings)

**Checkpoint:**
- [ ] `grep -i "beads\|step-0\|Stakeholders\|Document Size Guidance\|Audit.*Improvement" .tugtool/tugplan-skeleton.md` returns no matches
- [ ] `grep "^\*\*Rollback:\*\*" .tugtool/tugplan-skeleton.md` returns no matches
- [ ] The skeleton contains the "(Optional)" marker on the Compatibility/Migration heading
- [ ] Line count is under 450 (`wc -l .tugtool/tugplan-skeleton.md`)

---

#### Step 2: Update Rust Source Code {#step-2}

**Depends on:** #step-1

**Commit:** `fix(validator,worktree): update step numbering from 0-based to 1-based`

**References:** [D01] Steps start at 1, Spec S01, Spec S02, (#s01-validator-w007, #s02-worktree-artifact-dirs)

**Artifacts:**
- `tugcode/crates/tugtool-core/src/validator.rs` (W007 check updated)
- `tugcode/crates/tugcode/src/commands/worktree.rs` (artifact dir naming updated)

**Tasks:**
- [ ] In `validator.rs` function `check_step_dependencies`: change `step.number != "0"` to `step.number != "1"` and update the comment
- [ ] In `worktree.rs` artifact dir loop: replace `format!("step-{}", idx)` with use of the step anchor from `all_steps` Vec element directly, for top-level steps only
- [ ] Update the warning message in worktree.rs to use the anchor name instead of idx
- [ ] Run `cargo fmt --all` from the `tugcode/` directory
- [ ] Verify `cargo build` passes (warnings are errors)

**Tests:**
- [ ] Unit test: Restructure `test_w007_step_no_dependencies` in validator.rs so its inline plan uses step-1 as the first step. Confirm step 1 is exempt from W007 and step 2+ triggers W007. (This test requires restructuring, not just string replacement, because the inline plan content has Step 0 and Step 1 with specific dependency semantics.)
- [ ] Integration test: worktree artifact dirs are named by step anchor, not enumerate index

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` -- the W007 and worktree tests pass (other tests may still fail due to step-0 references; that is expected and addressed in Step 3)

---

#### Step 3: Mass-Update Test References {#step-3}

**Depends on:** #step-2

**Commit:** `test: update step-0 references to step-1 across all test files`

**References:** [D01] Steps start at 1, Table T01, (#t01-files-modified, #strategy)

**Artifacts:**
- ~25 files across `tugcode/` with step-0 -> step-1 updates (see Table T01 for full list)

**Tasks:**
- [ ] Update all test fixture `.md` files in `tugcode/tests/fixtures/valid/` and `tugcode/tests/fixtures/invalid/`: renumber steps so the first step is 1, update all step anchors and Depends-on references
- [ ] Update `tugcode/tests/fixtures/golden/status_fallback.json`: change step-0 references to step-1
- [ ] Update `tugcode/tests/bin/claude-mock-plan`: change step-0 references to step-1
- [ ] Update test assertions in `tugcode/crates/tugtool-core/src/parser.rs` (~23 references)
- [ ] Update test assertions in `tugcode/crates/tugtool-core/src/validator.rs` (~27 remaining references; the W007 test was restructured in Step 2)
- [ ] Update test assertions in `tugcode/crates/tugtool-core/src/state.rs` (~186 references)
- [ ] Update test assertions in `tugcode/crates/tugtool-core/src/types.rs` (~1 reference)
- [ ] Update test assertions in `tugcode/crates/tugcode/src/commands/commit.rs` (~9 references)
- [ ] Update test assertions in `tugcode/crates/tugcode/src/commands/status.rs` (~1 reference)
- [ ] Update test assertions in `tugcode/crates/tugcode/src/commands/doctor.rs` (~2 references)
- [ ] Update test assertions in `tugcode/crates/tugcode/src/commands/log.rs` (~12 references)
- [ ] Update test assertions in `tugcode/crates/tugcode/src/cli.rs` (~7 references)
- [ ] Update `tugcode/crates/tugcode/tests/state_integration_tests.rs` (~139 references)
- [ ] Update `tugcode/crates/tugcode/tests/cli_integration_tests.rs` (~4 references)
- [ ] Update `tugcode/crates/tugcode/tests/worktree_integration_tests.rs` (~4 references)
- [ ] Update production-code comments and error message examples in `validator.rs` that use step-0 as a format example (lines 21, 595, 602, 610, 630) to use step-1 instead
- [ ] Run `cargo fmt --all` from the `tugcode/` directory
- [ ] Verify no remaining `step-0` references that should have been updated (search the codebase, excluding the parser.rs backward-compat sentinel for rollback)

**Tests:**
- [ ] Full test suite: `cd tugcode && cargo nextest run` passes with zero failures

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` exits 0 with all tests passing
- [ ] A search for `step-0` in test files returns only the parser.rs rollback sentinel and any intentional backward-compat test cases

---

#### Step 4: Update Agent and Skill Documentation {#step-4}

**Depends on:** #step-3

**Commit:** `docs(agents,skills): update for skeleton modernization`

**References:** [D01] Steps start at 1, [D09] Drop Rollback, Spec S03, Spec S04, (#s03-agent-doc-updates, #s04-skill-doc-updates)

**Artifacts:**
- `tugplug/agents/conformance-agent.md`
- `tugplug/agents/author-agent.md`
- `tugplug/agents/critic-agent.md`
- `tugplug/agents/architect-agent.md`
- `tugplug/agents/coder-agent.md`
- `tugplug/agents/overviewer-agent.md`
- `tugplug/skills/implement/SKILL.md`

**Tasks:**
- [ ] conformance-agent.md: Change "except Step 0" to "except Step 1" (3 occurrences: rule prose line 149, rule template line 154, example JSON output line 326); remove "Rollback" from required step fields list (line 218)
- [ ] author-agent.md: Change "except Step 0" to "except Step 1"; remove "strengthen rollback procedures" from completeness guidance
- [ ] critic-agent.md: Remove "Are rollback procedures realistic?" from completeness checklist (line 211); remove rollback from review process (line 347)
- [ ] architect-agent.md: Update `step-0` to `step-1` in example payloads (lines 57-58); update `all_steps` arrays; update "step 0" prose reference (line 132)
- [ ] coder-agent.md: Update `step_anchor: "step-0"` to `"step-1"` in example (line 54)
- [ ] overviewer-agent.md: Update "Step-0" to "Step-1" in example JSON finding (line 63)
- [ ] implement/SKILL.md: Update all `step-0` references to `step-1` in examples, prose, and agent spawn table; update `all_steps` arrays; change "spawned during step 0" to "spawned during step 1"

**Tests:**
- [ ] Grep verification: no remaining `step-0` references in updated agent/skill docs
- [ ] Grep verification: no remaining "Rollback" as a required step field in conformance-agent.md

**Checkpoint:**
- [ ] `grep -r "step-0" tugplug/agents/ tugplug/skills/implement/SKILL.md` returns no matches
- [ ] `grep "Rollback" tugplug/agents/conformance-agent.md` returns no matches for required-field context

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the plan. Keep it crisp and testable.

**Deliverable:** A modernized tugplan skeleton with 12 changes applied, supported by updated Rust code, tests, and documentation.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `.tugtool/tugplan-skeleton.md` reflects all 12 changes and is under 450 lines
- [ ] Grep checks confirm no removed content remains in skeleton (Beads, step-0, Rollback template, Stakeholders, X.Y numbering)
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes with zero failures
- [ ] No agent or skill doc references step-0, Rollback (as required field), Beads, or X.Y numbering

**Acceptance tests:**
- [ ] Skeleton content: grep checks for removed keywords return no matches
- [ ] Build: `cd tugcode && cargo build` succeeds
- [ ] Test suite: `cd tugcode && cargo nextest run` all pass
- [ ] Doc search: `grep -r "step-0" tugplug/` returns no matches in agent/skill docs

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Sync the `tugcode/.tugtool/` copy of the skeleton from the root copy
- [ ] Consider whether the parser should emit a deprecation info diagnostic for step-0 in new plans
- [ ] Evaluate whether the conformance-agent should check for removed skeleton features in new plans

| Checkpoint | Verification |
|------------|--------------|
| Skeleton modernized | Grep checks confirm no removed content; line count under 450 |
| Rust code updated | `cd tugcode && cargo build` succeeds |
| All tests pass | `cd tugcode && cargo nextest run` exits 0 |
| Docs updated | No step-0 / Rollback references in agent/skill docs |
