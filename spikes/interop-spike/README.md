# Tug Interop Spike Test

**Purpose:** Verify that the Claude Code → tug → refactor workflow actually works before committing to Phase 8 implementation.

**Time:** ~15 minutes

---

## Setup

1. Ensure `tug` is built and in your PATH:
   ```bash
   cargo build -p tugtool --release
   export PATH="$PWD/target/release:$PATH"
   ```

2. Navigate to this spike directory:
   ```bash
   cd spikes/interop-spike
   ```

3. Verify tug works:
   ```bash
   tug --version
   ```

---

## Test Scenario

This directory contains a minimal Python project with:
- `lib/utils.py` - defines `process_data()` function
- `lib/__init__.py` - re-exports `process_data`
- `lib/processor.py` - imports and uses `process_data()`
- `main.py` - imports and uses `process_data()`

The symbol `process_data` appears in 4 files, with 1 definition and multiple usages/imports.

### CRITICAL ISSUE FOUND

During spike setup (2026-01-22), we discovered that **tug's cross-file rename is broken**:

```
# Before rename: process_data appears in 8 locations across 4 files
# After rename: only 2 locations were updated, code is broken

$ tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data
# Result: 2 files changed, 2 edits

$ python3 main.py
# ImportError: cannot import name 'process_data' from 'lib.utils'
```

**What happened:**
- Tug renamed the function definition in `lib/utils.py`
- Tug renamed ONE entry in `lib/__init__.py` (`__all__` list)
- Tug DID NOT rename:
  - `lib/__init__.py:2` - `from .utils import process_data`
  - `lib/processor.py:3,18,19` - import and usages
  - `main.py:4,14` - import and usage

**Impact on Phase 8:**
This is a **blocker**. Before implementing Claude Code interop, tug itself must correctly rename symbols across files. The interop layer assumes tug works; if tug produces broken code, no amount of interop polish will help.

**Recommended action:**
1. File a bug / create a new phase to fix cross-file rename
2. Defer Phase 8 interop until rename is reliable
3. Re-run this spike after the fix

---

## The Spike Test

### Phase 1: Manual Tug Test (Baseline)

First, verify tug itself works on this codebase:

```bash
# From spikes/interop-spike directory

# 1. Analyze impact (the definition is at lib/utils.py:4:5)
tug analyze-impact rename-symbol --at lib/utils.py:4:5 --to transform_data

# 2. Dry run
tug run --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data

# 3. Apply (if dry run looks good)
tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data

# 4. Verify the rename happened
grep -r "transform_data" .
grep -r "process_data" .  # should find nothing

# 5. Reset for Claude Code test
git checkout .
```

**Checkpoint:** If manual tug works, proceed to Phase 2.

---

### Phase 2: Claude Code Discovery Test

Open Claude Code in this directory and give it this prompt:

```
I want to rename the function `process_data` to `transform_data`.

Before making any changes, can you:
1. Find where process_data is defined
2. Tell me the exact file, line, and column of the definition
3. Show me all the places it's used
```

**Observe:**
- [ ] Does Claude search for the symbol?
- [ ] Does Claude find the definition in `lib/utils.py`?
- [ ] Does Claude report the correct line number (line 4)?
- [ ] Does Claude find the usages in `lib/processor.py` and `main.py`?
- [ ] Does Claude report column numbers, or just line numbers?

**Record results here:**
```
Definition found: _______________
Line/col reported: _______________
Usages found: _______________
Notes: _______________
```

---

### Phase 3: Claude Code Tug Invocation Test

Now test if Claude can invoke tug. Give it this prompt:

```
Now use the `tug` command to rename process_data to transform_data.

The tug command format is:
  tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>
  tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>
  tug run --apply --verify syntax rename-symbol --at <file:line:col> --to <new_name>

Please:
1. First run analyze-impact to see what will change
2. Then run a dry-run to preview the changes
3. Show me the results before applying
```

**Observe:**
- [ ] Does Claude construct the correct `--at` argument?
- [ ] Does Claude run `tug analyze-impact` successfully?
- [ ] Does Claude parse the JSON output?
- [ ] Does Claude run the dry-run?
- [ ] Does Claude ask for approval before applying?
- [ ] Does Claude run the apply command correctly?

**Record results here:**
```
analyze-impact ran: _______________
--at argument used: _______________
dry-run ran: _______________
approval asked: _______________
apply ran: _______________
final result: _______________
```

---

### Phase 4: Natural Language Test

Reset the files and try a completely natural prompt:

```bash
git checkout .
```

Then in Claude Code:

```
Rename the function process_data to transform_data using tug.
```

**Observe:**
- [ ] Does Claude figure out the workflow without explicit instructions?
- [ ] Does Claude find the symbol location?
- [ ] Does Claude invoke tug correctly?
- [ ] What friction points exist?

**Record results here:**
```
Outcome: _______________
Friction points: _______________
```

---

## Results Analysis

### Success Criteria

The workflow is **viable** if:
1. Claude can find symbol definitions (with line numbers)
2. Claude can construct the `file:line:col` argument
3. Claude can run tug commands via bash
4. Claude can parse JSON output

### Potential Issues

| Issue | Mitigation |
|-------|------------|
| Claude doesn't find column numbers | Tug could accept `file:line` (column defaults to 1) |
| Claude can't parse tug JSON | Simplify JSON or add human-readable summary |
| Multiple definitions confuse Claude | Add `tug find-symbol` command for discovery |
| Workflow too many steps | Create wrapper command or simplify tug CLI |

---

## Conclusions

After running the spike, answer:

1. **Is the workflow viable as planned?** (yes/no/with-changes)

2. **What changes are needed to Phase 8?**
   - [ ] Update command instructions to include explicit discovery steps
   - [ ] Add `tug find-symbol` command (new feature, future phase)
   - [ ] Simplify `--at` argument format
   - [ ] Other: _______________

3. **Recommended next steps:**

```
[Write conclusions here after running the spike]
```
