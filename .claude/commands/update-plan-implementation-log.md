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

3. **DO NOT read the entire log file**: The log file is too large to read in full. You only need to know:
   - New entries are prepended after line 8 (after the `---` separator following the header)
   - Use `head -15` if you need to verify the header structure

4. **Generate the Summary**: Create a detailed completion summary using the format below

5. **Prepend to Log**: Insert the new entry after line 8 of `plans/plan-implementation-log.md`

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
- `grep "^\## \[phase-4.md\]"` - all phase-4 entries
- `grep "| 2026-01-20$"` - all entries from a specific date
- `grep "| COMPLETE |"` - all completed entries

## Full Entry Template

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

## Prepend Strategy

Since the log file is large (3000+ lines), do NOT try to read the entire file. Instead:

```bash
# Read just the header (first 8 lines)
head -8 plans/plan-implementation-log.md > /tmp/log-header.md

# Write your new entry to a temp file
cat > /tmp/new-entry.md << 'EOF'
## [phase-X.md] Step Y: Title | COMPLETE | YYYY-MM-DD

**Completed:** YYYY-MM-DD
...rest of entry...

---
EOF

# Get everything after line 8 (existing entries)
tail -n +9 plans/plan-implementation-log.md > /tmp/log-body.md

# Combine: header + new entry + existing entries
cat /tmp/log-header.md /tmp/new-entry.md /tmp/log-body.md > plans/plan-implementation-log.md
```

## Quality Gates

Before reporting completion:
- [ ] Identified all completed work from the conversation
- [ ] Read the relevant plan file for context
- [ ] Generated a complete, detailed summary
- [ ] **Header uses pipe-separated format**: `## [plan.md] Step: Title | STATUS | DATE`
- [ ] Prepended the summary to `plans/plan-implementation-log.md` (after header)
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

- **Machine-parseable header**: `## [plan.md] Step: Title | STATUS | DATE`
- **Pipe separators**: Use `|` to separate fields in header
- **Prepend, don't append**: New entries go at the top (after header), not bottom
- **Don't read entire file**: The log is too large; just use head/tail as needed
- **Be thorough**: Capture all tasks, files, and test results
- **Be accurate**: Use exact file names and test counts
- **Date format**: Always use YYYY-MM-DD (e.g., 2026-01-20)
- **Entry separator**: End each entry with `---` on its own line

## Note on Git Commit Hashes

The implementation log is written **before** the git commit is created, so we cannot include commit hashes. This is an intentional limitation. If you need to correlate log entries with commits, use the completion date and step title to find the relevant commit in git history.
