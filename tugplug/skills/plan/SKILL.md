---
name: plan
description: Orchestrates the planning workflow - spawns sub-agents via Task
allowed-tools: Task, AskUserQuestion
---

## CRITICAL: You Are a Pure Orchestrator

**YOUR TOOLS:** `Task` and `AskUserQuestion` ONLY. You have no other tools. You cannot read files, write files, edit files, or run commands. Everything happens through agents you spawn via `Task`.

**FIRST ACTION:** Your very first tool call MUST be `Task` with `tugplug:clarifier-agent`. No exceptions. Do not think. Do not analyze. Just spawn the agent.

**Prerequisites are handled automatically.** A pre-hook runs `tugutil init` before this skill starts. Do not check or run initialization yourself.

**FORBIDDEN:**
- Answering the user's request directly
- Analyzing the idea yourself
- Reading, writing, or editing any files
- Running any shell commands
- Doing ANY work that an agent should do

**YOUR ENTIRE JOB:** Parse input, spawn agents in sequence, relay results, ask user questions when needed, and **report progress at every step**.

**GOAL:** Produce a tugplan file at `.tugtool/tugplan-<slug>.md` by orchestrating agents.

---

## Progress Reporting

You MUST output a post-call message after every agent call. These are your primary user-facing output. Do NOT output pre-call announcements — Claude Code already shows the Task call to the user.

Follow these formats exactly.

### Post-call messages

Output these as text immediately after parsing the agent's JSON result:

**clarifier-agent:**
```
**tugplug:clarifier-agent**(Complete)
  Intent: {analysis.understood_intent}
  Questions: {questions.length} | Assumptions: {assumptions.length}
```

**author-agent:**
```
**tugplug:author-agent**(Complete)
  Path: {plan_path} ({created ? "created" : "revised"})
  Sections: {sections_written.length} | Steps: {step_count} | Decisions: {decision_count}
  Skeleton: anchors {pass|fail} | references {pass|fail} | required sections {pass|fail}
  Validation: {validation_status}
```

**conformance-agent:**
```
**tugplug:conformance-agent**(Complete)
  Recommendation: {recommendation}
  Skeleton: {skeleton_compliant ? "compliant" : "non-compliant"}
  Validation: {validation_result.error_count} errors, {validation_result.diagnostic_count} diagnostics
  Structural issues: {structural_issues.length}
```

**critic-agent:**
```
**tugplug:critic-agent**(Complete)
  Recommendation: {recommendation}
  Areas: consistency {area_ratings.internal_consistency} | soundness {area_ratings.technical_soundness} | implementability {area_ratings.implementability} | completeness {area_ratings.completeness} | risk {area_ratings.risk_feasibility}
  Findings: {findings.length} ({count by severity: N CRITICAL, N HIGH, N MEDIUM, N LOW — omit zeros})
  Clarifying questions: {clarifying_questions.length}
  Assessment: {assessment.quality} (first sentence only)
```

**overviewer-agent:**
```
**tugplug:overviewer-agent**(Complete)
  Recommendation: {recommendation}
  Findings: {findings.length} ({count by severity: N CRITICAL, N HIGH, N MEDIUM, N LOW — omit zeros})
  Clarifying questions: {clarifying_questions.length}
  Assessment: {assessment} (first sentence only)
```

On revision loops, use `(Complete, revision {N})` in all post-call messages.

### Failure messages

```
**tugplug:{agent-name}**(FAILED)
  {error description}
  Halting: {reason}
```

### Session messages

**Start (output before any tool calls):**
```
**Plan** — Starting new plan from idea
```
or:
```
**Plan** — Revising existing plan at {path}
```

**End (output after commit):**
```
---
**Plan**(Complete)
  Plan: {plan_path}
  Commit: {commit_hash}
  Steps: {step_count} | Decisions: {decision_count}
  Revisions: {revision_count}
  Next: /tugplug:implement {plan_path}
```

---

## Orchestration Loop

```
┌──────────────────────────────────────────────┐
│           PLANNING PHASE BEGINS              │
│  (produce a tugplan at .tugtool/tugplan)     │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│         clarifier-agent (runs once)          │
│         fresh spawn                          │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
                ┌────────────┐
                │ questions? │
                └──┬─────┬───┘
               yes │     │ no
                   ▼     │
   ┌──────────────────┐  │
   │ AskUserQuestion  │  │
   └────────┬─────────┘  │
            └──────┬─────┘
                   │
┌──────────────────▼───────────────────────────┐
│ author-agent (fresh spawn every round;       │◄─┐
│ reads plan_path to recover prior state)      │  │
└─────────────────────┬────────────────────────┘  │
                      │                           │
                      ▼                           │
     ┌────────────────┴─────────────────┐         │
     │                                  │         │
     ▼                                  ▼         │
┌────────────────┐             ┌────────────────┐ │
│conformance-    │             │  critic-agent  │ │ revision
│agent (fresh)   │             │    (fresh)     │ │ loop
└───────┬────────┘             └───────┬────────┘ │
        │                             │           │
        └──────────┬──────────────────┘           │
                   │                              │
                   ▼                              │
          ┌────────────────┐                      │
          │  combined      │                      │
          │ recommendation?│                      │
          └──┬──────────┬──┘                      │
     APPROVE │          │ REVISE / ESCALATE ───────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│  overviewer-agent (fresh spawn every round)  │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
             ┌────────────────┐
             │ recommendation?│
             └──┬──────────┬──┘
        APPROVE │          │ REVISE
                │          │
                │          ▼
                │   ┌─────────────────────────────┐
                │   │ collect clarifying questions │
                │   │ (AskUserQuestion if any)     │
                │   └────────────┬────────────────┘
                │                │
                │                ▼
                │   resume author → go back to
                │   conformance + critic review
                │   (auto-revise loop)
                │
                ▼
┌──────────────────────────────────────────────┐
│          PLANNING PHASE COMPLETE             │
│  Plan ready at {plan_path}                   │
│  Next: /tugplug:implement {plan_path}        │
└──────────────────────────────────────────────┘
```

**The clarifier runs ONCE during the first pass.** Revision loops go directly to the author — the clarifier's job (understanding the idea, asking questions) is already done.

**Architecture principles:**
- Orchestrator is a pure dispatcher: `Task` + `AskUserQuestion` only
- **Every agent call is a fresh spawn.** No agent IDs are tracked, reused, or passed between calls.
- **Cross-round continuity comes from the plan file on disk**, not from agent memory. Author, conformance, critic, and overviewer all read `plan_path` to recover prior state.
- **Clarifier** runs once on the first pass — it is not invoked again in revision rounds (no need; the idea is already understood and captured in the plan file).
- **Parallel dispatch**: conformance-agent and critic-agent are dispatched in a single message with two Task calls.
- **Latest-round-only** payloads: each revision call passes only the latest round's feedback. The plan file carries the accumulated state.
- Auto-compaction handles context overflow within a single agent call — agents compact at ~95% capacity.

---

## Execute This Sequence

### 1. Initialize State

Output the session start message.

```
conformance_feedback = null
critic_feedback = null
critic_question_answers = null
overviewer_feedback = null
overviewer_question_answers = null
overviewer_round = 0
max_overviewer_rounds = 3
revision_count = 0
max_revision_count = 5
previous_high_findings = []     # IDs of HIGH+ findings from prior round (for stagnation detection)
```

No agent IDs are tracked. Every Task call is a fresh spawn.

### 2. Clarifier: Analyze and Question (First Pass Only)

The clarifier runs ONCE to understand the idea and gather user input. It is not invoked again in revision rounds.

```
Task(
  subagent_type: "tugplug:clarifier-agent",
  prompt: '{"idea": "<idea>", "plan_path": "<path or null>", "critic_feedback": null}',
  description: "Analyze idea and generate questions"
)
```

Output the Clarifier post-call message. Store response in memory.

If `questions` array is non-empty, present to user:

```
AskUserQuestion(
  questions: [
    {
      question: "<clarifier question>",
      header: "<short label from question>",
      options: [
        { label: "<option 1>", description: "" },
        { label: "<option 2>", description: "" }
      ],
      multiSelect: false
    }
  ]
)
```

Store user answers in memory.

### 3. Author: Write or Revise Plan

Spawn a fresh author for every call. On revisions, pass `plan_path` so the author can read the current plan file to recover prior-round state.

**First pass:**

```
Task(
  subagent_type: "tugplug:author-agent",
  prompt: '{
    "idea": "<idea or null>",
    "plan_path": "<path or null>",
    "user_answers": <answers from step 2>,
    "clarifier_assumptions": <assumptions from clarifier>,
    "conformance_feedback": null,
    "critic_feedback": null,
    "critic_question_answers": null
  }',
  description: "Create plan document"
)
```

**Revision loop (fresh spawn, latest-round feedback):**

```
Task(
  subagent_type: "tugplug:author-agent",
  prompt: '{
    "idea": null,
    "plan_path": "<plan_path>",
    "conformance_feedback": <conformance_feedback JSON or null>,
    "critic_feedback": <critic_feedback JSON or null>,
    "critic_question_answers": <critic_question_answers JSON or null>,
    "overviewer_feedback": <overviewer_feedback JSON or null>,
    "overviewer_question_answers": <overviewer_question_answers JSON or null>
  }',
  description: "Revise plan from review feedback"
)
```

Pass only the latest round's feedback. Do not accumulate or combine feedback across rounds — the plan file on disk carries the accumulated state. The author reads `plan_path` at the start of every call. When revising after overviewer feedback, pass the overviewer's output as `overviewer_feedback` and any collected answers as `overviewer_question_answers`; set `conformance_feedback` and `critic_feedback` to null (the overviewer round does not re-run conformance/critic before sending to author).

Store response in memory.

If `validation_status == "errors"`: output the Author failure message and HALT.

Output the Author post-call message.

### 4. Conformance + Critic: Parallel Review

Dispatch both agents in a single message with two Task calls. Every call is a fresh spawn — both agents read `plan_path` on entry to recover the current plan state.

**Normal case (dispatch both in parallel):**

```
Task(
  subagent_type: "tugplug:conformance-agent",
  prompt: '{"plan_path": "<path from author>", "skeleton_path": "tuglaws/tugplan-skeleton.md"}',
  description: "Check plan conformance"
)
Task(
  subagent_type: "tugplug:critic-agent",
  prompt: '{"plan_path": "<path from author>"}',
  description: "Review plan quality"
)
```

On revision rounds, include the latest author output in the prompt as context for targeted re-review:

```
Task(
  subagent_type: "tugplug:conformance-agent",
  prompt: '{"plan_path": "<path>", "skeleton_path": "tuglaws/tugplan-skeleton.md", "author_output": <author_output JSON>, "re_check": true}',
  description: "Re-check plan conformance"
)
Task(
  subagent_type: "tugplug:critic-agent",
  prompt: '{"plan_path": "<path>", "author_output": <author_output JSON>, "critic_question_answers": <critic_question_answers JSON or null>, "re_review": true}',
  description: "Re-review plan quality"
)
```

**After prior conformance ESCALATE (two-phase sequential dispatch):**

When the previous round ended with `conformance_feedback.recommendation == ESCALATE`, dispatch conformance alone first:

```
# Phase 1: Conformance only
Task(
  subagent_type: "tugplug:conformance-agent",
  prompt: '{"plan_path": "<path>", "skeleton_path": "tuglaws/tugplan-skeleton.md", "author_output": <author_output JSON>, "re_check": true}',
  description: "Re-check plan conformance"
)

# Phase 2: If conformance now passes (recommendation != ESCALATE), spawn critic
if conformance.recommendation != "ESCALATE":
  Task(
    subagent_type: "tugplug:critic-agent",
    prompt: '{"plan_path": "<path>", "author_output": <author_output JSON>, "critic_question_answers": <critic_question_answers JSON or null>, "re_review": true}',
    description: "Re-review plan quality"
  )
# If conformance still ESCALATEs, skip critic; critic_feedback remains null
```

This two-phase approach ensures that when conformance ESCALATE is resolved, the critic always runs in the same round that conformance passes — so `critic_feedback` is never null when Step 5C runs.

Store both responses in memory. Output the Conformance post-call message and Critic post-call message (if critic ran).

### 5. Handle Combined Recommendation

#### Step A: Check Loop Limits

```
if revision_count >= max_revision_count:
    AskUserQuestion(
      questions: [{
        question: "Maximum revision rounds ({max_revision_count}) reached without approval. How should we proceed?",
        header: "Max Revisions Reached",
        options: [
          { label: "Start over", description: "Send latest feedback to author for another attempt" },
          { label: "Accept as-is", description: "Proceed with the plan despite open issues" },
          { label: "Abort", description: "Cancel planning" }
        ],
        multiSelect: false
      }]
    )
    → handle user choice and halt (see ESCALATE handler below for option handling)
```

#### Step B: Check Conformance ESCALATE

```
if conformance_feedback.recommendation == "ESCALATE":
    # Discard critic output — structural problems must be fixed first
    critic_feedback = null
    previous_high_findings = []    # reset stagnation tracking (no critic data this round)

    AskUserQuestion(
      questions: [{
        question: "Conformance check escalated: the plan has structural issues that could not be automatically fixed. How should we proceed?",
        header: "Conformance Escalated",
        options: [
          { label: "Start over", description: "Send conformance feedback to author for fixes" },
          { label: "Accept as-is", description: "Proceed with the plan despite structural issues" },
          { label: "Abort", description: "Cancel planning" }
        ],
        multiSelect: false
      }]
    )
    → If "Start over": set conformance_feedback (from this round), critic_feedback = null,
      increment revision_count, GO TO STEP 3 (author)
    → If "Accept as-is": commit the plan (section 6), then output session end message and HALT
    → If "Abort": output "**Plan** — Aborted by user" and HALT
```

#### Step C: Stagnation Detection

```
# Safe here: Step B already handled the case where critic_feedback is null.
current_high_findings = [f.id for f in critic_feedback.findings
                         if f.severity in ("CRITICAL", "HIGH")]

if revision_count > 0
   and len(current_high_findings) > 0
   and set(current_high_findings) == set(previous_high_findings):

    AskUserQuestion(
      questions: [{
        question: "The same critical issues persist across two consecutive revision rounds — the plan appears stuck. How should we proceed?",
        header: "Stagnation Detected",
        options: [
          { label: "Start over", description: "Send latest feedback to author for another attempt" },
          { label: "Accept as-is", description: "Proceed with the plan despite persistent issues" },
          { label: "Abort", description: "Cancel planning" }
        ],
        multiSelect: false
      }]
    )
    → handle user choice and halt (see ESCALATE handler below for option handling)

previous_high_findings = current_high_findings
```

#### Step D: Evaluate Remaining Recommendations

**Critic ESCALATE:**
```
if critic_feedback.recommendation == "ESCALATE":
    AskUserQuestion(
      questions: [{
        question: "The critic escalated: the plan has critical quality issues that need resolution. How should we proceed?",
        header: "Critic Escalated",
        options: [
          { label: "Start over", description: "Send critic feedback to author for fixes" },
          { label: "Accept as-is", description: "Proceed with the plan despite critical issues" },
          { label: "Abort", description: "Cancel planning" }
        ],
        multiSelect: false
      }]
    )
    → If "Start over": increment revision_count, GO TO STEP 3 (author)
    → If "Accept as-is": commit the plan (section 6), then output session end message and HALT
    → If "Abort": output "**Plan** — Aborted by user" and HALT
```

**REVISE (conformance or critic) — auto-revise, no user prompt:**

```
if conformance_feedback.recommendation == "REVISE" or critic_feedback.recommendation == "REVISE":

    # Declining-threshold override: after round 1, if the critic's only REVISE-triggering
    # findings are MEDIUM (no HIGH or CRITICAL), treat critic as APPROVE.
    # The critic's own recommendation logic should already handle this on re-review,
    # but this is the orchestrator safety net.
    if revision_count >= 1
       and conformance_feedback.recommendation == "APPROVE"
       and critic_feedback.recommendation == "REVISE"
       and no finding in critic_feedback.findings has severity "HIGH" or "CRITICAL":
        # Override: treat as both APPROVE. MEDIUM findings become implementation notes.
        # Advance to overviewer gate (Step 5, "Both APPROVE" branch).
        GO TO overviewer gate

    # Auto-revise: no user prompt. Go directly to author.
    # Clarifying questions (if any) are passed to the author as context via critic_feedback.
    # The author resolves them from the codebase or makes reasonable choices.
    # critic_question_answers remains null (no user answers collected on REVISE).
    increment revision_count
    GO TO STEP 3 (author)
```

User is NOT prompted when recommendation is REVISE. The revision loop runs fully autonomously. User interaction is only required for: ESCALATE recommendations, stagnation detection, and max revision rounds reached.

**Both APPROVE — run overviewer gate:**

```
if conformance_feedback.recommendation == "APPROVE" and critic_feedback.recommendation == "APPROVE":

    # Fresh-spawn overviewer (never resumed — fresh eyes every time)
    Task(
      subagent_type: "tugplug:overviewer-agent",
      prompt: '{"plan_path": "<plan_path>"}',
      description: "Final quality review"
    )
    increment overviewer_round
    store result as overviewer_feedback

    Output the Overviewer post-call message.

    if overviewer_feedback.recommendation == "APPROVE":
        → Commit the plan (section 6), then output session end message and HALT

    if overviewer_feedback.recommendation == "REVISE":

        # Check round cap before collecting questions or resuming author
        if overviewer_round >= max_overviewer_rounds:
            AskUserQuestion(
              questions: [{
                question: "Overviewer still has concerns after {max_overviewer_rounds} rounds. How should we proceed?",
                header: "Overviewer Round Cap Reached",
                options: [
                  { label: "Accept as-is", description: "Proceed with the plan despite overviewer concerns" },
                  { label: "Abort", description: "Cancel planning" }
                ],
                multiSelect: false
              }]
            )
            → If "Accept as-is": commit the plan (section 6), then output session end message and HALT
            → If "Abort": output "**Plan** — Aborted by user" and HALT

        # Clarifying questions (if any) are passed to the author as context via overviewer_feedback.
        # The author resolves them from the codebase or makes reasonable choices.
        # overviewer_question_answers remains null (no user answers collected on REVISE).
        overviewer_question_answers = null

        # Resume author with overviewer feedback (auto-revise, no user prompt)
        increment revision_count
        GO TO STEP 3 (author), passing:
            conformance_feedback = null
            critic_feedback = null
            critic_question_answers = null
            overviewer_feedback = overviewer_feedback
            overviewer_question_answers = overviewer_question_answers

        # After author revises, GO TO STEP 4 (conformance + critic).
        # Auto-revise loop runs until both APPROVE, then returns here (overviewer runs fresh again).
        # Reset overviewer_question_answers = null before the next overviewer spawn.
```

---

### 6. Commit the Plan

Before outputting the session end message, commit the completed plan file. Use
the `tugplug:committer-agent` to perform the commit:

```
Task(
  subagent_type: "tugplug:committer-agent",
  max_turns: 5,
  prompt: '{
    "operation": "commit",
    "worktree_path": "<repo_root>",
    "plan_path": "<plan_path>",
    "step_anchor": "step-0",
    "proposed_message": "plan(new): <plan_slug>",
    "log_entry": { "summary": "Commit plan: <plan_slug>" }
  }',
  description: "Commit plan file"
)
```

Where `<plan_slug>` is the plan filename without extension (e.g., `tugplan-token-rename-35a`).

For revised plans (plan_path was provided as input, not created new), use
`"plan(update): <plan_slug>"` as the commit message.

Parse the committer output and extract `commit_hash` for the session end message.

If the commit fails (e.g., no changes to commit because the plan was already
committed), skip silently and proceed to the session end message without a
commit hash.

DO NOT include Co-Authored-By lines or mention AI models in the commit message.

---

## Reference: Fresh-Spawn Pattern

Every agent call is a fresh spawn. Agent IDs are NOT tracked or passed between calls. Cross-round continuity comes from the plan file on disk — not from agent memory.

| Agent | Cadence | Prior-round context comes from |
|-------|---------|--------------------------------|
| **clarifier** | Once, first pass only | N/A (single call) |
| **author** | Every round (first + revisions) | Reads `plan_path` to see current plan state |
| **conformance** | Every round | Reads `plan_path`; receives latest `author_output` on re-check |
| **critic** | Every round | Reads `plan_path`; receives latest `author_output` on re-review |
| **overviewer** | Every overviewer round | Reads `plan_path`; fresh eyes by design |

**Why this pattern:**
- The Task API does not support `resume:` — it silently does nothing. Relying on it made every "revision" call a cold start that *thought* it had context but didn't.
- The plan file is the durable source of truth. Agents that need prior-round state read it on entry.
- Latest-round feedback is passed in the prompt; prior-round feedback is embedded in the plan file itself (the author already addressed it when it revised).

**What the orchestrator does NOT do:**
- Does not track `clarifier_id`, `author_id`, `conformance_id`, or `critic_id`.
- Does not pass `resume:` to `Task`.
- Does not carry prior-round feedback across calls — only the latest round is passed.

---

## Input Handling

Parse the user's input to determine mode:

| Input Pattern | Mode | Behavior |
|---------------|------|----------|
| `"idea text"` | new | Create new plan from idea |
| `.tugtool/tugplan-<name>.md` | revise | Revise existing plan |

---

## Error Handling

If Task tool fails or returns unparseable JSON:

1. Output the failure message for that phase with the error details
2. Halt with clear error message

All errors use the standard failure message format defined in Progress Reporting.
