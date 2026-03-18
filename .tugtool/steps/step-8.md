# Step 8 Checkpoint Output

## Summary

Verification-only step (plan anchor #step-8). No code changes were made. All 6 verification
checks passed. This is the final validation checkpoint for Phase 1.5: Make Token Pairings
Machine-Auditable (tugplan-token-audit-enforce).

---

## Check 1: bun run audit:tokens lint

```
$ bun run scripts/audit-tokens.ts lint

=== Lint Token Annotations ===

✓ Zero violations. All annotation, alias, and pairing checks pass.
```

**Result: PASS** — exit 0. Zero MISSING_ANNOTATION, MULTI_HOP_ALIAS, MISSING_PAIRINGS_BLOCK,
and UNRESOLVED_PAIRING violations across all 23 component CSS files.

---

## Check 2: bun run audit:tokens pairings (zero unresolved)

```
$ bun run scripts/audit-tokens.ts pairings
...
=== Gap Analysis ===
Pairings in CSS but NOT in pairing map (gaps): 2
  --tug-toggle-on-color                         on  --tug-toggle-on-color  [tug-checkbox.css]
  --tug-toggle-on-hover-color                   on  --tug-toggle-on-hover-color  [tug-checkbox.css]

Pairings in map but NOT found in CSS (orphans): 157
  (showing first 20)
  fg-default                                    on  bg-app
  fg-default                                    on  surface-sunken
  ...
```

**Result: PASS — zero unresolved pairings.** The output contains no lines matching "unresolved".
The 2 "gap" entries (`--tug-toggle-on-color`, `--tug-toggle-on-hover-color`) are JS-injected
runtime accent-color override tokens used by the hue-strip component — they are not `--tug-base-*`
tokens and are intentionally outside audit scope. The 157 orphans are informational: map entries
for tokens whose surface is determined by document context rather than a component-local CSS rule
(e.g., `fg-default on bg-app`) — these are expected and pre-existing.

---

## Check 3: bun run audit:tokens verify

```
$ bun run scripts/audit-tokens.ts verify

=== Verify Pairings Cross-Check ===

Pairing map entries: 339
CSS @tug-pairings entries: 275

ℹ ORPHANS: 150 pairings in map but NOT in any @tug-pairings block

✓ All CSS @tug-pairings entries have corresponding map entries.

Files with @tug-pairings: 23/23

✓ Verification passed.
```

**Result: PASS** — exit 0. All 275 CSS `@tug-pairings` entries resolve to map entries. All
23 component CSS files have `@tug-pairings` blocks. 150 orphans are informational.

---

## Check 4: bun test

```
bun test v1.3.9 (cf6cdbbb)

 1878 pass
 0 fail
 13861 expect() calls
Ran 1878 tests across 71 files. [19.41s]
```

**Result: PASS** — 1878/1878 tests passed across 71 files, 0 failures.

---

## Check 5: cargo nextest run

```
   Compiling tugcode v0.7.39
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.93s
────────────
 Nextest run ID 73768157-6cff-4772-95bf-273cc96db6c7 with nextest profile: default
    Starting 884 tests across 15 binaries (9 tests skipped)
────────────
     Summary [   4.779s] 884 tests run: 884 passed, 9 skipped
```

**Result: PASS** — 884/884 tests passed across 15 binaries, 9 skipped.

---

## Check 6: grep Rule 16, Rule 17, D81 in roadmap/design-system-concepts.md

```
$ grep -n 'Rule 16\|Rule 17\|D81' roadmap/design-system-concepts.md

22:16. **Every color-setting rule declares its rendering surface.** If a CSS rule sets `color`,
    `fill`, or `border-color` and does NOT set `background-color` in the same rule, it must
    include a `@tug-renders-on` annotation naming the `--tug-base-*` surface token(s) it renders
    on. Rules that set both foreground and background are self-documenting (strategy 1 / same-rule
    match) and need no annotation. `audit-tokens lint` enforces this — zero `MISSING_ANNOTATION`
    violations are required. [D81]

23:17. **Component alias tokens resolve to `--tug-base-*` in one hop.** No alias-to-alias chains
    in component CSS `body {}` blocks. Every component alias (e.g., `--tug-button-bg`) must point
    directly to its `--tug-base-*` target. Deliberate backward-compat alias layers are exempt if
    listed in the `COMPAT_ALIAS_ALLOWLIST` in `audit-tokens.ts`, but the final alias in any chain
    must point directly to `--tug-base-*`. Cross-component dependency chains are not compat layers
    and must be flattened. `audit-tokens lint` flags multi-hop chains as `MULTI_HOP_ALIAS`
    violations. [D81]

140:| [D81] | Token pairings are machine-auditable: every foreground-on-background rendering
     relationship is deterministically extractable from CSS alone — either via same-rule
     background-color or via `@tug-renders-on` annotation. `audit-tokens lint` enforces this.
     | Phase 1.5 | [#d81-machine-auditable-pairings](#d81-machine-auditable-pairings) |

3763:**[D81] Token pairings are machine-auditable. Every foreground-on-background rendering
     relationship is deterministically extractable from CSS alone — either via same-rule
     `background-color` or via `@tug-renders-on` annotation. `audit-tokens lint` enforces this.**

3769:**@tug-renders-on annotation (Rule 16).** Every CSS rule that sets `color`, `fill`,
     `border-color`, `border` shorthand (containing a color token), directional border shorthands,
     or `-webkit-text-fill-color` without setting `background-color` in the same rule must carry
     a `/* @tug-renders-on: --tug-base-{surface} */` annotation. [...]

3771:**Alias chain flattening (Rule 17).** Multi-hop alias chains in component CSS `body {}`
     blocks prevent static resolution of a component token to its `--tug-base-*` target without
     executing the chain. [...]
```

**Result: PASS** — Rule 16 at line 22 (Rules of Tugways #16), Rule 17 at line 23 (Rules of
Tugways #17), D81 at lines 140 (table entry), 3763 (section heading bold), 3769 (body reference),
3771 (body reference). All four D81 locations are present and consistent.

---

## Phase Exit Criteria — All Met

| Criterion | Command | Result |
|-----------|---------|--------|
| `audit:tokens lint` exits 0, zero violations | `bun run audit:tokens lint` | PASS |
| `audit:tokens pairings` — zero unresolved | `bun run audit:tokens pairings` | PASS |
| `audit:tokens verify` exits 0, zero gaps | `bun run audit:tokens verify` | PASS |
| All bun tests pass | `bun test` | PASS — 1878/1878 |
| All Rust tests pass | `cargo nextest run` | PASS — 884/884 |
| Rules 16, 17 and D81 in design-system-concepts.md | `grep -n 'Rule 16\|Rule 17\|D81'` | PASS — 6 matches |

Phase 1.5 complete. No files were created or modified during this step.
