## Phase 1.0: Plan Quality Overviewer {#phase-slug}

**Purpose:** Add a fresh-eyes overviewer-agent that runs as a terminal quality gate after both conformance-agent and critic-agent approve, catching real issues that the author-critic revision loop misses due to accumulated context bias.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-25 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `tugplug:plan` skill produces plans that pass its internal review process (conformance-agent + critic-agent both APPROVE) but still have significant issues visible to any fresh reader. This was demonstrated with `tugplan-checklist-reconciliation.md` (revision 4, approved by both reviewers), where a simple investigative prompt to another LLM found 3 HIGH, 3 MEDIUM, and 1 LOW findings plus 8 unresolved clarifying questions.

The root cause is structural, not prompt-related. The critic's instructions are already thorough (V1-V5 source verification, 5 quality areas). The problem is accumulated context bias: after multiple revision rounds, the critic focuses on "were my prior findings addressed?" rather than "is this plan actually ready?" The author-critic loop converges on local optima through negotiation rather than stepping back to see the whole picture. This is analogous to code review: the reviewer you have been pair-programming with will miss things that a fresh reviewer catches instantly.

#### Strategy {#strategy}

- Add a new `overviewer-agent` that runs after conformance + critic both APPROVE, providing genuinely fresh eyes on the finished plan
- Use an open-ended investigative prompt rather than the critic's structured 5-area + V1-V5 checklist, enabling deeper investigation over systematic breadth
- Give the overviewer zero context about the review history (no critic findings, no conformance results, no revision history) so it cannot be biased by prior assessment
- Require structured `code_evidence` in overviewer findings, forcing source-code-grounded claims rather than abstract concerns
- Use a single unified flow: clarifier -> author -> [conformance + critic] -> overviewer -> DONE. If any reviewer has feedback, loop back to the author
- The overviewer is ALWAYS a fresh spawn (never resumed) -- fresh eyes every time is the entire point
- Make all REVISE loops fully autonomous: auto-revise without user prompts, interrupting only for ESCALATE, stagnation, max rounds, or clarifying questions
- Cap the overviewer at 3 rounds maximum before escalating to user

#### Stakeholders / Primary Customers {#stakeholders}

1. Plan skill users who depend on plan quality for successful implementation
2. Coder agents who follow plans step-by-step and need internally consistent, source-verified plans

#### Success Criteria (Measurable) {#success-criteria}

- The overviewer-agent produces structured findings with `code_evidence` citations when given a plan path (manual test: run against `tugplan-checklist-reconciliation.md`)
- The plan skill runs the overviewer after conformance + critic both APPROVE (verified by reading SKILL.md logic)
- The author-agent correctly handles `overviewer_feedback` and `overviewer_question_answers` payloads on resume, producing a revised plan (verified by reading author-agent.md resume handling)
- The overviewer runs a maximum of 3 rounds before escalating to user (verified by reading SKILL.md state variables and loop logic)
- After overviewer-driven author revision, conformance + critic re-run and must re-approve before the overviewer runs again (verified by reading SKILL.md orchestration logic)
- All REVISE loops auto-revise without user prompts; user is only interrupted for ESCALATE, stagnation, max rounds, or clarifying questions (verified by reading SKILL.md)

**Note:** Whether the overviewer actually improves final plan quality (outcome-quality) is assessed by human judgment during usage, not by automated metrics. No quantitative quality tracking is in scope for this phase.

#### Scope {#scope}

1. New `tugplug/agents/overviewer-agent.md` agent definition file
2. Modifications to `tugplug/agents/author-agent.md` for overviewer feedback handling
3. Modifications to `tugplug/skills/plan/SKILL.md` for overviewer orchestration and auto-revise behavior

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the critic-agent, conformance-agent, or clarifier-agent
- Adding any Rust code or CLI changes to tugcode
- Changing existing output contracts for conformance-agent or critic-agent

#### Dependencies / Prerequisites {#dependencies}

- Existing plan skill orchestration must be stable and working
- The `Task` tool must support both `subagent_type` (fresh spawn) and `resume` (persistent agent) patterns
- The `AskUserQuestion` tool must be available for presenting overviewer clarifying questions to the user

#### Constraints {#constraints}

- All changes are to Markdown agent/skill definition files only; no Rust code changes
- The overviewer uses the Opus model (deep reasoning required, same as critic)
- The overviewer's input is plan_path only; it must not receive any review history
- The overviewer is always a fresh spawn; it is never resumed
- Maximum 3 overviewer rounds, then escalate to user

#### Assumptions {#assumptions}

- The overviewer-agent uses the Opus model, as specified in the roadmap
- The overviewer runs only after both conformance and critic APPROVE
- MEDIUM and LOW findings from the overviewer are informational only and do not trigger REVISE
- The author-agent resume pattern for overviewer feedback is identical to the critic feedback resume pattern
- Conformance and critic must re-approve after any overviewer-driven author revision before the overviewer runs again
- The overviewer output contract has no ESCALATE recommendation; escalation is handled by the skill when overviewer rounds exceed the cap

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Overviewer adds latency to every plan | med | high | Common case is 1 round (APPROVE); bounded at 3 rounds max | If average plan time increases unacceptably |
| Overviewer and critic produce contradictory guidance | med | med | Overviewer is final arbiter per [D10]; conformance + critic re-run after revision lets critic re-evaluate | If author cannot reconcile feedback sources |
| Overviewer's open-ended prompt produces low-signal findings | med | low | Require structured `code_evidence` for implementability claims; only HIGH/CRITICAL block | If overviewer APPROVE rate is below 50% on first round |

**Risk R01: Overviewer latency on every plan** {#r01-overviewer-latency}

- **Risk:** Every plan now requires at least one additional Opus agent run, increasing wall-clock time and API cost. When the overviewer recommends REVISE, conformance + critic must re-approve before the overviewer runs again, further increasing cost.
- **Mitigation:**
  - Common case is one round (overviewer APPROVEs); plan quality from the conformance + critic loop is already high
  - Maximum 3 overviewer rounds, then escalate to user rather than looping indefinitely
  - The cost of re-running conformance + critic (one Sonnet + one Opus call per re-run) is small relative to the risk of shipping a plan with quality regressions
- **Residual risk:** One additional Opus call is unavoidable; this is the price of not shipping plans with real issues.

**Risk R02: Contradictory feedback from overviewer vs. critic** {#r02-contradictory-feedback}

- **Risk:** The overviewer may find issues that contradict the critic's prior approval, putting the author in an impossible position.
- **Mitigation:**
  - The overviewer is the final arbiter per [D10]: when overviewer and critic conflict, overviewer direction takes precedence
  - After overviewer-driven revision, conformance + critic re-run and can re-evaluate in light of overviewer-directed changes
  - Conformance rules always take precedence over both critic and overviewer (structural integrity is non-negotiable)
  - If contradictions are fundamental, the user can "Accept as-is" or "Abort" when escalated
- **Residual risk:** Some tension between reviewers is inherent and productive; the goal is catching issues, not eliminating disagreement.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Overviewer is always a fresh-spawn investigative agent (DECIDED) {#d01-fresh-spawn}

**Decision:** The overviewer agent spawns fresh every time it runs, with no access to critic findings, conformance results, or revision history. Its only input is the plan path. The overviewer is NEVER resumed -- fresh eyes every time is the entire point.

**Rationale:**
- The core problem is accumulated context bias from the author-critic revision loop
- A fresh spawn guarantees zero contamination from prior review rounds
- Resuming the overviewer would defeat the fresh-eyes purpose; it would start focusing on "were my prior findings addressed?" just like the critic does
- The investigative prompt (no structured checklist) enables depth over breadth

**Implications:**
- The overviewer cannot reference or build on the critic's work or its own prior findings
- Each overviewer invocation costs a full Opus context read of the plan + codebase
- The overviewer may re-discover issues it found in a prior round (acceptable cost for genuinely fresh perspective)
- No `overviewer_id` state variable is needed for resume; the skill does not store agent IDs across overviewer runs

#### [D02] Overviewer uses open-ended investigative prompt, not structured checklist (DECIDED) {#d02-investigative-prompt}

**Decision:** The overviewer uses a free-form investigative prompt ("Read the plan. Read the source code it references. Investigate the proposal thoroughly. Find holes, pitfalls, weaknesses, or limitations.") rather than the critic's 5-area + V1-V5 framework.

**Rationale:**
- The structured checklist approach is already covered by the critic; duplicating it adds no value
- The GPT reviewer experiment that discovered the missed findings used exactly this kind of open-ended prompt
- Freedom from categories enables the overviewer to follow its nose and go deep on specific concerns

**Implications:**
- The overviewer's findings are not categorized by area (no `area_ratings` in output)
- The overviewer's findings require `code_evidence` to ground claims in source code
- Assessment is holistic (single string), not broken into 4 sub-assessments

#### [D03] Overviewer runs maximum 3 rounds, then escalates to user (DECIDED) {#d03-max-three-rounds}

**Decision:** The overviewer can send the plan back for revision up to 3 times. After 3 overviewer rounds still recommending REVISE, escalate to user with "Accept as-is / Abort" options.

**Note:** The roadmap document (`roadmap/plan-quality-overviewer.md`) originally specified a 2-round cap (`max_overviewer_rounds = 2`). This was overridden to 3 rounds by explicit user direction during planning.

**Rationale:**
- The plan already passed conformance and critic; overviewer findings should be addressable in a small number of rounds
- 3 rounds provides sufficient opportunity for the author to address findings without creating an unbounded loop
- After 3 rounds, remaining issues are likely fundamental enough to require user judgment

**Implications:**
- State variable `max_overviewer_rounds` is set to 3
- The skill tracks `overviewer_round` and checks against the cap
- Each overviewer round is a fresh spawn (not a resume), so round tracking is purely a safety counter

#### [D04] Overviewer has no ESCALATE recommendation (DECIDED) {#d04-no-escalate}

**Decision:** The overviewer output contract supports only APPROVE and REVISE recommendations. The skill handles escalation (to user) when overviewer rounds exceed the cap.

**Rationale:**
- The plan already survived conformance and critic review; it is structurally sound and systematically reviewed
- Any issues the overviewer finds should be fixable (REVISE) or need user judgment (handled by skill after round cap)
- Adding ESCALATE to the overviewer would require additional skill logic with minimal benefit

**Implications:**
- The overviewer recommendation enum is `APPROVE | REVISE` only
- Escalation to user is the skill's responsibility, triggered by `overviewer_round >= max_overviewer_rounds`

#### [D06] Author handles overviewer feedback identically to critic feedback (DECIDED) {#d06-author-overviewer-handling}

**Decision:** The author-agent treats `overviewer_feedback` and `overviewer_question_answers` using the same pattern as `critic_feedback` and `critic_question_answers`: read findings, understand issues, apply suggestions, incorporate user answers.

**Rationale:**
- The overviewer's findings structure (id, severity, title, description, suggestion) parallels the critic's
- Reusing the same handling pattern minimizes changes to the author-agent
- The `code_evidence` field gives the author additional source locations to verify, which is additive

**Implications:**
- The author-agent input contract adds two optional fields: `overviewer_feedback` and `overviewer_question_answers`
- The author processes overviewer findings in severity order (same as critic)
- Conflict resolution precedence (highest to lowest): conformance rules > overviewer direction > critic direction. If an overviewer suggestion would break conformance, defer to conformance. If overviewer and critic conflict on the same issue, follow the overviewer (see [D10])

#### [D08] Session end message format unchanged (DECIDED) {#d08-end-message-unchanged}

**Decision:** The existing `Plan(Complete)` end message format stays the same. Overviewer progress is shown in per-agent post-call messages, not in the session end message.

**Rationale:**
- The user answered that the existing format should not change
- Per-agent post-call messages already provide sufficient visibility into each agent's work
- Adding overviewer-specific fields to the end message would be redundant with the post-call messages

**Implications:**
- New post-call message format for overviewer-agent is defined in the skill
- The `Plan(Complete)` message continues to show plan_path, step_count, decision_count, revision_count, and next command

#### [D10] Overviewer is final arbiter when it conflicts with critic (DECIDED) {#d10-overviewer-precedence}

**Decision:** When overviewer and critic guidance conflict on the same issue, the overviewer's direction takes precedence. The author should follow overviewer suggestions even if they differ from what the critic previously approved.

**Rationale:**
- The overviewer runs after the critic and has the final say on plan quality
- The overviewer sees the plan with fresh eyes and may identify issues the critic missed or misjudged
- After overviewer-driven revision, conformance + critic re-run and can re-evaluate in light of the overviewer's direction

**Implications:**
- The author-agent must be instructed to prefer overviewer direction over prior critic direction when they conflict
- The critic may re-raise concerns during the re-run after overviewer-driven revision; the author resolves these in the context of the overviewer's guidance
- Conformance rules always take precedence over both critic and overviewer (structural integrity is non-negotiable)

#### [D11] REVISE loops auto-revise without user interaction (DECIDED) {#d11-auto-revise}

**Decision:** When any reviewer (conformance, critic, or overviewer) recommends REVISE, the skill automatically sends feedback to the author for revision without prompting the user. The revision loop runs to completion autonomously. User interaction is required ONLY for: (1) ESCALATE recommendations, (2) stagnation detection, (3) max revision/overviewer round limits reached, (4) clarifying questions that need user answers.

**Rationale:**
- Agent loops should run to completion without user interaction as much as possible
- Requiring user confirmation on every REVISE creates unnecessary friction in a multi-agent loop
- The existing safeguards (ESCALATE, stagnation detection, max rounds) already protect against runaway loops
- Clarifying questions are the one case where only the user can provide the needed information

**Implications:**
- Remove the "Review found issues. How should we proceed?" AskUserQuestion when recommendation is REVISE; auto-increment `revision_count` and go directly to author
- When overviewer recommends REVISE, auto-collect clarifying question answers if any, then auto-revise
- Keep all ESCALATE prompts, stagnation detection prompts, and max-revision/max-overviewer-round prompts unchanged
- Keep clarifying question collection (critic and overviewer clarifying questions still pause for user answers)

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Overviewer Agent Specification {#overviewer-spec}

**Spec S01: Overviewer Input Contract** {#s01-overviewer-input}

```json
{
  "plan_path": ".tugtool/tugplan-<slug>.md"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plan_path` | string | yes | Path to the plan to review |

No skeleton path, no critic findings, no conformance results, no revision history.

**Spec S02: Overviewer Output Contract** {#s02-overviewer-output}

```json
{
  "findings": [
    {
      "id": "OF1",
      "severity": "HIGH",
      "title": "Step-0 task list has internal contradiction",
      "description": "Plan says to pass the new flag through, but also says to pass false for backward compatibility. These cannot both be true for the main batch path.",
      "code_evidence": {
        "file": "tugcode/crates/tugtool-core/src/commit.rs",
        "line_start": 1,
        "line_end": 35,
        "claim": "freeform warning strings, not structured codes"
      },
      "suggestion": "Resolve the contradiction: always pass complete_remaining=true after reviewer APPROVE"
    }
  ],
  "clarifying_questions": [
    {
      "id": "OQ1",
      "question": "Should state_update_failed return a structured reason code?",
      "context": "Recovery logic currently would key off warning text strings",
      "impact": "Affects recovery loop reliability and future-proofing",
      "options": [
        {"label": "Structured enum", "description": "Add state_failure_reason enum to CommitData"},
        {"label": "Keep freeform", "description": "Accept string-matching fragility"}
      ]
    }
  ],
  "assessment": "Overall assessment paragraph - holistic, not area-by-area",
  "recommendation": "APPROVE"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `findings` | array | yes | Prioritized list of issues, sorted by severity |
| `findings[].id` | string | yes | Stable finding ID (e.g., "OF1", "OF2"); used for tracking within a single run |
| `findings[].severity` | string | yes | `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` |
| `findings[].title` | string | yes | Short title for the finding |
| `findings[].description` | string | yes | Detailed explanation with plan section references |
| `findings[].code_evidence` | object | yes | Structured source code citation grounding the finding |
| `findings[].code_evidence.file` | string | yes | File path relative to repo root |
| `findings[].code_evidence.line_start` | number | yes | Starting line number |
| `findings[].code_evidence.line_end` | number | no | Ending line number (omit if single line) |
| `findings[].code_evidence.claim` | string | yes | What the code at this location demonstrates |
| `findings[].suggestion` | string | yes | Concrete fix suggestion |
| `clarifying_questions` | array | yes | Questions the overviewer cannot answer from plan + codebase alone |
| `clarifying_questions[].id` | string | yes | Stable question ID (e.g., "OQ1", "OQ2") |
| `clarifying_questions[].question` | string | yes | The question text |
| `clarifying_questions[].context` | string | yes | Why this question matters |
| `clarifying_questions[].impact` | string | yes | What plan sections are affected |
| `clarifying_questions[].options` | array | yes | Array of `{label, description}` objects; passed to AskUserQuestion |
| `assessment` | string | yes | Holistic assessment paragraph (not area-by-area) |
| `recommendation` | string | yes | `APPROVE` or `REVISE` only |

**Spec S03: Overviewer Recommendation Logic** {#s03-overviewer-recommendation}

```
if any HIGH or CRITICAL finding -> REVISE
else if clarifying_questions is non-empty -> REVISE
else -> APPROVE
```

MEDIUM and LOW findings are informational only and do not block approval. The plan already passed the critic's systematic review; the overviewer is a final sanity check.

**Clarifying question resolution:** Clarifying questions always require a user response, but the user may respond with "defer" or "ignore" to acknowledge the question without resolving it. Any user response (including "defer/ignore") counts as resolving the block. On the next overviewer run, the overviewer (being a fresh spawn) will not have memory of prior questions. The skill passes prior `overviewer_question_answers` to the author so the author can incorporate the answers, but the overviewer itself starts clean. If the overviewer independently re-raises a substantively identical question that the user already answered, the skill should present it again (the overviewer has no way to know it was already asked).

**Spec S04: Author Input Contract Extensions** {#s04-author-extensions}

The author-agent input contract adds two optional fields for overviewer feedback:

```json
{
  "idea": "string | null",
  "plan_path": "string | null",
  "user_answers": { ... },
  "clarifier_assumptions": ["string"],
  "conformance_feedback": { ... } | null,
  "critic_feedback": { ... } | null,
  "critic_question_answers": { ... } | null,
  "overviewer_feedback": { ... } | null,
  "overviewer_question_answers": { ... } | null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `overviewer_feedback` | object or null | Overviewer output JSON (Spec S02), or null if overviewer has not run or approved |
| `overviewer_question_answers` | object or null | Object keyed by question ID (e.g., `{"OQ1": "answer"}`), or null |

**Spec S05: Overviewer State Variables** {#s05-overviewer-state}

```
overviewer_feedback = null
overviewer_question_answers = null
overviewer_round = 0
max_overviewer_rounds = 3
```

| Variable | Type | Description |
|----------|------|-------------|
| `overviewer_feedback` | object or null | Latest overviewer output JSON |
| `overviewer_question_answers` | object or null | User answers to overviewer clarifying questions |
| `overviewer_round` | integer | How many times the overviewer has run (0 = not yet, 1-3 = active) |
| `max_overviewer_rounds` | integer | Maximum overviewer runs before escalation (fixed at 3) |

Note: no `overviewer_id` variable. The overviewer is always a fresh spawn per [D01].

**Spec S06: Overviewer Post-call Message Format** {#s06-overviewer-post-call}

```
**tugplug:overviewer-agent**(Complete)
  Recommendation: {recommendation}
  Findings: {findings.length} ({count by severity})
  Clarifying questions: {clarifying_questions.length}
  Assessment: {assessment} (first sentence only)
```

The same format is used for every overviewer run (no round variant needed since each run is independent).

#### 1.0.1.2 Orchestration Flow Specification {#orchestration-flow}

**Spec S07: Unified Orchestration Flow** {#s07-orchestration-flow}

The orchestration is a single unified flow with no phase distinction:

```
clarifier -> author -> [conformance + critic] -> auto-revise loop until both APPROVE
  -> overviewer (fresh spawn) -> APPROVE -> DONE
                               -> REVISE -> author revises
                                 -> [conformance + critic] -> auto-revise loop until both APPROVE
                                   -> overviewer (fresh spawn) -> APPROVE -> DONE
                                                               -> REVISE -> (repeat up to 3 times)
                                                               -> still REVISE after 3 -> escalate to user
```

Detail:

1. **Existing flow (unchanged except for auto-revise):** Clarifier runs once. Author writes plan. Conformance + critic review in parallel. If either recommends REVISE, auto-revise (per [D11]): collect critic clarifying question answers if any, then auto-send feedback to author, author revises, conformance + critic re-review. Loop until both APPROVE. Existing ESCALATE, stagnation, and max-revision safeguards remain.

2. **Overviewer gate:** Once conformance + critic both APPROVE, run overviewer (always a fresh spawn per [D01]).
   - If overviewer recommends APPROVE -> output session end message, DONE
   - If overviewer recommends REVISE -> continue to step 3

3. **Overviewer REVISE handling (auto-revise per [D11]):**
   - Increment `overviewer_round`
   - Check `overviewer_round >= max_overviewer_rounds`: if so, escalate to user ("Overviewer still has concerns after {max_overviewer_rounds} rounds. Accept as-is / Abort")
   - If overviewer clarifying questions exist, present each to user via AskUserQuestion; store answers in `overviewer_question_answers`
   - Resume author with `overviewer_feedback` and `overviewer_question_answers`; author revises plan
   - Go back to step 1's conformance + critic review (auto-revise loop). Once both APPROVE, go to step 2 (overviewer runs fresh again)

The "Both APPROVE" branch in the existing Step 5D simply needs to add: run overviewer. No context-aware branching needed because the overviewer is always a fresh spawn and the flow always goes through the same path.

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugplug/agents/overviewer-agent.md` | Overviewer agent definition: investigative prompt, input/output contracts, recommendation logic |

#### 1.0.2.2 Modified files {#modified-files}

| File | Change |
|------|--------|
| `tugplug/agents/author-agent.md` | Add handling for `overviewer_feedback` and `overviewer_question_answers` payloads |
| `tugplug/skills/plan/SKILL.md` | Add overviewer gate after "Both APPROVE"; add auto-revise behavior for REVISE loops; add overviewer state variables and post-call message format |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Manual review** | Verify agent definition files are well-formed and internally consistent | After each step |
| **Integration** | Run the plan skill end-to-end against a test idea to verify orchestration | After Step 2 (all files modified) |

Since all changes are Markdown agent/skill definition files, testing is primarily manual review and end-to-end integration testing by running the plan skill.

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Create overviewer-agent.md {#step-0}

**Commit:** `feat(tugplug): add overviewer-agent definition`

**References:** [D01] Always fresh-spawn, [D02] Investigative prompt, [D04] No ESCALATE, Spec S01, Spec S02, Spec S03, (#overviewer-spec, #s01-overviewer-input, #s02-overviewer-output, #s03-overviewer-recommendation)

**Artifacts:**
- `tugplug/agents/overviewer-agent.md` (new file)

**Tasks:**
- [ ] Create `tugplug/agents/overviewer-agent.md` with YAML frontmatter: name `overviewer-agent`, description, model `opus`, permissionMode `dontAsk`, tools `Read, Grep, Glob, Bash`
- [ ] Write the "Your Role" section describing the overviewer as a fresh-eyes terminal quality gate that runs after conformance + critic approval. Emphasize that the overviewer is always a fresh spawn and never resumed.
- [ ] Write the investigative prompt framing per [D02]: "Read the plan. Read the source code it references. Investigate the proposal thoroughly. Ask clarifying questions. Give your assessment on its quality, coherence, the technical choices, and the implementation strategies. Do you see holes, pitfalls, weaknesses, or limitations? Could a coder follow this plan literally, step by step, and produce a working result?"
- [ ] Write the Persistent Agent Pattern section: describe that the overviewer is NOT a persistent agent -- it is always a fresh spawn. Each invocation is independent with no memory of prior runs. There is no resume pattern for this agent.
- [ ] Write the input contract matching Spec S01: plan_path only
- [ ] Write the output contract matching Spec S02: findings (with structured code_evidence object: file, line_start, line_end, claim), clarifying_questions, assessment (string), recommendation (APPROVE/REVISE)
- [ ] Write the recommendation logic matching Spec S03: HIGH/CRITICAL -> REVISE, non-empty clarifying_questions -> REVISE, else APPROVE. Include the clarifying question resolution note from Spec S03.
- [ ] Write the Bash tool usage restriction (build/test feasibility checks only, same as critic)
- [ ] Write the clarifying questions section: stable IDs (OQ1, OQ2), options as `{label, description}` matching AskUserQuestion format
- [ ] Write the JSON validation requirements section following the same pattern as critic-agent.md
- [ ] Write the error handling section (plan cannot be read -> minimal error response)
- [ ] Explicitly state in the agent definition that the overviewer does NOT check structural conformance (that is the conformance-agent's job) and does NOT use the critic's 5-area + V1-V5 framework

**Tests:**
- [ ] Manual review: verify `overviewer-agent.md` YAML frontmatter is valid (name, model, tools match spec)
- [ ] Manual review: verify input contract matches Spec S01 exactly
- [ ] Manual review: verify output contract matches Spec S02 exactly (all fields present, correct types; `code_evidence` is a structured object with `file`, `line_start`, `line_end`, `claim`)
- [ ] Manual review: verify recommendation logic matches Spec S03 (only APPROVE/REVISE, no ESCALATE; clarifying question resolution note present)
- [ ] Manual review: verify the investigative prompt is present verbatim from the roadmap
- [ ] Manual review: verify the agent definition states it is always fresh-spawned, never resumed

**Checkpoint:**
- [ ] `tugplug/agents/overviewer-agent.md` exists and is a well-formed Markdown file with valid YAML frontmatter
- [ ] The file defines input contract (plan_path only), output contract (findings with code_evidence, clarifying_questions, assessment, recommendation), and recommendation logic

**Rollback:**
- Delete `tugplug/agents/overviewer-agent.md`

**Commit after all checkpoints pass.**

---

#### Step 1: Modify author-agent.md for overviewer feedback handling {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugplug): add overviewer feedback handling to author-agent`

**References:** [D06] Author handles overviewer feedback identically to critic feedback, [D10] Overviewer is final arbiter, Spec S04, (#s04-author-extensions, #d06-author-overviewer-handling, #d10-overviewer-precedence)

**Artifacts:**
- `tugplug/agents/author-agent.md` (modified)

**Tasks:**
- [ ] Add `overviewer_feedback` and `overviewer_question_answers` fields to the Input Contract JSON example and table, matching Spec S04
- [ ] Add a new "### From `overviewer_feedback`" subsection under "## Handling Review Feedback", following the same structure as "### From `critic_feedback`":
  - Read `overviewer_feedback.findings` sorted by severity; address CRITICAL first, then HIGH, MEDIUM, LOW
  - Use `finding.code_evidence` to verify source locations before making changes
  - Use `finding.suggestion` as starting point for each fix
  - Note that overviewer findings do not have an `area` field (unlike critic findings)
- [ ] Add a new "### From `overviewer_question_answers`" subsection, following the same structure as "### From `critic_question_answers`":
  - Object keyed by stable question ID (e.g., "OQ1", "OQ2")
  - For each answered question, identify affected plan sections using the question's `impact` field
  - Incorporate user answers into affected sections
- [ ] Update the "Persistent Agent Pattern > Resume" section to mention that the author may also be resumed with overviewer feedback (in addition to conformance/critic feedback)
- [ ] Update the gate condition text in "## Handling Review Feedback" (currently reads "When any of `conformance_feedback`, `critic_feedback`, or `critic_question_answers` is non-null, you are in a revision round") to also include `overviewer_feedback` and `overviewer_question_answers`
- [ ] Add conflict resolution and precedence rules per [D06] and [D10]: conformance rules > overviewer direction > critic direction. If overviewer and critic conflict on the same issue, follow the overviewer. If an overviewer suggestion would break conformance, defer to conformance

**Tests:**
- [ ] Manual review: verify the Input Contract JSON example includes both new fields with correct types
- [ ] Manual review: verify the `overviewer_feedback` handling section correctly describes severity-ordered processing
- [ ] Manual review: verify the `overviewer_question_answers` handling section correctly describes ID-keyed answer incorporation
- [ ] Manual review: verify conflict resolution and precedence rules are present: conformance > overviewer > critic, consistent with [D06] and [D10]

**Checkpoint:**
- [ ] `tugplug/agents/author-agent.md` contains `overviewer_feedback` and `overviewer_question_answers` in its Input Contract
- [ ] The file has "From `overviewer_feedback`" and "From `overviewer_question_answers`" subsections under "Handling Review Feedback"

**Rollback:**
- Revert `tugplug/agents/author-agent.md` to its previous state (the file is under version control)

**Commit after all checkpoints pass.**

---

#### Step 2: Modify SKILL.md for overviewer orchestration {#step-2}

**Depends on:** #step-0, #step-1

**Commit:** `feat(tugplug): add overviewer gate and auto-revise to plan skill`

**References:** [D01] Always fresh-spawn, [D03] Max three rounds, [D04] No ESCALATE, [D08] End message unchanged, [D10] Overviewer precedence, [D11] Auto-revise, Spec S05, Spec S06, Spec S07, (#s05-overviewer-state, #s06-overviewer-post-call, #s07-orchestration-flow, #orchestration-flow, #d11-auto-revise)

**Artifacts:**
- `tugplug/skills/plan/SKILL.md` (modified)

**Tasks:**
- [ ] Add overviewer state variables to "### 1. Initialize State" section per Spec S05: `overviewer_feedback = null`, `overviewer_question_answers = null`, `overviewer_round = 0`, `max_overviewer_rounds = 3`. Note: no `overviewer_id` variable (overviewer is always fresh-spawned per [D01])
- [ ] Modify the "REVISE" branch in existing Step 5D per [D11]: remove the "Review found issues. How should we proceed?" AskUserQuestion. Instead, auto-collect critic clarifying question answers if any, auto-increment `revision_count`, and go directly to Step 3 (author revision). Keep all ESCALATE prompts, stagnation detection prompts, and max-revision prompts unchanged
- [ ] Modify the "Both APPROVE" branch in existing Step 5D to add overviewer gate logic per Spec S07:
  - Fresh-spawn overviewer: `Task(subagent_type: "tugplug:overviewer-agent", prompt: '{"plan_path": "<plan_path>"}', description: "Final quality review")`
  - Increment `overviewer_round`
  - Store result as `overviewer_feedback`
  - Output overviewer post-call message per Spec S06
  - If `overviewer_feedback.recommendation == "APPROVE"`: output session end message, DONE
  - If `overviewer_feedback.recommendation == "REVISE"`:
    - Check `overviewer_round >= max_overviewer_rounds`: if so, escalate to user ("Overviewer still has concerns after {max_overviewer_rounds} rounds. Accept as-is / Abort")
    - If overviewer clarifying questions exist, present each to user via AskUserQuestion; store answers in `overviewer_question_answers`
    - Resume author with `overviewer_feedback` and `overviewer_question_answers`; author revises plan
    - Go to Step 4 (conformance + critic review). Auto-revise loop runs until both APPROVE, then returns to the overviewer gate (fresh spawn again)
- [ ] Add the overviewer post-call message format to the "## Progress Reporting" section per Spec S06
- [ ] Add the overviewer to the "## Reference: Persistent Agent Pattern" table with note: the overviewer is NOT persistent; it is always fresh-spawned. Accumulated knowledge: none (fresh eyes by design)
- [ ] Update the orchestration diagram to show the overviewer gate after the "PLANNING PHASE COMPLETE" box (or replace with unified flow diagram per Spec S07)

**Tests:**
- [ ] Manual review: verify overviewer state variables are initialized correctly in the Initialize State section (no `overviewer_id`)
- [ ] Manual review: verify the "Both APPROVE" branch runs the overviewer as a fresh spawn (uses `subagent_type`, not `resume`)
- [ ] Manual review: verify the overviewer REVISE path goes back to author then conformance + critic (Step 4), not directly to overviewer
- [ ] Manual review: verify the max round check uses `overviewer_round >= max_overviewer_rounds` (3) and escalates to user
- [ ] Manual review: verify the REVISE branch in Step 5D auto-revises without user prompt per [D11]
- [ ] Manual review: verify all ESCALATE prompts, stagnation detection prompts, and max-revision prompts are preserved unchanged
- [ ] Manual review: verify the overviewer post-call message format matches Spec S06
- [ ] Manual review: verify there is no Phase 1/Phase 2 terminology in the modified SKILL.md
- [ ] Manual review: verify the overviewer is never resumed (no `Task(resume: ...)` for overviewer anywhere)

**Checkpoint:**
- [ ] `tugplug/skills/plan/SKILL.md` contains overviewer state variables in Initialize State (no `overviewer_id`)
- [ ] The "Both APPROVE" branch runs the overviewer as a fresh spawn and handles APPROVE/REVISE
- [ ] Overviewer REVISE sends feedback to author then goes through conformance + critic before overviewer runs again
- [ ] REVISE loops auto-revise without user prompts per [D11]
- [ ] The overviewer post-call message format appears in the Progress Reporting section

**Rollback:**
- Revert `tugplug/skills/plan/SKILL.md` to its previous state (the file is under version control)

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A plan-quality overviewer agent integrated into the plan skill as a terminal quality gate, catching issues that survive the author-critic revision loop.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugplug/agents/overviewer-agent.md` exists with correct YAML frontmatter, investigative prompt, input/output contracts, and recommendation logic (verify by reading file)
- [ ] `tugplug/agents/author-agent.md` handles `overviewer_feedback` and `overviewer_question_answers` in its input contract and revision handling sections (verify by reading file)
- [ ] `tugplug/skills/plan/SKILL.md` runs the overviewer after conformance + critic both APPROVE, with auto-revise behavior, up to 3 overviewer rounds, and user escalation after the cap (verify by reading file)
- [ ] The overviewer is always a fresh spawn (never resumed) in SKILL.md (verify by grep for `resume` -- no overviewer resume calls)
- [ ] All three modified/created files are internally consistent: the overviewer output contract in the agent matches what the skill expects, and what the author handles

**Acceptance tests:**
- [ ] Integration test: run the plan skill against a test idea; verify the overviewer-agent is invoked after conformance + critic approval
- [ ] Integration test: verify the overviewer output contains `findings`, `clarifying_questions`, `assessment`, and `recommendation` fields
- [ ] Integration test: when overviewer recommends REVISE, verify author revises then conformance + critic re-approve before overviewer runs again (fresh spawn)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Measure overviewer first-round APPROVE rate across real plans; tune investigative prompt if too noisy
- [ ] Consider whether the overviewer should receive a summary of what prior overviewer runs found (counter to fresh-eyes design, but could reduce redundant re-discovery)
- [ ] Evaluate whether MEDIUM/LOW findings should surface in a user-visible summary even though they do not block approval

| Checkpoint | Verification |
|------------|--------------|
| Overviewer agent exists | `tugplug/agents/overviewer-agent.md` is a valid Markdown file with YAML frontmatter |
| Author handles overviewer feedback | `tugplug/agents/author-agent.md` contains `overviewer_feedback` in input contract |
| Skill runs overviewer after approval | `tugplug/skills/plan/SKILL.md` runs overviewer fresh spawn after "Both APPROVE" |
| Overviewer never resumed | No `Task(resume: ...)` calls for overviewer in SKILL.md |

**Commit after all checkpoints pass.**
