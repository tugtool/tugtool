# Claude Code Orchestration Patterns

This document defines the canonical terminology for all skill and agent invocation patterns.

## Quick Reference Table

| Pattern Name | Tool | Invocation Syntax | Context | Sees Prior? | Args In | Results Out |
|--------------|------|-------------------|---------|-------------|---------|-------------|
| **Skill-Inline** | Skill | `Skill(skill: "x", args: "...")` | shared | Yes | `$ARGUMENTS` | Direct in conversation |
| **Skill-Forked** | Skill | Skill + `context: fork` | isolated | No | `$ARGUMENTS` | Summary to caller |
| **Skill-Forked-Typed** | Skill | Skill + `context: fork` + `agent: X` | isolated | No | `$ARGUMENTS` | Summary to caller |
| **Task-GeneralPurpose** | Task | `Task(subagent_type: "general-purpose")` | isolated | No | `prompt` | Summary + agentId |
| **Task-Explore** | Task | `Task(subagent_type: "Explore")` | isolated | No | `prompt` | Summary + agentId |
| **Task-Plan** | Task | `Task(subagent_type: "Plan")` | isolated | No | `prompt` | Summary + agentId |
| **Task-CustomAgent** | Task | `Task(subagent_type: "my-agent")` | isolated | No | `prompt` | Summary + agentId |
| **Task-CustomWithSkills** | Task | Custom agent with `skills:` field | isolated | No | `prompt` | Summary + agentId |
| **Task-Background** | Task | `Task(..., run_in_background: true)` | isolated | No | `prompt` | Async notification |
| **Task-Resumed** | Task | `Task(resume: "agentId")` | isolated | Own history | `prompt` | Summary + agentId |

---

## Detailed Pattern Definitions

### SKILL TOOL PATTERNS

#### Skill-Inline
- **Definition**: Skill invoked via Skill tool WITHOUT `context: fork` in frontmatter
- **File**: `.claude/skills/<name>/SKILL.md` (no `context: fork`)
- **Invocation**: `Skill(skill: "name", args: "data")`
- **Context behavior**: Runs inline in main conversation
- **Sees prior context**: YES - full conversation visible
- **Communication in**: `$ARGUMENTS` substitution in skill markdown
- **Communication out**: Output appears directly in conversation stream
- **Use cases**: Prompt injection, workflow shortcuts, commands needing full context

#### Skill-Forked
- **Definition**: Skill with `context: fork` in frontmatter, uses default agent
- **File**: `.claude/skills/<name>/SKILL.md` with `context: fork`
- **Invocation**: `Skill(skill: "name", args: "data")`
- **Context behavior**: Spawns isolated subagent internally
- **Sees prior context**: NO - fresh context
- **Communication in**: `$ARGUMENTS` substitution in skill markdown
- **Communication out**: Summary returned to caller
- **Use cases**: Stateless utilities, context-pollution prevention

#### Skill-Forked-Typed
- **Definition**: Skill with `context: fork` AND `agent: <type>` in frontmatter
- **File**: `.claude/skills/<name>/SKILL.md` with `context: fork` + `agent: Explore|Plan|general-purpose|custom`
- **Invocation**: `Skill(skill: "name", args: "data")`
- **Context behavior**: Spawns specified agent type
- **Sees prior context**: NO - fresh context
- **Communication in**: `$ARGUMENTS` substitution in skill markdown
- **Communication out**: Summary returned to caller
- **Use cases**: Specialized isolated tasks (read-only exploration, planning)

---

### TASK TOOL PATTERNS

#### Task-GeneralPurpose
- **Definition**: Task tool spawning general-purpose subagent
- **Invocation**: `Task(prompt: "...", subagent_type: "general-purpose")`
- **Agent capabilities**: All tools, inherits model
- **Sees prior context**: NO - fresh context
- **Communication in**: `prompt` parameter
- **Communication out**: Result summary + `agentId` for resumption
- **Use cases**: Complex subtasks, parallel work, multi-step operations

#### Task-Explore
- **Definition**: Task tool spawning Explore subagent (read-only)
- **Invocation**: `Task(prompt: "...", subagent_type: "Explore")`
- **Agent capabilities**: Read-only tools (Read, Grep, Glob), Haiku model
- **Sees prior context**: NO - fresh context
- **Communication in**: `prompt` parameter
- **Communication out**: Result summary + `agentId`
- **Use cases**: Codebase exploration, research, no-mutation tasks

#### Task-Plan
- **Definition**: Task tool spawning Plan subagent
- **Invocation**: `Task(prompt: "...", subagent_type: "Plan")`
- **Agent capabilities**: Read-only tools, inherits model
- **Sees prior context**: NO - fresh context
- **Communication in**: `prompt` parameter
- **Communication out**: Result summary + `agentId`
- **Use cases**: Architecture planning, design documents

#### Task-CustomAgent
- **Definition**: Task tool spawning user-defined agent from `.claude/agents/`
- **File**: `.claude/agents/<name>.md` with frontmatter
- **Invocation**: `Task(prompt: "...", subagent_type: "my-agent")`
- **Agent capabilities**: Defined by `tools:`, `model:`, `permissionMode:` in frontmatter
- **Sees prior context**: NO - fresh context
- **Communication in**: `prompt` parameter
- **Communication out**: Result summary + `agentId`
- **Use cases**: Domain-specific workflows, restricted toolsets

#### Task-CustomWithSkills
- **Definition**: Custom agent with `skills:` field preloading skill content
- **File**: `.claude/agents/<name>.md` with `skills:` field
- **Invocation**: `Task(prompt: "...", subagent_type: "my-agent")`
- **Agent capabilities**: Custom tools + preloaded skill knowledge
- **Sees prior context**: NO - fresh context, but skill content injected
- **Communication in**: `prompt` parameter + preloaded skill content
- **Communication out**: Result summary + `agentId`
- **Use cases**: Agents needing domain expertise from skills

#### Task-Background
- **Definition**: Any Task pattern with `run_in_background: true`
- **Invocation**: `Task(..., run_in_background: true)`
- **Behavior**: Non-blocking, returns immediately with output_file path
- **Sees prior context**: NO
- **Communication in**: `prompt` parameter
- **Communication out**: Async completion notification; use `TaskOutput` to retrieve
- **Use cases**: Long-running tasks, parallel independent work

#### Task-Resumed
- **Definition**: Continuing a previous subagent's work
- **Invocation**: `Task(resume: "agentId", prompt: "continue with...")`
- **Behavior**: Resumes with full prior subagent context
- **Sees prior context**: YES - its own history (not caller's)
- **Communication in**: `prompt` parameter
- **Communication out**: Continued result + same `agentId`
- **Use cases**: Follow-up questions, iterating on subagent work

---

## Context Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      MAIN CONVERSATION                               │
│   (full context, all tools, user interaction, CLAUDE.md loaded)     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Skill-Inline  ───────────────────────────────→  RUNS HERE         │
│   (no fork)         sees everything, outputs directly                │
│                                                                      │
├─────────────────────────┬───────────────────────────────────────────┤
│                         │                                            │
│   Skill-Forked ────────→│←──────── Task-* (any variant)             │
│   Skill-Forked-Typed    │                                            │
│                         ▼                                            │
│              ┌─────────────────────────┐                            │
│              │    ISOLATED SUBAGENT    │                            │
│              │  • Fresh context only   │                            │
│              │  • No prior messages    │                            │
│              │  • Scoped tools/perms   │                            │
│              │  • CLAUDE.md inherited  │                            │
│              │  • Returns summary      │                            │
│              │  • Resumable via ID     │                            │
│              └─────────────────────────┘                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Decision Matrix: Pattern Selection

| Requirement | Recommended Pattern |
|-------------|---------------------|
| Quick expansion needing conversation context | **Skill-Inline** |
| Reusable utility, avoid context pollution | **Skill-Forked** |
| Isolated task with specific agent type | **Skill-Forked-Typed** |
| Complex parallel subtasks | **Task-GeneralPurpose** |
| Read-only codebase research | **Task-Explore** |
| Architecture/design without mutations | **Task-Plan** |
| Domain-specific restricted workflow | **Task-CustomAgent** |
| Agent needing preloaded expertise | **Task-CustomWithSkills** |
| Long-running, don't block user | **Task-Background** |
| Continue previous agent's work | **Task-Resumed** |

---

## Communication Patterns Summary

### Input to Sub-components

| Mechanism | How to Pass Data |
|-----------|------------------|
| Skill Tool | `args` parameter → `$ARGUMENTS` substitution in SKILL.md |
| Task Tool | `prompt` parameter (free text) |
| Preloaded Skills | `skills:` field in agent frontmatter (content injected at spawn) |

### Output from Sub-components

| Pattern | Output Mechanism |
|---------|------------------|
| Skill-Inline | Direct output in conversation stream |
| Skill-Forked | Summary message returned to caller |
| Task-* | Result summary + `agentId` for resumption |
| Task-Background | `output_file` path; poll with `TaskOutput` |

---

## Agent Configuration Reference

### Frontmatter Fields for Custom Agents (`.claude/agents/*.md`)

| Field | Values | Purpose |
|-------|--------|---------|
| `name` | string | Agent identifier |
| `description` | string | When Claude should delegate to this agent |
| `tools` | tool list | Allowed tools (restricts from inherited) |
| `disallowedTools` | tool list | Explicitly denied tools |
| `model` | `haiku`, `sonnet`, `opus`, `inherit` | Model selection |
| `skills` | skill name list | Skills to preload into agent context |
| `permissionMode` | `default`, `acceptEdits`, `dontAsk`, `delegate`, `bypassPermissions`, `plan` | Permission handling |
| `memory` | `user`, `project`, `local` | Persistent memory scope |
| `maxTurns` | number | Maximum agentic turns |

### Frontmatter Fields for Skills (`.claude/skills/*/SKILL.md`)

| Field | Values | Purpose |
|-------|--------|---------|
| `name` | string | Skill name (becomes `/name` command) |
| `description` | string | When Claude should use this skill |
| `context` | `fork` | If set, runs in isolated subagent |
| `agent` | agent type | Which agent runs when `context: fork` |
| `disable-model-invocation` | `true` | Only user can invoke (not Claude) |
| `user-invocable` | `false` | Hide from `/` menu |
| `allowed-tools` | tool list | Tools allowed without permission prompts |
| `model` | model name | Model override |

---

## Anti-Patterns

| Anti-Pattern | Problem | Better Approach |
|--------------|---------|-----------------|
| Skill-Inline for long/complex tasks | Pollutes main context | Use Skill-Forked or Task-* |
| Task-* for simple lookups | Subagent spawn overhead | Use Skill-Inline |
| Skill-Forked when needing conversation | Cannot access prior context | Use Skill-Inline |
| Task-Background expecting immediate result | Must poll/wait anyway | Use foreground Task-* |
| Custom agent without `tools:` restriction | No benefit over general-purpose | Always scope tools |
