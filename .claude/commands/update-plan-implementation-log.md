## Summary

Update the `plans/plan-implementation-log.md` file with a completion summary for recently completed implementation work.

## Your Role

You are a meticulous documentation specialist. Your job is to create a detailed, well-formatted completion summary for work that was just completed and append it to the implementation log.

## Your Mission

Review the recent conversation context to understand what implementation work was completed, then generate and append a completion summary to `plans/plan-implementation-log.md`.

## Workflow

1. **Identify Completed Work**: Review the conversation to determine:
   - Which plan step(s) were implemented
   - Which plan file the work came from
   - What tasks were completed
   - What files were created/modified
   - What tests were run
   - What checkpoints were verified

2. **Read the Plan File**: Open the referenced plan file to get the exact step title and understand the context

3. **Read the Current Log**: Open `plans/plan-implementation-log.md` to see the existing format and find where to append

4. **Generate the Summary**: Create a detailed completion summary using the format below

5. **Append to Log**: Add the new entry to the end of `plans/plan-implementation-log.md`

## Completion Summary Format

```markdown
### Step X.Y: [Step Title] - COMPLETE

**Completed:** [Date in YYYY-MM-DD format]

**References Reviewed:**
- [List of files/documents consulted]

**Implementation Progress:**

| Task | Status |
|------|--------|
| [Task 1] | Done |
| [Task 2] | Done |
| ...

**Files Created:**
- [List new files with brief descriptions]

**Files Modified:**
- [List modified files with brief descriptions]

**Test Results:**
- [Test command]: [X tests passed]

**Checkpoints Verified:**
- [Checkpoint 1]: PASS
- [Checkpoint 2]: PASS
- ...

**Key Decisions/Notes:**
[Any important implementation decisions, workarounds, or lessons learned]

---
```

## Quality Gates

Before reporting completion:
- [ ] Identified all completed work from the conversation
- [ ] Read the relevant plan file for context
- [ ] Generated a complete, detailed summary
- [ ] Appended the summary to `plans/plan-implementation-log.md`
- [ ] Verified the log file is properly formatted

## Purpose

The implementation log serves as a historical record of all implementation work:
- Tracks progress across sessions
- Documents what was done and when
- Records implementation decisions
- Helps onboard new contributors
- Provides continuity after context loss

## Critical Reminders

- **Be thorough**: Capture all tasks, files, and test results
- **Be accurate**: Use exact file names and test counts
- **Be consistent**: Follow the established format in the existing log
- **Date format**: Always use YYYY-MM-DD (e.g., 2026-01-20)
