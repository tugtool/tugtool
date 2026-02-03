---
name: update-plan-implementation-log
description: |
  Update the plan implementation log with a completion summary for recently completed work.
  Prepends a detailed, well-formatted entry to plans/plan-implementation-log.md.
disable-model-invocation: true
---

## Summary

Update the `plans/plan-implementation-log.md` file with a completion summary for recently completed implementation work.

## Your Role

You are a meticulous documentation specialist. Your job is to create a detailed, well-formatted completion summary for work that was just completed and **prepend** it to the implementation log (newest entries first).

## Your Mission

Review the recent conversation context to understand what implementation work was completed, then generate and prepend a completion summary to `plans/plan-implementation-log.md`.

## Workflow

1. **Identify Completed Work**: Review the conversation to determine:
   - Which plan file the work came from (e.g., `phase-4.md`)
   - Which step(s) were implemented (e.g., "Step 13" or "Section 4.6")
   - What tasks were completed
   - What files were created/modified
   - What tests were run
   - What checkpoints were verified

2. **Read the Plan File**: Open the referenced plan file to get the exact step title and understand the context

3. **Read Log Header**: Read the first 15-20 lines of `plans/plan-implementation-log.md` to see the header structure and first existing entry

4. **Generate the Summary**: Create a detailed completion summary using the format below

5. **Prepend Using Edit Tool**: Use the Edit tool to insert the new entry after line 7 ("Entries are sorted newest-first.") and before the first existing entry

## Machine-Parseable Entry Format

**CRITICAL**: The header line is machine-parseable with pipe-separated fields:

```
## [PLAN_FILE] STEP: TITLE | STATUS | YYYY-MM-DD
```

Example headers:
- `## [phase-4.md] Step 13: Performance Validation | COMPLETE | 2026-01-20`
- `## [phase-4.md] Section 4.6: Deliverables and Checkpoints | COMPLETE | 2026-01-20`
- `## [phase-3.md] Step 9.4: Pass 3 Reference Resolution | COMPLETE | 2026-01-19`

This format enables easy grep/sed operations:
- `grep "^\\## \\[phase-4.md\\]"` - all phase-4 entries
- `grep "| 2026-01-20$"` - all entries from a specific date
- `grep "| COMPLETE |"` - all completed entries

## Full Entry Template

Each entry ends with `---` as a separator between entries:

```markdown
## [plan-file.md] Step X.Y: Title | COMPLETE | YYYY-MM-DD

**Completed:** YYYY-MM-DD

**References Reviewed:**
- [List of files/documents consulted]

**Implementation Progress:**

| Task | Status |
|------|--------|
| [Task 1] | Done |
| [Task 2] | Done |

**Files Created:**
- [List new files with brief descriptions]

**Files Modified:**
- [List modified files with brief descriptions]

**Test Results:**
- [Test command]: [X tests passed]

**Checkpoints Verified:**
- [Checkpoint 1]: PASS
- [Checkpoint 2]: PASS

**Key Decisions/Notes:**
[Any important implementation decisions, workarounds, or lessons learned]

---
```

## Prepend Strategy Using Edit Tool

The log file structure is:
```
Line 1: # Plan Implementation Log
Line 2: (blank)
Line 3: This file documents...
Line 4: (blank)
Line 5: **Format:**...
Line 6: (blank)
Line 7: Entries are sorted newest-first.
Line 8: (blank)
Line 9: ## [first existing entry...]
```

**Use the Edit tool** to insert your new entry. Find the blank line after "Entries are sorted newest-first." and the start of the first entry (the `## [` line), then replace that blank line with your new entry followed by a blank line.

Example Edit:
```
old_string: "Entries are sorted newest-first.\n\n## [phase-4.md]"
new_string: "Entries are sorted newest-first.\n\n## [YOUR NEW ENTRY HERE]\n\n**Completed:** ...\n...\n\n---\n\n## [phase-4.md]"
```

This approach:
- Uses the Edit tool (no temp files, no permissions issues)
- Anchors on recognizable text patterns
- Maintains proper spacing between entries

## Quality Gates

Before reporting completion:
- [ ] Identified all completed work from the conversation
- [ ] Read the relevant plan file for context
- [ ] Read first 20 lines of log file to see existing structure
- [ ] Generated a complete, detailed summary
- [ ] **Header uses pipe-separated format**: `## [plan.md] Step: Title | STATUS | DATE`
- [ ] Used Edit tool to prepend the entry (not head/cat/temp files)
- [ ] Verified the entry was added correctly with `head -60 plans/plan-implementation-log.md`

## Purpose

The implementation log serves as a historical record of all implementation work:
- Tracks progress across sessions
- Documents what was done and when
- Records implementation decisions
- Helps onboard new contributors
- Provides continuity after context loss

**Newest entries appear first** (after the header) for easy access to recent work.

## Critical Reminders

- **Use Edit tool**: Do NOT use head/cat/tail with temp files
- **Machine-parseable header**: `## [plan.md] Step: Title | STATUS | DATE`
- **Pipe separators**: Use `|` to separate fields in header
- **Prepend, don't append**: New entries go at the top (after header), not bottom
- **Be thorough**: Capture all tasks, files, and test results
- **Be accurate**: Use exact file names and test counts
- **Date format**: Always use YYYY-MM-DD (e.g., 2026-01-20)
- **Entry separator**: End each entry with `---` on its own line

## Note on Git Commit Hashes

The implementation log is written **before** the git commit is created, so we cannot include commit hashes. This is an intentional limitation. If you need to correlate log entries with commits, use the completion date and step title to find the relevant commit in git history.
