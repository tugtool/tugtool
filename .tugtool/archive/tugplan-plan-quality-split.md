## Phase 1.0: Split Critic into Conformance + Quality Review {#phase-slug}

**Purpose:** Separate the critic-agent's structural conformance checks from its quality/implementability review, enabling parallel execution with focused context windows and appropriate model selection for each concern.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | plan-quality-split |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-24 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The critic-agent currently combines two fundamentally different responsibilities: mechanical format validation (skeleton compliance, anchor checking, structural rules) and deep quality review (internal consistency, technical soundness, implementability, source code verification). These pull in opposite directions. Conformance checking fills the context window with structural minutiae before the critic reaches the hard questions about whether the plan will actually work. The result is plans that pass structural validation but still need significant revision for implementation readiness.

The design document at `roadmap/plan-quality-split.md` provided the initial architecture vision: a new conformance-agent (Sonnet, mechanical, fast) runs in parallel with a revised critic-agent (Opus, analytical, adversarial). Both must APPROVE for the plan to pass. This plan is the authoritative specification going forward; it refines and extends the design document based on review feedback and user decisions. Where this plan and the design document differ, this plan governs.

#### Strategy {#strategy}

- Create the conformance-agent as a net-new file extracting the structural/format checking responsibility from the current critic-agent
- Rewrite the critic-agent to remove all conformance logic and add the new quality-focused output contract (findings, assessment, clarifying questions, area ratings)
- Update the author-agent input contract to replace the single `critic_feedback` field with separate `conformance_feedback`, `critic_feedback` (new schema), and `critic_question_answers` fields
- Update the plan skill to dispatch conformance + critic in parallel, handle clarifying questions via AskUserQuestion, and pass both feedback payloads to the author on revision
- Validate each change against the plan's spec contracts before moving to the next step
- All four files must be updated atomically (strict step ordering 0 through 3) before any production use of the new flow

#### Stakeholders / Primary Customers {#stakeholders}

1. Plan authors (human users invoking the plan skill)
2. The author-agent (consumes feedback from both review agents)
3. The plan skill orchestrator (dispatches and coordinates agents)

#### Success Criteria (Measurable) {#success-criteria}

- The conformance-agent.md file exists and its input/output contracts match this plan's specs exactly (field-by-field comparison)
- The critic-agent.md has no references to `skeleton_path`, `skeleton_check`, `skeleton_compliant`, or `tugcode validate` (verified by grep)
- The critic-agent.md output contract includes `findings`, `assessment`, `clarifying_questions`, and `area_ratings` fields matching this plan's specs
- The author-agent.md input contract includes `conformance_feedback`, `critic_feedback` (new schema), and `critic_question_answers` fields; the old `critic_feedback` shape is gone
- The plan skill dispatches conformance-agent and critic-agent in parallel (two Task calls in one message) and handles both REVISE and ESCALATE with "Start over / Accept as-is / Abort" options
- The plan skill passes critic clarifying questions to the user via AskUserQuestion using critic-supplied options (no skill-derived options; automatic "Other" provides free-text fallback) before resuming the author
- Clarifying question answers are keyed by stable question IDs assigned by the critic, not by question text
- Revision loop has max 5 rounds with stagnation detection

#### Scope {#scope}

1. Create `tugplug/agents/conformance-agent.md` (new file)
2. Rewrite `tugplug/agents/critic-agent.md` (quality-only focus)
3. Modify `tugplug/agents/author-agent.md` (dual feedback handling)
4. Modify `tugplug/skills/plan/SKILL.md` (parallel dispatch, clarifying questions flow)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changes to `tugplug/agents/clarifier-agent.md` (no changes needed)
- Changes to `tugcode validate` command behavior (conformance-agent calls it the same way the critic did)
- Changes to `.tugtool/tugplan-skeleton.md` (format stays the same)
- Changes to the author-agent output contract (same shape, consumed by skill and passed through)
- Backward compatibility with the old `critic_feedback` schema (clean replacement per user answer)

#### Dependencies / Prerequisites {#dependencies}

- The design document `roadmap/plan-quality-split.md` exists as a reference (this plan supersedes it as the authoritative specification)
- The current critic-agent, author-agent, and plan skill files exist in their current form

#### Constraints {#constraints}

- All agent files are Markdown with YAML frontmatter; no code compilation involved
- The conformance-agent must use Sonnet model (mechanical work)
- The revised critic-agent must use Opus model (deep reasoning)
- Agent output contracts must be valid JSON schemas that agents can reliably produce

#### Assumptions {#assumptions}

- The conformance-agent.md file is net-new and does not exist yet
- The critic-agent.md is a full rewrite; `skeleton_path` is removed from input, `skeleton_check` and `skeleton_compliant` are removed from output
- The author-agent.md "Resume (Revision from Critic Feedback)" section header changes to reflect two feedback sources
- Both `conformance_id` and `critic_id` are stored after first pass and both resumed in parallel for every revision loop
- Critic clarifying questions are presented via AskUserQuestion with critic-supplied `{label, description}` options (no skill-derived options); AskUserQuestion auto-appends an "Other" option for free-text input (Claude Code platform behavior); answers stored as `critic_question_answers` keyed by stable question IDs
- The clarifier-agent.md requires no changes
- Warnings from `tugcode validate` (warning_count > 0) trigger REVISE, same as structural_issues (this plan extends the design document; the plan is authoritative)
- ESCALATE gets "Start over / Accept as-is / Abort" (same structure as REVISE)
- Old `critic_feedback` field is removed entirely from the author-agent; no backward compatibility needed
- All four files must be updated in strict order (Steps 0 through 3) and all must be complete before any production use
- On resume, only the latest round's feedback is passed; agents use persistent memory for prior rounds
- If conformance returns ESCALATE, the critic agent is skipped entirely (conformance-only feedback goes to the author)

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Conformance is a separate agent, not a pre-pass within the critic (DECIDED) {#d01-separate-conformance-agent}

**Decision:** Create a dedicated conformance-agent that runs as a peer to the critic-agent, not as a phase within the critic or a sequential gate before it.

**Rationale:**
- Conformance is mechanical and deterministic; quality review is analytical and judgment-based
- Separate agents can use different models (Sonnet vs Opus) to optimize cost and latency
- Parallel execution means total review time is max(conformance, critic) rather than sum

**Implications:**
- The plan skill must manage two agent IDs and dispatch two Task calls in parallel
- The author-agent must handle two structurally different feedback schemas

#### [D02] Clean replacement of author-agent critic_feedback field (DECIDED) {#d02-clean-replacement}

**Decision:** Remove the old `critic_feedback` field entirely from the author-agent input contract and replace it with three new fields: `conformance_feedback`, `critic_feedback` (new schema), and `critic_question_answers`. No backward compatibility layer.

**Rationale:**
- The old shape (`skeleton_check` + `areas` + `issues`) conflated conformance and quality in one object
- A clean break avoids the skill having to munge two outputs into the old shape
- All three artifacts (author, critic, skill) are updated in one coordinated change

**Implications:**
- The author-agent must parse two different JSON schemas on revision
- The plan skill must pass each feedback payload as a distinct named field, never merged

#### [D03] Critic clarifying questions block the revision loop (DECIDED) {#d03-clarifying-questions-block}

**Decision:** When the critic produces clarifying questions, they are presented to the user via AskUserQuestion before the author revision. The answers are authoritative and stored as `critic_question_answers`.

**Rationale:**
- If the critic cannot determine plan correctness without answers, approving the plan is premature
- Questions represent genuine ambiguity that will surface during implementation as confusion or wrong decisions
- Better to resolve them in the planning loop than during implementation

**Implications:**
- The plan skill must check for clarifying questions after the critic completes and present them to the user
- The `critic_question_answers` field flows to the author on resume
- The critic treats non-empty clarifying questions as a REVISE trigger

#### [D04] Conformance warnings trigger REVISE (DECIDED) {#d04-warnings-trigger-revise}

**Decision:** When `tugcode validate` reports warnings (warning_count > 0), the conformance-agent recommends REVISE, same as structural_issues. Warnings are fixable problems that should be addressed. This is an intentional extension beyond the design document, which did not specify warning handling. This plan is authoritative.

**Rationale:**
- Warnings indicate real format problems that are correctable
- Treating warnings as pass-through would allow degraded plan quality to slip through
- Consistent handling: all fixable problems get REVISE, all unfixable problems get ESCALATE

**Implications:**
- The conformance-agent recommendation logic must check warning_count in addition to error_count and structural_issues
- The conformance output contract `recommendation` field reflects this: APPROVE only when no errors, no warnings, no diagnostics, and no structural issues

#### [D05] ESCALATE prompt includes Accept as-is option (DECIDED) {#d05-escalate-accept-option}

**Decision:** The ESCALATE user prompt offers "Start over / Accept as-is / Abort", matching the same three-option structure as REVISE.

**Rationale:**
- Users may want to accept a plan despite escalated issues (e.g., minor structural problems they plan to fix manually)
- Consistent UX between REVISE and ESCALATE prompts
- Preserves user agency without forcing a binary start-over-or-abort choice

**Implications:**
- The plan skill ESCALATE handler must include the "Accept as-is" option
- "Accept as-is" on ESCALATE outputs the session end message and halts with success, same as REVISE accept

#### [D06] No data munging between agents; latest-round-only on resume (DECIDED) {#d06-no-data-munging}

**Decision:** The plan skill passes agent outputs as complete, unmodified JSON objects. It never summarizes, reformats, combines, extracts fields from, or paraphrases agent outputs. On resume rounds, only the latest round's feedback is passed; agents rely on their persistent accumulated knowledge (from prior spawns/resumes) for earlier rounds.

**Rationale:**
- Each agent defines its own output contract; consuming agents know the schema
- Summarizing loses information that the receiving agent might need
- Combining outputs into a merged shape creates a maintenance burden and coupling
- Passing cumulative history on every resume causes context bloat under long review loops (token pressure, payload duplication, slower iterations)
- Agents already accumulate knowledge across resumes via the persistent agent pattern; they do not need repeated prior-round data

**Implications:**
- The author receives `conformance_feedback` and `critic_feedback` as separate, full JSON payloads (latest round only)
- The conformance-agent and critic-agent each receive `author_output` as a complete JSON object on resume (latest round only)
- The skill's relay logic is simple: store latest output, pass latest output
- Prior-round feedback is available to agents through their own accumulated context, not through repeated payload delivery

#### [D07] Conformance wins on conflict (DECIDED) {#d07-conformance-wins}

**Decision:** When critic suggestions would conflict with structural/conformance rules, conformance wins. The author fixes conformance issues first. If a critic suggestion would reintroduce a structural violation, the author defers to conformance and notes the conflict. The critic re-evaluates on the next round.

**Rationale:**
- Conformance rules are deterministic and non-negotiable; quality suggestions are judgment calls
- Without a clear arbitration rule, conflicting feedback can cause oscillation across revision rounds
- Fixing conformance first provides a stable structural foundation for quality improvements

**Implications:**
- The author-agent's revision ordering is: conformance fixes first, then critic findings
- If a critic finding would violate a structural rule, the author skips or adapts the suggestion and documents why
- The critic receives the author's output on next resume and can adjust its suggestion to work within structural constraints

#### [D08] Max 5 revisions with stagnation detection (DECIDED) {#d08-max-revisions}

**Decision:** The revision loop has a hard cap of 5 rounds. Additionally, if the same HIGH or CRITICAL findings persist unchanged across two consecutive rounds (stagnation), the skill forces escalation to the user regardless of round count.

**Rationale:**
- Unbounded loops waste resources and user patience if agents cannot converge
- Stagnation (same findings repeated) indicates a fundamental disagreement or limitation that will not resolve through more iterations
- The user is the ultimate arbiter when agents cannot converge

**Implications:**
- The plan skill tracks `revision_count` and halts at 5 with forced user escalation
- The skill compares current-round HIGH+ finding IDs against previous-round HIGH+ finding IDs; if identical set persists, force escalation
- The critic assigns stable finding IDs (e.g., "F1", "F2") that persist across rounds for the same conceptual issue, consistent with the stable question ID pattern in [D09]
- Forced escalation uses the same "Start over / Accept as-is / Abort" prompt as ESCALATE

#### [D09] Clarifying questions with critic-supplied options, stable IDs, and Other fallback (DECIDED) {#d09-free-text-questions}

**Decision:** Critic clarifying questions include 1-2 suggested answer options provided by the critic itself as `{label, description}` objects matching the AskUserQuestion contract. AskUserQuestion auto-appends an "Other" option that accepts free-text input (Claude Code platform behavior -- no skill-layer work needed). Answers are keyed by stable question IDs assigned by the critic (e.g., "CQ1", "CQ2"), not by question text. The skill does not derive or synthesize its own options -- it passes the critic's suggested options directly to AskUserQuestion.

**Rationale:**
- AskUserQuestion requires 2-4 options per question as `{label, description}` objects; pure free-text-only is not supported by the tool contract
- The critic is best positioned to suggest likely answers because it understands the question's context and the plan's ambiguity
- Skill-derived options risk misrepresenting the critic's intent; critic-supplied options are authoritative
- Having the critic output `{label, description}` objects directly avoids data transformation by the skill, consistent with [D06] no data munging
- AskUserQuestion auto-appends an "Other" option for free-text input (Claude Code platform behavior), ensuring the user can always provide a fully free-form answer without any skill-layer work
- Using question text as key is brittle if the critic rewords the question between rounds; stable IDs survive rewording

**Implications:**
- The critic output `clarifying_questions` array gains `id` (string, e.g., "CQ1") and `options` (array of 1-2 `{label, description}` objects matching AskUserQuestion format) fields
- `critic_question_answers` is keyed by question ID, not question text
- The skill passes critic-supplied `{label, description}` options directly to AskUserQuestion (no derivation, no transformation); the user sees those options plus the platform-provided "Other" for free-text
- The critic must assign unique, stable IDs that persist across rounds for the same conceptual question
- The critic must provide meaningful, non-trivial options that represent genuinely different answers (not "Yes"/"No" unless the question is truly binary)

#### [D10] Conformance ESCALATE discards critic output (DECIDED) {#d10-conformance-escalate-skips-critic}

**Decision:** When conformance returns ESCALATE, the critic's output is discarded and only conformance feedback goes to the author. The specific dispatch behavior depends on context:

- **First pass:** Both agents are spawned in parallel. If conformance ESCALATEs, the critic's output (which ran in parallel) is discarded.
- **Revision after a prior conformance ESCALATE:** Two-part sequential dispatch per Spec S12 exception. Conformance is resumed first. If conformance passes (not ESCALATE), the critic is resumed sequentially in the same round. If conformance still ESCALATEs, the critic is not resumed.

**Rationale:**
- If the plan has fundamental structural problems (validation errors, P-code diagnostics), quality review is premature and wasteful
- On first pass, parallel spawn with conditional discard is simpler than sequential gating and wastes at most one critic run
- On recovery rounds, two-part sequential dispatch ensures `critic_feedback` is always populated when the combined recommendation logic (Spec S13 Step C) needs it

**Implications:**
- The skill's combined recommendation logic (Spec S13 Step B) checks conformance ESCALATE before examining critic output
- When conformance ESCALATE causes critic output to be discarded, only `conformance_feedback` is non-null in the author resume; `critic_feedback` is null
- The two-part sequential dispatch on recovery rounds adds a conditional branch to the skill's revision loop (see Spec S12 exception)

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 File Inventory {#file-inventory}

**Table T01: Files Changed** {#t01-files-changed}

| File | Change Type | Description |
|------|-------------|-------------|
| `tugplug/agents/conformance-agent.md` | New | Structural/format conformance agent |
| `tugplug/agents/critic-agent.md` | Rewrite | Quality-only review agent |
| `tugplug/agents/author-agent.md` | Modify | Dual feedback handling |
| `tugplug/skills/plan/SKILL.md` | Modify | Parallel dispatch, clarifying questions |

#### 1.0.1.2 Conformance Agent Contract {#conformance-contract}

**Spec S01: Conformance Agent Input (Fresh Spawn)** {#s01-conformance-input}

```json
{
  "plan_path": ".tugtool/tugplan-<slug>.md",
  "skeleton_path": ".tugtool/tugplan-skeleton.md"
}
```

**Spec S02: Conformance Agent Input (Resume)** {#s02-conformance-resume}

The skill resumes with the author's full output JSON:

```
Author has revised the plan. Author output: <author_output JSON>.
Re-check conformance focusing on whether prior violations were fixed.
```

**Spec S03: Conformance Agent Output** {#s03-conformance-output}

```json
{
  "skeleton_compliant": true,
  "validation_result": {
    "passed": true,
    "error_count": 0,
    "warning_count": 0,
    "diagnostic_count": 0,
    "issues": [],
    "diagnostics": []
  },
  "structural_issues": [],
  "recommendation": "APPROVE"
}
```

Fields: `skeleton_compliant` (true only when validate passes strict AND no structural issues), `validation_result` (direct output from `tugcode validate`), `structural_issues` (array of `{rule, location, description, suggestion}` objects), `recommendation` (APPROVE / REVISE / ESCALATE).

**Spec S04: Conformance Recommendation Logic** {#s04-conformance-recommendation}

```
if tugcode validate reports errors → ESCALATE
if tugcode validate reports diagnostics (P-codes) → ESCALATE
if tugcode validate reports warnings (warning_count > 0) → REVISE
if any structural_issues found → REVISE
else → APPROVE
```

#### 1.0.1.3 Revised Critic Agent Contract {#critic-contract}

**Spec S05: Critic Agent Input (Fresh Spawn)** {#s05-critic-input}

```json
{
  "plan_path": ".tugtool/tugplan-<slug>.md"
}
```

No `skeleton_path` field. The critic does not check conformance.

**Spec S06: Critic Agent Input (Resume)** {#s06-critic-resume}

```
Author has revised the plan. Author output: <author_output JSON>.
User answered your clarifying questions: <critic_question_answers JSON>.
Re-review focusing on whether prior findings were addressed and questions resolved.
```

**Spec S07: Critic Agent Output** {#s07-critic-output}

```json
{
  "findings": [
    {
      "id": "F1",
      "severity": "HIGH",
      "area": "internal_consistency",
      "title": "...",
      "description": "...",
      "references": ["[D06]", "Spec S03"],
      "suggestion": "..."
    }
  ],
  "assessment": {
    "quality": "...",
    "coherence": "...",
    "technical_choices": "...",
    "implementation_strategy": "..."
  },
  "clarifying_questions": [
    {
      "id": "CQ1",
      "question": "...",
      "context": "...",
      "impact": "...",
      "options": [
        {"label": "likely answer A", "description": "rationale for A"},
        {"label": "likely answer B", "description": "rationale for B"}
      ]
    }
  ],
  "area_ratings": {
    "internal_consistency": "PASS",
    "technical_soundness": "PASS",
    "implementability": "PASS",
    "completeness": "PASS",
    "risk_feasibility": "PASS"
  },
  "recommendation": "APPROVE"
}
```

**Spec S08: Critic Recommendation Logic** {#s08-critic-recommendation}

```
if any CRITICAL finding → ESCALATE
else if any HIGH finding → REVISE
else if any area_rating is FAIL → REVISE
else if clarifying_questions is non-empty → REVISE
else → APPROVE
```

#### 1.0.1.4 Updated Author Agent Contract {#author-contract}

**Spec S09: Author Agent Input (Fresh Spawn)** {#s09-author-input}

```json
{
  "idea": "string | null",
  "plan_path": "string | null",
  "user_answers": { ... },
  "clarifier_assumptions": ["string"],
  "conformance_feedback": null,
  "critic_feedback": null,
  "critic_question_answers": null
}
```

Removed: old `critic_feedback` field (shape: `{skeleton_compliant, skeleton_check, areas, issues, recommendation}`).

Added: `conformance_feedback` (conformance output JSON or null), `critic_feedback` (new critic output JSON or null), `critic_question_answers` (object keyed by stable question ID e.g. `{"CQ1": "answer text", "CQ2": "answer text"}`, or null).

**Spec S10: Author Agent Output** {#s10-author-output}

Unchanged from current contract:

```json
{
  "plan_path": ".tugtool/tugplan-<slug>.md",
  "created": true,
  "sections_written": [...],
  "skeleton_compliance": { ... },
  "validation_status": "valid"
}
```

#### 1.0.1.5 Updated Plan Skill Orchestration {#skill-orchestration}

**Spec S11: Plan Skill State Variables** {#s11-skill-state}

```
clarifier_id = null
author_id = null
conformance_id = null
critic_id = null
conformance_feedback = null
critic_feedback = null
critic_question_answers = null
revision_count = 0
max_revision_count = 5
previous_high_findings = []     # IDs of HIGH+ findings from prior round (for stagnation detection)
```

**Spec S12: Parallel Dispatch (Latest-Round-Only)** {#s12-parallel-dispatch}

Both agents dispatched in a single message with two Task calls. On resume, only the latest round's author output is passed; agents use their persistent accumulated knowledge for prior rounds per [D06].

First pass (FRESH spawn both):
```
Task(subagent_type: "tugplug:conformance-agent", prompt: <Spec S01 JSON>, description: "Check plan conformance")
Task(subagent_type: "tugplug:critic-agent", prompt: <Spec S05 JSON>, description: "Review plan quality")
```

Revision loop — normal case (RESUME both in parallel — latest round only):
```
Task(resume: <conformance_id>, prompt: <Spec S02 text with latest author_output>, description: "Re-check plan conformance")
Task(resume: <critic_id>, prompt: <Spec S06 text with latest author_output + critic_question_answers>, description: "Re-review plan quality")
```

Revision loop — after prior conformance ESCALATE per [D10]:
```
# Part 1: Resume conformance only
Task(resume: <conformance_id>, prompt: <Spec S02 text with latest author_output>, description: "Re-check plan conformance")

# Part 2: If conformance now passes (not ESCALATE), resume critic sequentially
if conformance.recommendation != ESCALATE:
    Task(resume: <critic_id>, prompt: <Spec S06 text with latest author_output + critic_question_answers>, description: "Re-review plan quality")
# If conformance still ESCALATEs, critic remains skipped; critic_feedback stays null
```

This two-phase approach ensures that after a conformance ESCALATE recovery, the critic always runs in the same round that conformance passes, so `critic_feedback` is never null when Spec S13 Step C executes.

**Spec S13: Combined Recommendation Evaluation** {#s13-combined-recommendation}

```
# Step A: Check loop limits
if revision_count >= max_revision_count:
    force escalation: AskUserQuestion "Max revisions reached. Start over / Accept as-is / Abort"
    → handle user choice and halt

# Step B: Check conformance ESCALATE (skips critic per [D10])
# This must run before stagnation detection because critic_feedback may be null
# when conformance ESCALATEd and the critic was skipped.
if conformance.recommendation == ESCALATE:
    discard critic_feedback (set to null)
    previous_high_findings = []    # reset stagnation tracking (no critic data)
    AskUserQuestion: "Start over / Accept as-is / Abort"
    → only conformance_feedback flows to author on resume

# Step C: Check stagnation (same HIGH+ findings persist across two consecutive rounds)
# Safe to access critic_feedback.findings here: Step B already handled the null case.
current_high_findings = [f.id for f in critic_feedback.findings if f.severity in (CRITICAL, HIGH)]
if revision_count > 0 and set(current_high_findings) == set(previous_high_findings) and len(current_high_findings) > 0:
    force escalation: AskUserQuestion "Stagnation detected — same critical issues persist. Start over / Accept as-is / Abort"
    → handle user choice and halt
previous_high_findings = current_high_findings

# Step D: Check remaining escalation/revision
if critic.recommendation == ESCALATE:
    AskUserQuestion: "Start over / Accept as-is / Abort"

else if conformance.recommendation == REVISE or critic.recommendation == REVISE:
    if critic has clarifying_questions:
        for each question: AskUserQuestion(question.question, options=question.options)
        # AskUserQuestion auto-appends "Other" for free-text; skill passes critic-supplied options directly
        store answers keyed by question.id → critic_question_answers
    AskUserQuestion: "Revise / Accept as-is / Abort"

else:  // both APPROVE
    → done
```

**Spec S14: Progress Reporting Formats** {#s14-progress-reporting}

Conformance-agent:
```
**tugplug:conformance-agent**(Complete)
  Recommendation: {recommendation}
  Skeleton: {skeleton_compliant ? "compliant" : "non-compliant"}
  Validation: {error_count} errors, {diagnostic_count} diagnostics
  Structural issues: {structural_issues.length}
```

Critic-agent:
```
**tugplug:critic-agent**(Complete)
  Recommendation: {recommendation}
  Areas: consistency {area_ratings.internal_consistency} | soundness {area_ratings.technical_soundness} | implementability {area_ratings.implementability} | completeness {area_ratings.completeness} | risk {area_ratings.risk_feasibility}
  Findings: {findings.length} ({count by severity})
  Clarifying questions: {clarifying_questions.length}
  Assessment: {assessment.quality} (first sentence only)
```

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Create conformance-agent.md {#step-0}

**Commit:** `feat(tugplug): add conformance-agent for structural plan validation`

**References:** [D01] Separate conformance agent, [D04] Warnings trigger REVISE, [D06] No data munging (latest-round-only), Spec S01, Spec S02, Spec S03, Spec S04, Table T01, (#conformance-contract, #context, #strategy)

**Artifacts:**
- New file: `tugplug/agents/conformance-agent.md`

**Tasks:**
- [ ] Create `tugplug/agents/conformance-agent.md` with YAML frontmatter (name: conformance-agent, model: sonnet, permissionMode: dontAsk, tools: Read, Grep, Glob, Bash)
- [ ] Write the agent role description: structural/format conformance checking, mechanical and deterministic
- [ ] Write the Persistent Agent Pattern section (initial spawn reads skeleton + validates; resume re-checks focusing on fixed violations)
- [ ] Write the input contract for fresh spawn matching Spec S01 (`plan_path`, `skeleton_path`)
- [ ] Write the resume input description matching Spec S02 (receives author_output JSON)
- [ ] Write the output contract matching Spec S03 (`skeleton_compliant`, `validation_result`, `structural_issues`, `recommendation`)
- [ ] Write the recommendation logic matching Spec S04 (errors/diagnostics ESCALATE, warnings/structural_issues REVISE, else APPROVE)
- [ ] Write the Bash tool usage restriction: Bash provided ONLY for running `tugcode validate` commands
- [ ] Write the structural checks section: what the conformance-agent checks beyond `tugcode validate` (missing Depends on lines, decision format, anchor format, References exhaustiveness)
- [ ] Write JSON validation requirements section (validate own output before returning)
- [ ] Write error handling section (unable to read plan/skeleton)

**Tests:**
- [ ] Manual review: compare every field in the output contract against Spec S03 in this plan
- [ ] Manual review: compare recommendation logic against Spec S04 in this plan

**Checkpoint:**
- [ ] File exists at `tugplug/agents/conformance-agent.md`
- [ ] YAML frontmatter specifies model: sonnet
- [ ] Input contract matches Spec S01 field-for-field
- [ ] Output contract matches Spec S03 field-for-field
- [ ] Recommendation logic matches Spec S04 (including warnings trigger REVISE per [D04])
- [ ] No references to quality review, implementability, or source code verification
- [ ] Bash restriction is documented (only for `tugcode validate`)

**Rollback:**
- Remove the newly created `tugplug/agents/conformance-agent.md`

**Commit after all checkpoints pass.**

---

#### Step 1: Rewrite critic-agent.md for quality-only review {#step-1}

**Depends on:** #step-0

**Commit:** `refactor(tugplug): rewrite critic-agent for quality-only review`

**References:** [D01] Separate conformance agent, [D03] Clarifying questions block, [D06] No data munging (latest-round-only), [D09] Free-text questions with stable IDs, Spec S05, Spec S06, Spec S07, Spec S08, Table T01, (#critic-contract, #strategy)

**Artifacts:**
- Modified file: `tugplug/agents/critic-agent.md`

**Tasks:**
- [ ] Update YAML frontmatter description to remove "Skeleton compliance" language; keep model: opus
- [ ] Remove the "Critical Rule: Skeleton Compliance is a HARD GATE" section entirely
- [ ] Remove the "CRITICAL FIRST ACTION" paragraph about running `tugcode validate` first
- [ ] Remove `skeleton_path` from the input contract
- [ ] Rewrite the input contract for fresh spawn matching Spec S05 (`plan_path` only)
- [ ] Write the resume input description matching Spec S06 (receives author_output JSON + critic_question_answers)
- [ ] Replace the entire output contract with the new shape matching Spec S07 (`findings`, `assessment`, `clarifying_questions`, `area_ratings`, `recommendation`)
- [ ] Remove `skeleton_compliant`, `skeleton_check` fields from output contract
- [ ] Remove the "Skeleton Compliance Checks" section
- [ ] Replace the "Priority Levels" section with severity levels (CRITICAL / HIGH / MEDIUM / LOW) matching the design document
- [ ] Rewrite the recommendation logic matching Spec S08 (CRITICAL findings ESCALATE, HIGH findings REVISE, FAIL area REVISE, clarifying questions REVISE)
- [ ] Rewrite the "Quality Areas" section to use the five new areas: internal consistency, technical soundness, implementability, completeness/gaps, risk/feasibility — matching the review area descriptions in `roadmap/plan-quality-split.md` (the design document remains the reference for detailed area descriptions)
- [ ] Keep the Source Code Verification section (V1-V5) as part of implementability review
- [ ] Add the "clarifying_questions" section describing when and how the critic generates questions; specify that each question must have a stable `id` field (e.g., "CQ1", "CQ2") that persists across rounds for the same conceptual question, plus an `options` field with 1-2 `{label, description}` objects matching AskUserQuestion format per [D09]
- [ ] Specify that findings must have a stable `id` field (e.g., "F1", "F2") that persists across rounds for the same conceptual issue, used for stagnation detection per [D08]
- [ ] Add the "assessment" section describing the narrative quality assessment fields
- [ ] Update the example review to show the new output shape
- [ ] Update the error handling section to use the new output shape
- [ ] Update the JSON validation requirements to reference new fields
- [ ] Change Bash tool restriction: "Bash only for build/test feasibility checks, NOT for `tugcode validate`"

**Tests:**
- [ ] Grep verification: no occurrences of `skeleton_path`, `skeleton_check`, `skeleton_compliant`, or `tugcode validate` in the file
- [ ] Manual review: output contract matches Spec S07 field-for-field
- [ ] Manual review: recommendation logic matches Spec S08
- [ ] Manual review: five review areas match this plan's specification (internal_consistency, technical_soundness, implementability, completeness, risk_feasibility)

**Checkpoint:**
- [ ] `grep -c "skeleton_path\|skeleton_check\|skeleton_compliant" tugplug/agents/critic-agent.md` returns 0
- [ ] `grep -c "tugcode validate" tugplug/agents/critic-agent.md` returns 0
- [ ] Output contract includes `findings`, `assessment`, `clarifying_questions`, `area_ratings`
- [ ] Input contract has only `plan_path` (no `skeleton_path`)
- [ ] Five review areas present: internal_consistency, technical_soundness, implementability, completeness, risk_feasibility
- [ ] Severity levels present: CRITICAL, HIGH, MEDIUM, LOW
- [ ] Clarifying questions schema includes `id` field (stable question ID) and `options` field (1-2 `{label, description}` objects)
- [ ] Findings schema includes `id` field (stable finding ID for stagnation detection)

**Rollback:**
- Revert `tugplug/agents/critic-agent.md` to its previous version

**Commit after all checkpoints pass.**

---

#### Step 2: Update author-agent.md for dual feedback handling {#step-2}

**Depends on:** #step-0, #step-1

**Commit:** `refactor(tugplug): update author-agent for dual feedback handling`

**References:** [D02] Clean replacement, [D03] Clarifying questions block, [D06] No data munging (latest-round-only), [D07] Conformance wins on conflict, [D09] Free-text questions with stable IDs, Spec S09, Spec S10, Table T01, (#author-contract, #strategy)

**Artifacts:**
- Modified file: `tugplug/agents/author-agent.md`

**Tasks:**
- [ ] Update the "Persistent Agent Pattern" section: rename "Resume (Revision from Critic Feedback)" to "Resume (Revision from Review Feedback)" to reflect two feedback sources
- [ ] Update the resume description to explain that the author receives conformance feedback, critic feedback, and critic question answers as three separate payloads
- [ ] Replace the input contract: remove old `critic_feedback` field, add `conformance_feedback`, `critic_feedback` (new schema), and `critic_question_answers` fields matching Spec S09
- [ ] Update the input contract table to describe all three new fields
- [ ] Rewrite the "Handling Critic Feedback" section to "Handling Review Feedback" with three subsections:
  - From `conformance_feedback`: read validation_result.issues and structural_issues, fix mechanical format problems
  - From `critic_feedback`: read findings by severity, handle each area type (internal_consistency, technical_soundness, implementability, completeness, risk_feasibility)
  - From `critic_question_answers`: incorporate user answers into plan sections affected by each question
- [ ] Specify revision ordering: fix conformance issues first (mechanical and quick), then address critic findings (require thought) per [D07] conformance wins
- [ ] Add conflict resolution policy to the revision behavior section: when a critic suggestion would reintroduce a structural violation, the author defers to conformance, notes the conflict, and the critic re-evaluates next round per [D07]
- [ ] Specify that `critic_question_answers` is keyed by stable question ID (e.g., "CQ1"), not by question text per [D09]
- [ ] Update the example workflow to show the new input shape with all three null fields on first spawn
- [ ] Verify the output contract section is unchanged (Spec S10)
- [ ] Update the "Critical Requirement: Skeleton Compliance" section to note that compliance is now verified by the conformance-agent (not just "the critic agent")

**Tests:**
- [ ] Grep verification: no occurrences of the old critic_feedback shape (skeleton_compliant, skeleton_check, areas with completeness/implementability/sequencing/source_verification)
- [ ] Manual review: input contract matches Spec S09 field-for-field
- [ ] Manual review: revision behavior covers all three feedback sources with specific handling instructions

**Checkpoint:**
- [ ] Input contract has `conformance_feedback`, `critic_feedback`, `critic_question_answers` fields
- [ ] No references to old critic_feedback shape (`skeleton_check`, `areas.completeness`, `areas.implementability`, `areas.sequencing`, `areas.source_verification` as old-style area keys)
- [ ] "Handling Review Feedback" section has subsections for conformance, critic, and question answers
- [ ] Revision ordering specified: conformance first, then critic
- [ ] Conflict resolution policy present: conformance wins, critic defers
- [ ] critic_question_answers described as keyed by stable question ID
- [ ] Output contract unchanged from current

**Rollback:**
- Revert `tugplug/agents/author-agent.md` to its previous version

**Commit after all checkpoints pass.**

---

#### Step 3: Update plan skill for parallel dispatch and clarifying questions {#step-3}

**Depends on:** #step-0, #step-1, #step-2

**Commit:** `refactor(tugplug): update plan skill for parallel conformance + critic dispatch`

**References:** [D01] Separate conformance agent, [D03] Clarifying questions block, [D05] ESCALATE accept option, [D06] No data munging (latest-round-only), [D08] Max 5 revisions with stagnation, [D09] Free-text questions with stable IDs, [D10] Conformance ESCALATE skips critic, Spec S11, Spec S12, Spec S13, Spec S14, Table T01, (#skill-orchestration, #strategy)

**Artifacts:**
- Modified file: `tugplug/skills/plan/SKILL.md`

**Tasks:**
- [ ] Update state variables to add `conformance_id`, `conformance_feedback`, `critic_question_answers`, `max_revision_count`, and `previous_high_findings` matching Spec S11
- [ ] Update the ASCII orchestration diagram to show parallel conformance + critic dispatch (replace the single critic box with two parallel boxes)
- [ ] Update the "Architecture principles" list to mention conformance-agent, parallel dispatch, and latest-round-only resume payloads per [D06]
- [ ] Rewrite "Step 3" (Author) resume prompt to carry latest-round `conformance_feedback`, `critic_feedback`, and `critic_question_answers` as three separate JSON payloads matching Spec S12; emphasize latest-round-only (no cumulative history)
- [ ] Replace "Step 4" (Critic) with "Step 4" (Conformance + Critic parallel): first pass spawns both with two Task calls in one message; revision loop resumes both in parallel
- [ ] Add conformance ESCALATE short-circuit per [D10]: if conformance returns ESCALATE, discard critic output and send only conformance feedback to author. On the next revision loop after a conformance ESCALATE, use two-phase dispatch: resume conformance first, then resume critic sequentially if conformance passes (see Spec S12 exception). This guarantees critic_feedback is always non-null when Spec S13 Step C runs.
- [ ] Add clarifying questions handling: after both agents complete, if critic has clarifying_questions, present each via AskUserQuestion using critic-supplied `options` directly (no skill-derived options per [D09]); the user sees those options plus the automatic "Other" for free-text; store answers keyed by question `id`
- [ ] Rewrite "Step 5" (Handle Recommendation) to evaluate combined recommendation matching Spec S13 (including Steps A-D: max revisions, stagnation, conformance ESCALATE, then remaining evaluation)
- [ ] Add max revision count enforcement: if revision_count >= 5, force escalation per [D08]
- [ ] Add stagnation detection: compare current HIGH+ finding IDs to previous round; if identical non-empty set, force escalation per [D08]
- [ ] Update ESCALATE handler to offer "Start over / Accept as-is / Abort" (three options, matching REVISE structure per [D05])
- [ ] Update REVISE handler: clarifying questions are collected before the revise/accept/abort prompt
- [ ] Update progress reporting formats to include separate conformance-agent and critic-agent formats matching Spec S14
- [ ] Update the "Reference: Persistent Agent Pattern" table to include conformance-agent row
- [ ] Update agent ID management to include `conformance_id`
- [ ] Update the revision loop flow: after author completes, go to Step 4 (parallel review), not a single critic step

**Tests:**
- [ ] Manual review: state variables match Spec S11
- [ ] Manual review: parallel dispatch format matches Spec S12
- [ ] Manual review: recommendation evaluation matches Spec S13
- [ ] Manual review: progress reporting matches Spec S14
- [ ] Grep verification: no references to old single-critic dispatch pattern

**Checkpoint:**
- [ ] State variables include `conformance_id`, `conformance_feedback`, `critic_question_answers`, `max_revision_count`, `previous_high_findings`
- [ ] Step 4 shows two Task calls in one message (parallel dispatch)
- [ ] Conformance ESCALATE short-circuit documented: critic output discarded, only conformance feedback to author; two-phase recovery on next round (conformance first, then critic sequentially if conformance passes)
- [ ] ESCALATE handler has three options: "Start over / Accept as-is / Abort"
- [ ] REVISE handler includes clarifying questions collection using critic-supplied options (no skill-derived options) before the revise prompt
- [ ] Max revision count (5) enforcement is present
- [ ] Stagnation detection logic is present (same HIGH+ finding IDs across two rounds)
- [ ] Conformance-agent progress reporting format is present
- [ ] Critic-agent progress reporting format uses new fields (findings, area_ratings, clarifying_questions, assessment)
- [ ] Persistent Agent Pattern table has four rows: clarifier, author, conformance, critic
- [ ] ASCII diagram shows parallel dispatch
- [ ] Resume prompts carry latest-round feedback only (no cumulative history)

**Rollback:**
- Revert `tugplug/skills/plan/SKILL.md` to its previous version

**Commit after all checkpoints pass.**

---

#### Step 4: Cross-file validation and consistency check {#step-4}

**Depends on:** #step-3

**Commit:** `chore(tugplug): verify cross-file consistency of plan quality split`

**References:** [D02] Clean replacement, [D06] No data munging (latest-round-only), [D07] Conformance wins, [D08] Max revisions, [D09] Free-text questions, [D10] Conformance ESCALATE skips critic, Spec S01, Spec S03, Spec S05, Spec S07, Spec S09, Spec S12, Spec S13, (#conformance-contract, #critic-contract, #author-contract, #skill-orchestration)

**Artifacts:**
- All four files from previous steps (read-only validation)

**Tasks:**
- [ ] Verify the conformance-agent output contract (Spec S03) matches what the author-agent expects in `conformance_feedback` handling
- [ ] Verify the critic-agent output contract (Spec S07) matches what the author-agent expects in `critic_feedback` handling
- [ ] Verify the author-agent output contract (Spec S10) matches what the plan skill passes to conformance-agent and critic-agent on resume
- [ ] Verify the plan skill's Task call prompts use the correct input contract fields for each agent
- [ ] Verify the plan skill's progress reporting templates reference fields that exist in the agent output contracts
- [ ] Verify no file references the old critic output shape (`skeleton_check`, `skeleton_compliant` as critic output fields, `areas.completeness`/`areas.implementability`/`areas.sequencing`/`areas.source_verification`)
- [ ] Verify the critic's clarifying_questions schema includes `id` and `options` (array of `{label, description}` objects) fields, and that the skill passes options directly to AskUserQuestion without transformation and keys answers by `id` per [D09]
- [ ] Verify the critic's findings schema includes `id` field, and that the skill uses finding IDs (not titles) for stagnation detection per [D08]
- [ ] Verify the skill implements max revision count (5) and stagnation detection per [D08]
- [ ] Verify the skill implements conformance ESCALATE short-circuit per [D10]
- [ ] Verify the author-agent includes conflict resolution policy per [D07]
- [ ] Verify resume prompts carry latest-round-only feedback per [D06]
- [ ] Note: this plan is the authoritative source; deviations from the design document are intentional extensions (D04, D07, D08, D09, D10)

**Tests:**
- [ ] Grep across all four files: zero matches for `skeleton_check` (as an output field, excluding the conformance-agent which validates skeletons)
- [ ] Grep across critic-agent.md: zero matches for `tugcode validate`
- [ ] Grep across conformance-agent.md: zero matches for `implementability`, `technical_soundness`, `internal_consistency` (quality areas belong to critic)

**Checkpoint:**
- [ ] All cross-file references resolve: every field the author reads from conformance/critic output exists in the respective output contract
- [ ] All fields the skill passes to agents exist in the respective input contracts
- [ ] All progress reporting template fields exist in the respective output contracts
- [ ] No file references the removed old critic output shape
- [ ] Critic clarifying_questions `id` and `options` (`{label, description}` objects) flow through skill to AskUserQuestion without transformation
- [ ] Critic findings `id` field used by skill for stagnation detection (not title)
- [ ] Max revision count and stagnation detection present in skill
- [ ] Conformance ESCALATE short-circuit present in skill
- [ ] Conflict resolution policy present in author
- [ ] Resume prompts carry latest-round-only feedback
- [ ] Plan's intentional extensions beyond design document are documented (D04, D07, D08, D09, D10)

**Rollback:**
- This step is read-only validation. If issues found, go back to the relevant earlier step and fix.

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Four updated/new agent and skill files implementing the plan quality split: conformance-agent (new), critic-agent (rewritten), author-agent (modified), plan skill (modified).

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugplug/agents/conformance-agent.md` exists with Sonnet model, structural validation focus, and output contract matching this plan's specs
- [ ] `tugplug/agents/critic-agent.md` has zero references to `skeleton_path`, `skeleton_check`, `skeleton_compliant`, or `tugcode validate`; output contract matches this plan's specs; findings include stable `id` field; clarifying_questions include stable `id` and `options` fields
- [ ] `tugplug/agents/author-agent.md` input contract has `conformance_feedback`, `critic_feedback` (new schema), `critic_question_answers` (keyed by stable ID); old shape completely removed; conflict resolution policy (conformance wins) documented
- [ ] `tugplug/skills/plan/SKILL.md` dispatches conformance + critic in parallel, handles clarifying questions with critic-supplied options (no skill-derived options), evaluates combined recommendations with three-option prompts for both REVISE and ESCALATE, implements max 5 revisions with stagnation detection (using finding IDs), implements conformance ESCALATE discard with two-part recovery dispatch, uses latest-round-only resume payloads
- [ ] Cross-file consistency verified: every field consumed by one agent is produced by another agent's output contract

**Acceptance tests:**
- [ ] Integration test: invoke the plan skill with a test idea and verify both conformance-agent and critic-agent are dispatched (observable via Task calls in skill output)
- [ ] Grep verification: `grep -r "skeleton_check" tugplug/agents/critic-agent.md` returns empty
- [ ] Grep verification: `grep -r "skeleton_path" tugplug/agents/critic-agent.md` returns empty

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add automated contract validation tests that parse agent .md files and verify input/output JSON schemas match across agents
- [ ] Measure latency improvement from parallel dispatch vs sequential conformance-then-critic
- [ ] Consider adding a `--skip-conformance` flag for experienced users who want faster iteration

| Checkpoint | Verification |
|------------|--------------|
| Conformance agent exists | File at `tugplug/agents/conformance-agent.md` with correct frontmatter |
| Critic agent rewritten | Zero grep hits for removed fields |
| Author agent updated | Input contract has three new fields |
| Skill updated | Parallel dispatch visible in Task call section |
| Cross-file consistency | All field references resolve |

**Commit after all checkpoints pass.**
