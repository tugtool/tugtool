# AI-Assisted Development Workflow

This document describes my development workflow when working with AI assistants on this codebase. The workflow emphasizes iterative planning with multiple AI perspectives, structured implementation, and testing/verification.

---

## Table of Contents {#toc}

- [Workflow Overview](#workflow-overview) — ASCII flowchart with labeled nodes
- [Definitions](#definitions) — Key terms and concepts
- [Planning Loop](#planning-loop) — `[P1]`-`[P6]`: From idea to ready-to-implement plan
- [Implementation Loop](#implementation-loop) — `[I7]`-`[I14]`: From plan step to committed code
- [Key Design Principles](#principles) — Why this workflow works
- [Files Reference](#files-reference) — Quick lookup table

---

## Workflow Overview {#workflow-overview}

The flowchart below shows the two main loops: **Planning** (`[P1]`-`[P6]`) and **Implementation** (`[I7]`-`[I14]`). Each labeled node is a clickable reference to its detailed description.

```
                    ┌─────────────────────────────────────────────┐
                    │           PHASE OF WORK BEGINS              │
                    │  (new feature, refactor, exploration, etc.) │
                    │                  [P1]                       │
                    └─────────────────────┬───────────────────────┘
                                          │
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              PLANNING LOOP [P1]-[P6]                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                                 │  │
│  │    ┌──────────────────┐                                                         │  │
│  │    │  [P2]            │◄────────────────────────────────────────────────────┐   │  │
│  │    │  code-planner    │                                                     │   │  │
│  │    │  agent creates   │                                                     │   │  │
│  │    │  plan file       │                                                     │   │  │
│  │    └────────┬─────────┘                                                     │   │  │
│  │             │                                                               │   │  │
│  │             ▼                                                               │   │  │
│  │    ┌──────────────────┐       ┌──────────────────┐                          │   │  │
│  │    │  [P3]            │       │  [P3]            │                          │   │  │
│  │    │  Review plan     │──────►│  "investigate"   │                          │   │  │
│  │    │  + my comments   │       │  prompt w/       │                          │   │  │
│  │    │  + questions     │       │  Claude Opus     │                          │   │  │
│  │    └────────┬─────────┘       └────────┬─────────┘                          │   │  │
│  │             │                          │                                    │   │  │
│  │             │         [P4]             ▼                                    │   │  │
│  │             │         code-planner    ┌──────────────────┐                  │   │  │
│  │             │         for major       │  [P5]            │                  │   │  │
│  │             │         rewrites        │  "investigate"   │                  │   │  │
│  │             │            ▲            │  prompt w/       │                  │   │  │
│  │             │            │            │  GPT-5.2 in      │                  │   │  │
│  │             │            │            │  Cursor          │                  │   │  │
│  │             │            │            └────────┬─────────┘                  │   │  │
│  │             │            │                     │                            │   │  │
│  │             │            │    ┌────────────────┴────────────────┐           │   │  │
│  │             │            │    │  [P6]                           │           │   │  │
│  │             │            │    │  Cross-pollinate AI feedback    │           │   │  │
│  │             └────────────┼───►│  + my guidance/annotations      │───────────┘   │  │
│  │                          │    │  (10-20 rounds typical)         │               │  │
│  │                          │    └────────────────┬────────────────┘               │  │
│  │                          │                     │                                │  │
│  │                          └─────────────────────┘  loop until ready              │  │
│  │                                                                                 │  │
│  └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                         │                                             │
│                          Plan is ready  │                                             │
│                                         │                                             │
└─────────────────────────────────────────┼─────────────────────────────────────────────┘
                                          │
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                          IMPLEMENTATION LOOP [I7]-[I14]                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                                 │  │
│  │    ┌───────────────────┐                                                        │  │
│  │    │  [I7]             │◄───────────────────────────────────────────────────┐   │  │
│  │    │  Assess step:     │                                                    │   │  │
│  │    │  ready as-is, or  │                                                    │   │  │
│  │    │  needs breakdown? │                                                    │   │  │
│  │    └────────┬──────────┘                                                    │   │  │
│  │             │                                                               │   │  │
│  │             ├───────────────────────────┐                                   │   │  │
│  │             │ needs detail              │ ready                             │   │  │
│  │             ▼                           │                                   │   │  │
│  │    ┌──────────────────┐                 │                                   │   │  │
│  │    │  [I7-detail]     │                 │                                   │   │  │
│  │    │  code-architect  │                 │                                   │   │  │
│  │    │  agent provides  │                 │                                   │   │  │
│  │    │  detailed steps  │                 │                                   │   │  │
│  │    └────────┬─────────┘                 │                                   │   │  │
│  │             │                           │                                   │   │  │
│  │             ▼                           ▼                                   │   │  │
│  │    ┌─────────────────────────────────────────┐                              │   │  │
│  │    │  [I8]                                   │◄──────────────┐              │   │  │
│  │    │  /implement-plan command                │               │              │   │  │
│  │    │  (cite plan step, watch terminal)       │               │              │   │  │
│  │    └────────────────┬────────────────────────┘               │              │   │  │
│  │                     │                                        │              │   │  │
│  │                     │ [I9] monitor                           │              │   │  │
│  │                     │                                        │              │   │  │
│  │         ┌───────────┴───────────┐                            │              │   │  │
│  │         │ struggling?           │ progressing                │              │   │  │
│  │         ▼                       │                            │              │   │  │
│  │    ┌──────────────────┐         │                            │              │   │  │
│  │    │  [I10]           │         │                            │              │   │  │
│  │    │  ESC to pause    │         │                            │              │   │  │
│  │    │  ▼               │         │                            │              │   │  │
│  │    │  code-architect  │         │                            │              │   │  │
│  │    │  or code-planner │         │                            │              │   │  │
│  │    │  to investigate  │         │                            │              │   │  │
│  │    │  ▼               │         │                            │              │   │  │
│  │    │  update plan     │         │                            │              │   │  │
│  │    └────────┬─────────┘         │                            │              │   │  │
│  │             │                   │                            │              │   │  │
│  │             └───────────────────┼─────────► back to [I8] ────┘              │   │  │
│  │                                 │                                           │   │  │
│  │                                 ▼                                           │   │  │
│  │    ┌───────────────────────────────────┐                                    │   │  │
│  │    │  Implementation complete          │                                    │   │  │
│  │    │  Questions about quality?         │                                    │   │  │
│  │    └────────────────┬──────────────────┘                                    │   │  │
│  │                     │                                                       │   │  │
│  │         ┌───────────┴───────────┐                                           │   │  │
│  │         │ yes                   │ no                                        │   │  │
│  │         ▼                       │                                           │   │  │
│  │    ┌─────────────────────┐      │                                           │   │  │
│  │    │  [I11]              │      │                                           │   │  │
│  │    │  plan-step-reviewer │      │                                           │   │  │
│  │    │  grades the work    │      │                                           │   │  │
│  │    └────────┬────────────┘      │                                           │   │  │
│  │             │                   │                                           │   │  │
│  │    remediation needed?          │                                           │   │  │
│  │             │                   │                                           │   │  │
│  │             │ yes               │                                           │   │  │
│  │             └──────────────────────────────► back to [I7] ──────────────────│   │  │
│  │                                 │                                           │   │  │
│  │                                 ▼                                           │   │  │
│  │    ┌─────────────────────────────────────────┐                              │   │  │
│  │    │  [I12]                                  │                              │   │  │
│  │    │  /update-plan-implementation-log        │                              │   │  │
│  │    └────────────────┬────────────────────────┘                              │   │  │
│  │                     │                                                       │   │  │
│  │                     ▼                                                       │   │  │
│  │    ┌─────────────────────────────────────────┐                              │   │  │
│  │    │  [I13]                                  │                              │   │  │
│  │    │  /prepare-git-commit-message            │                              │   │  │
│  │    └────────────────┬────────────────────────┘                              │   │  │
│  │                     │                                                       │   │  │
│  │                     ▼                                                       │   │  │
│  │    ┌─────────────────────────────────────────┐                              │   │  │
│  │    │  [I14]                                  │                              │   │  │
│  │    │  git commit (manually)                  │                              │   │  │
│  │    │  decide: next step? (below)             │                              │   │  │
│  │    └────────────────┬─────────┬──────────────┘                              │   │  │
│  │                     │         │                                             │   │  │
│  │                     │         │                                             │   │  │
│  │                     │ no      │ yes                                         │   │  │
│  │                     │         │                                             │   │  │
│  │                     │         │                                             │   │  │
│  │                     │         └────────────► back to [I7] ──────────────────┘   │  │
│  │                     │                                                           │  │
│  │                     └────────────────┐                                          │  │
│  │                                      │                                          │  │
│  └──────────────────────────────────────│──────────────────────────────────────────┘  │
│                                         │                                             │
│                         All steps done  │                                             │
│                                         │                                             │
└─────────────────────────────────────────┼─────────────────────────────────────────────┘
                                          │
                                          ▼
                  ┌─────────────────────────────────────────────┐
                  │           PHASE OF WORK COMPLETE            │
                  └─────────────────────────────────────────────┘
```

**Node Index:**

| Node | Description | Jump |
|------|-------------|------|
| `[P1]` | Initiate a new phase | [→](#p1) |
| `[P2]` | code-planner creates plan file | [→](#p2) |
| `[P3]` | Review with Claude Opus | [→](#p3) |
| `[P4]` | code-planner for major rewrites | [→](#p4) |
| `[P5]` | Cross-reference with GPT-5.2 | [→](#p5) |
| `[P6]` | Iterate until ready | [→](#p6) |
| `[I7]` | Assess each plan step | [→](#i7) |
| `[I8]` | Run /implement-plan | [→](#i8) |
| `[I9]` | Monitor implementation | [→](#i9) |
| `[I10]` | Handle struggles (ESC to pause) | [→](#i10) |
| `[I11]` | Review with plan-step-reviewer | [→](#i11) |
| `[I12]` | Update implementation log | [→](#i12) |
| `[I13]` | Prepare commit message | [→](#i13) |
| `[I14]` | Commit and continue | [→](#i14) |

---

## Definitions {#definitions}

### Phase of Work {#def-phase}

A phase of work is a bounded unit of development effort with a clear goal:
- Adding a new feature
- Refactoring existing code
- Exploring a new technical area
- Fixing a class of bugs
- Performance optimization

Each phase gets its own numbered plan file in the `plans/` directory (e.g., `phase-13.md`). See [Files Reference](#files-reference) for the full list of plan-related files.

### Plan File {#def-plan-file}

A structured planning document in the `plans/` directory following the format defined in [`plans/plan-skeleton.md`](#file-plan-skeleton). Plan files contain:

- **Plan Metadata**: Owner, status, target branch, dates
- **Phase Overview**: Context, strategy, stakeholders, success criteria, scope, non-goals
- **Open Questions**: Tracked uncertainties that must be resolved or explicitly deferred
- **Risks and Mitigations**: Known risks with mitigation strategies
- **Design Decisions**: Recorded decisions with rationale (referenced as `[D01]`, `[D02]`, etc.)
- **Specification**: Detailed technical contract including APIs, schemas, error models
- **Symbol Inventory**: Concrete list of crates, files, and symbols to add
- **Test Plan Concepts**: Categories of tests and fixture requirements
- **Execution Steps**: Sequenced implementation tasks with checkpoints
- **Deliverables and Checkpoints**: Phase exit criteria

### "Investigate" Prompt {#def-investigate}

A standard prompt I use when reviewing plans with AI assistants (used in [[P3]](#p3) and [[P5]](#p5)):

> **Investigate. Ask clarifying questions. Give your assessment on its quality and readiness to implement. Do you see holes, pitfalls, weaknesses or limitations?**

This prompt encourages critical analysis rather than passive acceptance.

---

## Planning Loop {#planning-loop}

The planning loop transforms an idea into a ready-to-implement plan. It corresponds to nodes `[P1]`-`[P6]` in the [flowchart](#workflow-overview).

### [P1] Initiate a New Phase {#p1}

When starting new work, I define the scope and goals of the phase. This could be a feature request, a technical debt item, an exploration, or a refactoring effort. See [Phase of Work](#def-phase) for what constitutes a phase.

### [P2] Create the Plan File {#p2}

I use the **code-planner agent** in Claude Code to create the initial plan file:

```
Task tool → code-planner agent
```

The code-planner agent ([`.claude/agents/code-planner.md`](#file-code-planner)):
- Reads CLAUDE.md and relevant documentation
- Explores the codebase to understand existing patterns
- Analyzes the request and breaks it into implementable units
- Writes a structured plan following [`plans/plan-skeleton.md`](#file-plan-skeleton)
- Outputs to a file like `plans/phase-14.md`

**Key characteristics:**
- Uses the Opus model for deep reasoning
- Identifies dependencies between tasks
- Specifies file paths, function signatures, and code locations
- Includes verification steps and success criteria

### [P3] Review with Claude Opus {#p3}

I review the plan file myself, making annotations and noting questions. Then I use Claude Opus with the **["investigate" prompt](#def-investigate)** to get critical feedback.

Claude Opus examines:
- Logical consistency of the approach
- Missing edge cases or error scenarios
- Architectural implications
- Potential conflicts with existing code
- Gaps in the specification

### [P4] Use code-planner for Major Rewrites {#p4}

If Claude's feedback suggests significant structural changes to the plan, I invoke the **code-planner agent** ([[P2]](#p2)) again to rewrite sections rather than making piecemeal edits.

### [P5] Cross-Reference with GPT-5.2 in Cursor {#p5}

I bring the plan file into Cursor and use GPT-5.2 with the **["investigate" prompt](#def-investigate)**:

- **Ask mode**: Get feedback without modifying the plan
- **Agent mode**: Have GPT-5.2 update the plan directly

This provides a second AI perspective that often catches different issues than Claude. See [Multiple AI Perspectives](#principle-multiple-ai) for why this matters.

### [P6] Iterate Until Ready {#p6}

I loop through [[P3]](#p3)-[[P5]](#p5), giving each AI the feedback from the other (annotated with my guidance, answers, and comments). This cross-pollination typically takes **10-20 rounds** before the plan is solid.

**What "ready" means:**
- All open questions are resolved or explicitly deferred
- Design decisions are justified and documented
- Execution steps are specific enough to implement
- Checkpoints are defined and testable
- Both AIs have given positive assessments

**Exit condition:** Plan is ready → proceed to [Implementation Loop](#implementation-loop).

---

## Implementation Loop {#implementation-loop}

The implementation loop transforms each plan step into committed code. It corresponds to nodes `[I7]`-`[I14]` in the [flowchart](#workflow-overview). This loop repeats for each execution step in the plan.

### [I7] Assess Each Plan Step {#i7}

For each execution step in the [plan file](#def-plan-file), I decide:

**Ready as-is**: The step is specific enough to implement directly. → Proceed to [[I8]](#i8).

**Needs breakdown**: The step is too abstract or complex. I use the **code-architect agent** to provide detailed sub-steps.

The code-architect agent ([`.claude/agents/code-architect.md`](#file-code-architect)):
- Has deep expertise in API design, system architecture, and design patterns
- Follows a rigorous methodology: requirements extraction → design analysis → API surface design → critical review
- Produces detailed type signatures, usage examples, and phased implementation roadmaps
- Challenges its own designs as a harsh critic would

**After breakdown:** The detailed steps are added to the plan, then proceed to [[I8]](#i8).

### [I8] Run /implement-plan {#i8}

I execute the **implement-plan command** ([`.claude/commands/implement-plan.md`](#file-implement-plan)), providing a citation to the specific execution step:

```
/implement-plan plans/phase-13.md Step 2.3: Add TypeCommentCollector
```

**Why a command instead of an agent**: Commands show more detailed terminal output during execution, which is valuable for monitoring progress on complex implementations. See [[I9]](#i9).

The implement-plan command:
- Parses the step reference and locates it in the plan file
- Reads all referenced materials (other files, specs, etc.)
- Implements each task sequentially
- **Updates the plan file**: Checks off `[ ]` → `[x]` as tasks complete
- Writes tests as specified
- Runs verification using `cargo nextest run`
- Performs all checkpoint verifications
- **Never commits**: Git operations are my responsibility (see [[I14]](#i14))

### [I9] Monitor Implementation {#i9}

I watch the terminal output as implementation proceeds. The detailed output helps me:
- Understand what decisions the AI is making
- Catch deviations from the plan early
- Verify that tests are actually running and passing

**If progressing well:** Wait for completion, then proceed to [[I11]](#i11) (or skip to [[I12]](#i12) if confident).

**If struggling:** Proceed to [[I10]](#i10).

### [I10] Handle Struggles {#i10}

If the AI is struggling with the implementation (making repeated mistakes, going in circles, or producing incorrect code):

1. **Press ESC** to pause execution
2. **Take stock**: What's causing the difficulty?
3. **Ask questions**: Use conversation to understand the blocker
4. **Use agents to investigate**:
   - **code-architect** ([[I7]](#i7)): For design/architecture issues
   - **code-planner** ([[P2]](#p2)): For scope/decomposition issues
5. **Update the plan**: Revise the step with better guidance
6. **Resume**: Jump back to [[I8]](#i8) with the improved plan

This pause-investigate-revise pattern prevents wasted effort on fundamentally flawed approaches.

### [I11] Review with plan-step-reviewer {#i11}

When I have questions about implementation quality, I use the **plan-step-reviewer agent**:

```
Task tool → plan-step-reviewer agent
```

The plan-step-reviewer agent ([`.claude/agents/plan-step-reviewer.md`](#file-plan-step-reviewer)):
- Analyzes the plan step requirements (References, Artifacts, Tasks, Tests, Checkpoints)
- Examines code changes via `git diff`
- Evaluates across dimensions: correctness, completeness, architecture, performance, quality
- Produces a structured report with:
  - Summary verdict: PASS / PASS WITH NOTES / NEEDS WORK
  - Task checklist with status
  - Artifact verification
  - Recommendations for any issues

**If PASS:** Proceed to [[I12]](#i12).

**If NEEDS WORK:** Use code-architect or code-planner to revise, then return to [[I7]](#i7).

### [I12] Update the Implementation Log {#i12}

After a step implementation looks good, I run:

```
/update-plan-implementation-log
```

This command ([`.claude/commands/update-plan-implementation-log.md`](#file-update-log)):
- Reviews the conversation to identify completed work
- Reads the relevant plan file for context
- Generates a detailed completion summary with:
  - Machine-parseable header: `## [plan.md] Step: Title | STATUS | DATE`
  - References reviewed
  - Implementation progress table
  - Files created/modified
  - Test results
  - Checkpoints verified
  - Key decisions and notes
- **Prepends** the entry to [`plans/plan-implementation-log.md`](#file-impl-log) (newest first)

See [Implementation Log as History](#principle-impl-log) for why this matters.

### [I13] Prepare Commit Message {#i13}

I run:

```
/prepare-git-commit-message
```

This command ([`.claude/commands/prepare-git-commit-message.md`](#file-commit-msg)):
- Runs `git status` and `git diff` to see uncommitted changes
- Checks recent commit history for style consistency
- Analyzes what was changed and why
- Composes a commit message:
  - First line: imperative mood, under 50 characters
  - Bullets: terse, factual, lists key files
  - Plan reference if applicable
- **Writes to `git-commit-message.txt`** (does not commit)

### [I14] Commit and Continue {#i14}

I review the generated commit message, make any adjustments, and commit manually:

```bash
git add <files>
git commit -F git-commit-message.txt
```

**Next step:** Return to [[I7]](#i7) to assess the next execution step in the plan.

**Phase complete:** When all execution steps are done, the phase of work is complete.

---

## Key Design Principles {#principles}

### Multiple AI Perspectives {#principle-multiple-ai}

Using both Claude Opus and GPT-5.2 (see [[P3]](#p3), [[P5]](#p5)) provides:
- Different reasoning approaches
- Catches blind spots each model might have
- Cross-validation of technical assessments
- Higher confidence when both agree

### Iterative Refinement {#principle-iteration}

The 10-20 round planning process ([[P6]](#p6)) ensures:
- Requirements are fully understood
- Edge cases are considered
- Design decisions are justified
- Implementation steps are specific
- Checkpoints are meaningful

### Separation of Concerns {#principle-separation}

- **Commands** for actions that need detailed terminal output ([[I8]](#i8), [[I12]](#i12), [[I13]](#i13))
- **Agents** for investigation and analysis ([[P2]](#p2), [[I7]](#i7), [[I11]](#i11))
- **Me** 👋 for git operations and final decisions ([[I14]](#i14))

### Plan as Single Source of Truth {#principle-plan-truth}

The [plan file](#def-plan-file):
- Captures all decisions and rationale
- Gets updated with checkmarks as work progresses ([[I8]](#i8))
- Serves as documentation after completion
- Enables pause/resume across sessions ([[I10]](#i10))

### Implementation Log as History {#principle-impl-log}

The [`plans/plan-implementation-log.md`](#file-impl-log) file ([[I12]](#i12)):
- Tracks what was done and when
- Records implementation decisions
- Helps onboard new contributors
- Provides continuity across context windows

---

## Files Reference {#files-reference}

### Plan Files {#files-plans}

| ↗ | File | Anchor | Purpose |
|---|------|--------|---------|
| [↗](https://github.com/tugtool/tugtool/blob/main/plans/plan-skeleton.md) | `plans/plan-skeleton.md` | {#file-plan-skeleton} | Template defining plan file structure |
| — | `plans/phase-N.md` | {#file-phase} | Actual plan files for each phase |
| [↗](https://github.com/tugtool/tugtool/blob/main/plans/plan-implementation-log.md) | `plans/plan-implementation-log.md` | {#file-impl-log} | Historical record of completed work |

### Agents {#files-agents}

| ↗ | File | Anchor | Used In | Purpose |
|---|------|--------|---------|---------|
| [↗](https://github.com/tugtool/tugtool/blob/main/.claude/agents/code-planner.md) | `.claude/agents/code-planner.md` | {#file-code-planner} | [[P2]](#p2), [[P4]](#p4) | Agent for creating and revising plans |
| [↗](https://github.com/tugtool/tugtool/blob/main/.claude/agents/code-architect.md) | `.claude/agents/code-architect.md` | {#file-code-architect} | [[I7]](#i7), [[I10]](#i10) | Agent for detailed design and breakdown |
| [↗](https://github.com/tugtool/tugtool/blob/main/.claude/agents/plan-step-reviewer.md) | `.claude/agents/plan-step-reviewer.md` | {#file-plan-step-reviewer} | [[I11]](#i11) | Agent for reviewing implementations |

### Commands {#files-commands}

| ↗ | File | Anchor | Used In | Purpose |
|---|------|--------|---------|---------|
| [↗](https://github.com/tugtool/tugtool/blob/main/.claude/commands/implement-plan.md) | `.claude/commands/implement-plan.md` | {#file-implement-plan} | [[I8]](#i8) | Command for executing plan steps |
| [↗](https://github.com/tugtool/tugtool/blob/main/.claude/commands/update-plan-implementation-log.md) | `.claude/commands/update-plan-implementation-log.md` | {#file-update-log} | [[I12]](#i12) | Command for logging completions |
| [↗](https://github.com/tugtool/tugtool/blob/main/.claude/commands/prepare-git-commit-message.md) | `.claude/commands/prepare-git-commit-message.md` | {#file-commit-msg} | [[I13]](#i13) | Command for generating commit messages |

### Generated Files {#files-generated}

| File | Purpose |
|------|---------|
| `git-commit-message.txt` | Generated commit message for manual review ([[I13]](#i13), [[I14]](#i14)) |
