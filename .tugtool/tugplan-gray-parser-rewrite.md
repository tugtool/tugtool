<!-- tugplan-skeleton v2 -->

## Gray Pseudo-Hue and Parser Rewrite {#gray-parser-rewrite}

**Purpose:** Add 'gray' as an achromatic pseudo-hue to the TugColor palette system, and comprehensively rewrite the tug-color parser covering all 8 audit items: proper tokenizer with uppercase/hex-escape/NBSP handling, soft warnings, source spans, lookup-table dispatch, and error recovery.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The TugColor system currently supports two achromatic keywords — `black` and `white` — which produce fixed L values (0 and 1) and ignore intensity/tone. There is no way to express a neutral gray that participates in the tone formula. Designers need a `gray` pseudo-hue that produces achromatic colors (C=0) at arbitrary lightness levels controlled by tone, using canonical L=0.5 as its midpoint.

Separately, the tug-color parser has accumulated technical debt across 8 audit items: the tokenizer only handles lowercase a-z and produces poor errors for uppercase input or CSS hex escapes; bare minus without a number crashes ambiguously; there is no way to surface soft warnings for suspicious-but-valid values; `findTugColorCalls` silently drops unmatched parens; error positions are single integers rather than spans; slot assignment uses duplicated if/else chains; and errors cascade rather than recovering at comma boundaries. This plan addresses all 8 items in a single coordinated rewrite.

#### Strategy {#strategy}

- Ship gray first: it is a small, self-contained addition with high design value. Gray follows the black/white special-case pattern in the parser and PostCSS plugin, but unlike black/white it participates in the tone formula (canonical L=0.5).
- Parser rewrite second: the tokenizer rewrite is the foundation — uppercase normalization, CSS hex escapes, and NBSP handling must land before other audit items build on top.
- Soft warnings are additive: `ParseResult` gains an optional `warnings` array on the `ok: true` branch. PostCSS logs warnings but does not fail the build.
- Source spans replace single `pos` integers: `TugColorError` gains a mandatory `end` field. All error-producing code paths set both `pos` (start) and `end`.
- Lookup-table dispatch replaces duplicated if/else chains for slot assignment. Pure internal refactor — no public API change.
- Error recovery: on a bad token, skip to the next comma and continue parsing. Report all problems in one pass instead of cascading noise.
- Gallery achromatic strip: a small black/gray/white strip rendered separately from the 48-hue TugHueStrip, shown above or below it in the palette gallery only.

#### Success Criteria (Measurable) {#success-criteria}

- `--tug-color(gray, t: 50)` expands to `oklch(0.5 0 0)` (L from tone formula with canonical L=0.5: L = 0.15 + 50*(0.5-0.15)/50 = 0.5, C=0, h=0) — verified by PostCSS test
- `--tug-color(gray, i: 80, t: 30)` produces C=0 regardless of intensity — verified by parser test
- `parseTugColor("Gray")` succeeds (uppercase normalized to lowercase) — verified by parser test
- `parseTugColor("\\41")` produces ident `a` (CSS hex escape decoded) — verified by parser test
- `parseTugColor("red,\u00A0 50")` succeeds (NBSP treated as whitespace) — verified by parser test
- `parseTugColor("red, -, 50")` produces error with message mentioning "bare minus" — verified by parser test
- Soft warning emitted for `--tug-color(red, 0, 0)` (intensity=0 + tone=0 = pure black) — verified by parser test
- `findTugColorCalls("--tug-color(red")` emits a warning about unmatched paren — verified by parser test
- All `TugColorError` objects have both `pos` and `end` fields — verified by type check in tests
- Slot assignment uses a dispatch table (no duplicated if/else for color/intensity/tone/alpha) — verified by code inspection
- `parseTugColor("red, bad, 50, 80")` reports error for `bad` AND successfully parses `50` and `80` — verified by parser test (error recovery)
- `bun test` passes end-to-end after all changes
- Achromatic strip visible in palette gallery with black, gray, white swatches

#### Scope {#scope}

1. Add `gray` as pseudo-hue to parser `KNOWN_HUES`, PostCSS plugin `expandTugColor`, and palette gallery
2. Tokenizer rewrite: uppercase normalization, CSS hex escape decoding (`\41` -> `a`), NBSP as whitespace
3. Better error for bare minus without number
4. Soft warnings system: `warnings` array on `ParseResult` ok:true branch
5. `findTugColorCalls` warns on unmatched parens
6. Source spans: `TugColorError` gains `end` field
7. Lookup-table dispatch for slot assignment
8. Error recovery: skip to next comma after bad token, report all problems in one pass

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding gray to `HUE_FAMILIES`, `ADJACENCY_RING`, `MAX_CHROMA_FOR_HUE`, or `DEFAULT_CANONICAL_L` — gray is a special case like black/white
- Full CSS specification compliance for the tokenizer — realistic coverage of common cases only
- Changes to the I/T/A axis semantics for chromatic hues
- New preset names or changes to preset values
- Changes to the theme derivation engine or `tug-base.css` token generation

#### Dependencies / Prerequisites {#dependencies}

- The 48-color hyphenated palette system (`tugplan-hyphenated-palette`) must be complete (gray builds on top of the existing ADJACENCY_RING + black/white vocabulary)
- `palette-engine.ts` exports `L_DARK`, `L_LIGHT`, `findMaxChroma`, `PEAK_C_SCALE` (already exported)

#### Constraints {#constraints}

- Gray always produces C=0 in oklch output regardless of intensity value — intensity is accepted syntactically but silently ignored
- Gray uses canonical L=0.5 for the tone formula, consistent with a perceptual midpoint
- The parser public API (`ParseResult`, `TugColorParsed`, `TugColorValue`) stays the same shape except: `TugColorError` gains `end` field, and `ParseResult` ok:true gains optional `warnings` array
- Parser internal rewrite must not affect callers — all changes are behind the existing `parseTugColor()` and `findTugColorCalls()` function signatures
- Warnings are non-breaking: `ok: true` with warnings is still a successful parse; PostCSS logs but does not fail

#### Assumptions {#assumptions}

- Gray will be handled as a special case in the parser and PostCSS plugin `expandTugColor`, parallel to black/white
- The "realistic coverage" tokenizer handles: a-z idents (already), A-Z normalized to lowercase, CSS hex escapes (`\41` through `\7a` for printable ASCII), and U+00A0 (NBSP) as whitespace
- CSS hex escapes are limited to 1-6 hex digit sequences following a backslash, per CSS spec subset
- Soft warnings include: intensity=0 + tone=0 producing pure black, intensity=0 + tone=100 producing pure white, intensity > 0 on achromatic keywords (black/white/gray where intensity is ignored)
- Error recovery skips tokens until the next comma, then resumes parsing the next argument group
- The achromatic gallery strip is a simple React component rendered in `gallery-palette-content.tsx`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the anchor and reference conventions defined in `tugplan-skeleton.md`. All headings that are cited use explicit `{#anchor}` suffixes. Steps cite decisions by `[DNN]`, specs by `Spec SNN`, tables by `Table TNN`, and section anchors by `#anchor`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions were resolved during the clarification phase:

- Gray canonical L: 0.5 (perceptual midpoint) — reflected in [D01]
- Suspicious value warnings: soft warnings with `ok: true` — reflected in [D04]
- CSS escapes/tokenizer: realistic coverage (uppercase, hex escapes, NBSP) — reflected in [D02]
- Gallery achromatics: separate achromatic strip — reflected in [D06]

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Parser rewrite introduces regressions for existing valid inputs | high | med | Comprehensive existing test suite runs before and after rewrite; all existing tests must pass | Any existing parser test fails |
| Source span changes break downstream consumers of TugColorError | med | low | `end` field is additive; `pos` field unchanged; existing code that reads `pos` is unaffected | TypeScript compilation error in consuming code |
| Error recovery masks real errors by continuing past bad tokens | med | low | Recovery only skips within an argument group (to next comma); all skipped tokens generate errors | User reports confusing error output |
| CSS hex escape decoding edge cases | low | low | Limited to 1-6 hex digits per CSS spec; only ASCII printable range decoded; out-of-range produces error | Unexpected ident from hex escape |

**Risk R01: Parser regression during rewrite** {#r01-parser-regression}

- **Risk:** The comprehensive tokenizer rewrite introduces subtle regressions for valid inputs that are not caught by the existing test suite.
- **Mitigation:** Run the full existing test suite as a checkpoint before beginning the rewrite. Add new tests for each audit item incrementally. The rewrite proceeds in small committed steps, not a single big-bang change.
- **Residual risk:** Edge cases in real-world CSS files that the test suite does not cover.

**Risk R02: Warnings noise in build output** {#r02-warnings-noise}

- **Risk:** Soft warnings for suspicious values generate excessive noise in PostCSS build output, annoying developers.
- **Mitigation:** Warnings are limited to a small set of well-defined suspicious patterns (intensity=0+tone=0, intensity=0+tone=100, intensity>0 on achromatics). PostCSS logs each warning once per declaration, not per call.
- **Residual risk:** Projects with many achromatic uses may see more warnings than expected.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Gray uses canonical L=0.5 and always produces C=0 (DECIDED) {#d01-gray-canonical}

**Decision:** Gray is an achromatic pseudo-hue with canonical L=0.5. It participates in the standard tone formula (piecewise L_DARK/canonical/L_LIGHT) but always produces chroma=0. Intensity is accepted syntactically but silently ignored.

**Rationale:**
- L=0.5 is the perceptual midpoint between L_DARK (0.15) and L_LIGHT (0.96) in the OKLCH lightness scale
- Unlike black (L=0) and white (L=1) which are fixed-L keywords, gray participates in the tone formula so designers can control lightness via tone
- C=0 is the defining property of achromatic colors — gray should never produce chroma regardless of intensity

**Implications:**
- `expandTugColor` in `postcss-tug-color.ts` gets a `gray` branch parallel to black/white but using the tone formula
- `KNOWN_HUES` in the PostCSS plugin gains `gray` alongside `black` and `white`
- Parser tests must verify that intensity is accepted but does not affect output for gray

#### [D02] Tokenizer handles uppercase, CSS hex escapes, and NBSP (DECIDED) {#d02-tokenizer-coverage}

**Decision:** The tokenizer normalizes A-Z to lowercase, decodes CSS hex escape sequences (`\41` = `A` = `a`), and treats U+00A0 (NBSP) as whitespace. This is realistic coverage, not full CSS spec compliance.

**Rationale:**
- Uppercase input is the most common real-world mistake — normalizing silently prevents confusion
- CSS hex escapes appear when CSS is processed by other tools or copy-pasted from specifications
- NBSP appears when copying from web pages or rich-text editors and is visually indistinguishable from a regular space

**Implications:**
- The `tokenize()` function is rewritten to handle these three cases
- Hex escape decoding: backslash followed by 1-6 hex digits, optional trailing space consumed; decoded codepoint becomes part of an ident token
- Character-by-character scanning loop must check for uppercase letters and NBSP in the whitespace/ident branches

#### [D03] Bare minus without number produces a context-appropriate error (DECIDED) {#d03-bare-minus-error}

**Decision:** A minus token not followed by a number token produces a clear, context-appropriate error. In numeric slots (intensity/tone/alpha), the message is `"Bare '-' without a number for <slotName>"` because a bare minus there is a numeric typo. In the color slot (where minus is part of hyphenated adjacency), the message hints at the adjacency syntax: `"Expected a color or preset name after '<name>-'"` (this already exists in `parseColorTokens`).

**Rationale:**
- In numeric slots, the most common cause is a typo like `--tug-color(red, -, 50)` — the user forgot the number
- In the color slot, the most common cause is a typo in hyphenated adjacency syntax (e.g., `cobalt- indigo` with a space)
- Context-appropriate messages avoid misleading the user about what went wrong

**Implications:**
- `parseNumericTokens` detects bare minus and produces a slot-specific error message
- The existing color-slot bare minus handling in `parseColorTokens` is already correct and unchanged

#### [D04] Soft warnings on ok:true branch for suspicious values (DECIDED) {#d04-soft-warnings}

**Decision:** `ParseResult` gains an optional `warnings: TugColorWarning[]` field on the `ok: true` branch. Warnings are emitted for suspicious-but-valid values. PostCSS logs warnings but does not fail the build.

**Rationale:**
- intensity=0 + tone=0 produces pure black for any hue — almost certainly unintentional
- intensity=0 + tone=100 produces pure white for any hue — almost certainly unintentional
- intensity > 0 on black/white/gray is silently ignored — worth flagging
- These should not break builds because the values are technically valid

**Implications:**
- New `TugColorWarning` type: `{ message: string; pos: number; end: number }`
- `ParseResult` ok:true branch: `{ ok: true; value: TugColorParsed; warnings?: TugColorWarning[] }`
- PostCSS plugin calls `console.warn()` for each warning, prefixed with source location
- Parser emits warnings after successful parse, checking the final resolved values

#### [D05] Source spans replace single pos in TugColorError (DECIDED) {#d05-source-spans}

**Decision:** `TugColorError` gains a mandatory `end: number` field, making errors carry start+end positions (source spans) instead of a single `pos` integer.

**Rationale:**
- Source spans enable better error underlining in IDE integrations and build output
- The `pos` field is preserved (renamed semantically to "start") so existing code that reads `pos` is unaffected
- Warnings use the same span format for consistency

**Implications:**
- `TugColorError` type: `{ message: string; pos: number; end: number }`
- All error-producing code paths must compute both start and end positions
- End position is typically `pos + token.value.length` for single-token errors, or the end of the last token in a multi-token error

#### [D06] Achromatic gallery strip separate from TugHueStrip (DECIDED) {#d06-achromatic-strip}

**Decision:** A small achromatic strip showing black, gray, and white swatches is rendered as a separate component above or below the 48-hue TugHueStrip in the palette gallery. It does not modify TugHueStrip itself.

**Rationale:**
- Black, gray, and white are not part of the adjacency ring — mixing them into TugHueStrip would break the ring metaphor
- A separate strip keeps the achromatic keywords visually distinct and semantically correct
- The strip is simple: three swatches with tone variations

**Implications:**
- New `TugAchromaticStrip` component in `gallery-palette-content.tsx` (or extracted to its own file)
- Uses `expandTugColor` logic directly (black=oklch(0 0 0), gray=tone formula, white=oklch(1 0 0))
- Rendered in `gallery-palette-content.tsx` adjacent to TugHueStrip

#### [D07] Lookup-table dispatch for slot assignment (DECIDED) {#d07-lookup-dispatch}

**Decision:** The duplicated if/else chains for slot assignment (`if (slot === "color") ... else if (slot === "intensity") ... else if (slot === "tone") ... else ...`) are replaced by a dispatch table mapping slot names to parser functions.

**Rationale:**
- The current code has two identical if/else chains (one for labeled args, one for positional args) that must be kept in sync
- A dispatch table is a single source of truth, reduces code duplication, and is easier to extend

**Implications:**
- Internal refactor only — no public API change
- Dispatch table maps `"color" | "intensity" | "tone" | "alpha"` to parser functions
- Both labeled and positional code paths use the same dispatch table

#### [D08] Error recovery improves within-group and tokenizer-level error handling (DECIDED) {#d08-error-recovery}

**Decision:** Error recovery targets two specific weaknesses: (1) tokenizer-level errors (e.g., unexpected characters) currently abort tokenization entirely, losing all subsequent tokens; the rewritten tokenizer skips the bad character, emits an error, and continues producing tokens for the rest of the input. (2) Within an argument group, a bad token (e.g., an ident where a number is expected) currently cascades into confusing downstream errors; recovery marks the slot as "attempted but failed" and moves on cleanly.

**Rationale:**
- The current parser already collects errors across comma-separated argument groups — that part works correctly
- The tokenizer is the weak link: a single bad character aborts all tokenization, so no argument groups after the bad character are even attempted
- Within-group cascading (e.g., a type mismatch in intensity cascading into "missing tone" and "missing alpha" false positives) is the other pain point
- Recovery at both levels means all real problems are reported in one pass without cascading noise

**Implications:**
- The `tokenize()` function skips unrecognized characters with an error instead of returning early
- Argument group parsing marks failed slots as "attempted" to suppress false "missing required" errors
- The existing multi-group error collection loop is preserved unchanged

---

### Specification {#specification}

#### Gray Pseudo-Hue Semantics {#gray-semantics}

**Spec S01: Gray expansion rules** {#s01-gray-expansion}

Gray is an achromatic pseudo-hue that produces C=0 at all times. Unlike black (fixed L=0) and white (fixed L=1), gray participates in the standard tone formula:

```
L = L_DARK + min(tone, 50) * (0.5 - L_DARK) / 50
          + max(tone - 50, 0) * (L_LIGHT - 0.5) / 50
C = 0  (always, regardless of intensity)
h = 0  (arbitrary, since C=0)
```

Where canonical L = 0.5.

Examples:
- `--tug-color(gray)` → `oklch(0.5 0 0)` (tone=50: L = 0.15 + 50*(0.5-0.15)/50 = 0.5)
- `--tug-color(gray, t: 0)` → `oklch(0.15 0 0)` (tone=0, L=L_DARK)
- `--tug-color(gray, t: 100)` → `oklch(0.96 0 0)` (tone=100, L=L_LIGHT)
- `--tug-color(gray, i: 80, t: 50)` → `oklch(0.5 0 0)` (intensity ignored)
- `--tug-color(gray, t: 50, a: 50)` → `oklch(0.5 0 0 / 0.5)`

Gray does NOT support adjacency syntax (`gray-red` is an error) and does NOT support preset syntax (`gray-intense` is an error).

#### Tokenizer Specification {#tokenizer-spec}

**Spec S02: Tokenizer rewrite rules** {#s02-tokenizer-rules}

The rewritten tokenizer handles:

1. **Uppercase normalization**: Characters A-Z are normalized to a-z during ident scanning. `"Red"` tokenizes to ident `"red"`.

2. **CSS hex escape decoding**: A backslash `\` followed by 1-6 hex digits decodes to the corresponding Unicode codepoint. An optional single trailing space after the hex digits is consumed (per CSS spec). The decoded character joins the current ident token. Examples:
   - `\41` → `A` → normalized to `a`
   - `\72 ed` → `r` + `ed` → ident `"red"`
   - `\20` → space (U+0020) → treated as whitespace, ends current ident

3. **NBSP as whitespace**: U+00A0 (non-breaking space) is treated identically to U+0020 (space) in the whitespace-skipping loop.

4. **Existing behavior preserved**: All lowercase a-z ident scanning, 0-9/. number scanning, comma, colon, minus, and the `+` error message are unchanged.

**Spec S03: Source span format** {#s03-source-spans}

```typescript
export interface TugColorError {
  message: string;
  pos: number;   // start position (0-indexed byte offset in input)
  end: number;   // end position (exclusive, 0-indexed byte offset)
}

export interface TugColorWarning {
  message: string;
  pos: number;   // start position
  end: number;   // end position
}
```

The `end` field points one past the last character of the problematic span. For single-character errors, `end = pos + 1`.

#### Warnings Specification {#warnings-spec}

**Spec S04: Soft warning conditions** {#s04-warning-conditions}

Warnings are emitted after a successful parse (`ok: true`) when the **final resolved values** (after applying defaults and preset overrides) match suspicious patterns. The check runs against the fully resolved `intensity`, `tone`, and `color.name` — not the raw input tokens. All suspicious-value warnings span the full input range (`pos=0`, `end=input.length`) because they concern the combined effect of multiple arguments, not a single token.

**Explicit vs. defaulted values:** The achromatic intensity warnings (rows 3-5 below) only fire when the user **explicitly provided** an intensity value. Bare `--tug-color(black)` uses the default intensity=50 and must NOT trigger a warning. The parser tracks which slots were explicitly set via its existing `attempted` Set and passes this information to the warning checker.

| Condition | Warning message |
|-----------|----------------|
| intensity=0 AND tone=0 (non-achromatic hue) | `"intensity=0 and tone=0 produce pure black; did you mean to use 'black'?"` |
| intensity=0 AND tone=100 (non-achromatic hue) | `"intensity=0 and tone=100 produce pure white; did you mean to use 'white'?"` |
| **explicitly provided** intensity > 0 on black | `"intensity is ignored for 'black' (always oklch(0 0 0))"` |
| **explicitly provided** intensity > 0 on white | `"intensity is ignored for 'white' (always oklch(1 0 0))"` |
| **explicitly provided** intensity > 0 on gray | `"intensity is ignored for 'gray' (always C=0)"` |

**Table T01: ParseResult type with warnings** {#t01-parse-result}

```typescript
export type ParseResult =
  | { ok: true; value: TugColorParsed; warnings?: TugColorWarning[] }
  | { ok: false; errors: TugColorError[] };
```

#### Error Recovery Specification {#error-recovery-spec}

**Spec S05: Error recovery rules** {#s05-error-recovery}

Recovery targets two levels:

**Tokenizer level:**
1. When `tokenize()` encounters an unrecognized character (including `+`), it records an error for that character, skips it, and continues scanning from the next position. The `+` character retains its helpful error message about hue offset removal but no longer aborts tokenization.
2. The tokenizer returns a `TokenizeResult` instead of `Token[] | TugColorError`:

```typescript
interface TokenizeResult {
  tokens: Token[];
  errors: TugColorError[];
}
```

3. `parseTugColor` consumes `TokenizeResult`, merging any tokenizer errors into the parser's error array before proceeding with argument parsing.

**Parser level (within argument groups):**
4. When parsing an argument group fails (type mismatch, bad value), the parser records the error and marks the slot as "attempted but failed".
5. Slots marked as "attempted but failed" do NOT trigger "missing required argument" errors.
6. The existing multi-group error collection (across comma boundaries) is preserved unchanged — it already works correctly.
7. At the end, if any errors were recorded, the result is `ok: false` with all accumulated errors.

#### findTugColorCalls Warning Specification {#find-calls-warning-spec}

**Spec S06: Unmatched paren warning in findTugColorCalls** {#s06-unmatched-paren}

`findTugColorCalls` currently silently skips unmatched parens. The updated version returns a result object:

```typescript
export interface FindCallsResult {
  calls: TugColorCallSpan[];
  warnings: TugColorWarning[];
}
```

When an unmatched `--tug-color(` is found (depth never reaches 0), a warning is added:
- message: `"Unmatched parenthesis in --tug-color() call"`
- pos: start index of `--tug-color(`
- end: end of input (or a reasonable span)

For backward compatibility, `findTugColorCalls` continues to return `TugColorCallSpan[]` directly. A new `findTugColorCallsWithWarnings` function returns `FindCallsResult`. The PostCSS plugin switches to `findTugColorCallsWithWarnings` and logs any warnings.

#### Lookup Table Dispatch {#dispatch-table-spec}

**Spec S07: Slot dispatch table** {#s07-dispatch-table}

```typescript
type SlotParser = (
  tokens: Token[],
  errors: TugColorError[],
  knownHues: ReadonlySet<string>,
  knownPresets?: ReadonlyMap<string, { intensity: number; tone: number }>,
  adjacencyRing?: readonly string[],
) => { slot: string; value: TugColorValue | number | null };

const SLOT_DISPATCH: Record<string, SlotParser> = {
  color: (tokens, errors, knownHues, knownPresets, adjacencyRing) => ({
    slot: "color",
    value: parseColorTokens(tokens, knownHues, errors, knownPresets, adjacencyRing),
  }),
  intensity: (tokens, errors) => ({
    slot: "intensity",
    value: parseNumericTokens(tokens, "intensity", errors),
  }),
  tone: (tokens, errors) => ({
    slot: "tone",
    value: parseNumericTokens(tokens, "tone", errors),
  }),
  alpha: (tokens, errors) => ({
    slot: "alpha",
    value: parseNumericTokens(tokens, "alpha", errors),
  }),
};
```

Both labeled and positional parsing paths use `SLOT_DISPATCH[slotName]` instead of if/else chains.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| (none) | All changes are in existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugColorWarning` | interface | `tug-color-parser.ts` | `{ message: string; pos: number; end: number }` |
| `TugColorError.end` | field | `tug-color-parser.ts` | New mandatory `end: number` field |
| `ParseResult` (ok:true) | type | `tug-color-parser.ts` | Gains optional `warnings?: TugColorWarning[]` |
| `FindCallsResult` | interface | `tug-color-parser.ts` | `{ calls: TugColorCallSpan[]; warnings: TugColorWarning[] }` |
| `findTugColorCallsWithWarnings` | function | `tug-color-parser.ts` | Returns `FindCallsResult` |
| `SLOT_DISPATCH` | const | `tug-color-parser.ts` | Dispatch table for slot assignment |
| `TokenizeResult` | interface | `tug-color-parser.ts` | `{ tokens: Token[]; errors: TugColorError[] }` — replaces `Token[] \| TugColorError` return |
| `tokenize` (rewrite) | function | `tug-color-parser.ts` | Uppercase, hex escapes, NBSP; returns `TokenizeResult` |
| `KNOWN_HUES` (update) | const | `postcss-tug-color.ts` | Add `"gray"` to the set |
| `expandTugColor` (update) | function | `postcss-tug-color.ts` | Add gray branch with tone formula |
| `TugAchromaticStrip` | component | `gallery-palette-content.tsx` | Black/gray/white swatch strip |

---

### Documentation Plan {#documentation-plan}

- [ ] Update JSDoc comments on `parseTugColor`, `TugColorError`, `ParseResult`, and `findTugColorCalls` to reflect new fields and behavior
- [ ] Update module-level comment in `tug-color-parser.ts` to mention gray, warnings, and source spans
- [ ] Update module-level comment in `postcss-tug-color.ts` to mention gray as a supported achromatic keyword

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual parser functions (tokenizer, parseColorTokens, parseNumericTokens) | Tokenizer rewrite, gray parsing, error recovery |
| **Integration** | Test PostCSS plugin end-to-end (CSS input → expanded output) | Gray expansion, warning logging |
| **Golden / Contract** | Compare parsed output against known-good values | Gray at various tone/intensity combinations, existing hue round-trips |
| **Drift Prevention** | Existing parser tests must continue to pass | All audit items — run existing suite before and after each step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Baseline — verify all existing tests pass {#step-1}

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #constraints)

**Artifacts:**
- No file changes — verification only

**Tasks:**
- [ ] Run `cd tugdeck && bun test` and verify all tests pass
- [ ] Record the number of existing parser tests for later comparison

**Tests:**
- [ ] T-BASELINE-PASS: `bun test` exits with code 0 and all parser/PostCSS test suites report green

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 2: Add gray pseudo-hue to parser and PostCSS plugin {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add gray as achromatic pseudo-hue in tug-color parser and PostCSS plugin`

**References:** [D01] Gray canonical L, Spec S01 (#gray-semantics, #s01-gray-expansion, #constraints)

**Artifacts:**
- Modified `tug-color-parser.ts` — no parser changes needed (gray is just a new known hue name)
- Modified `postcss-tug-color.ts` — add `"gray"` to `KNOWN_HUES`, add gray branch in `expandTugColor`

**Tasks:**
- [ ] Add `"gray"` to the `KNOWN_HUES` set in `postcss-tug-color.ts` (alongside `"black"` and `"white"`)
- [ ] Add gray branch in `expandTugColor`: if `color.name === "gray"`, compute L via the tone formula with canonical L=0.5, C=0, h=0
- [ ] Gray should NOT support adjacency (gray is not in ADJACENCY_RING — the parser will reject `gray-red` because gray is not in the ring)
- [ ] Gray should NOT support presets (gray is not in PRESET_NAMES — `gray-intense` will correctly parse as adjacency attempt and fail because gray is not in the ring)

**Tests:**
- [ ] T-GRAY-DEFAULT: `parseTugColor("gray", KNOWN_HUES_WITH_GRAY)` succeeds with color.name="gray", i=50, t=50, a=100
- [ ] T-GRAY-TONE: PostCSS expands `--tug-color(gray, t: 0)` to `oklch(0.15 0 0)` (L_DARK)
- [ ] T-GRAY-TONE-100: PostCSS expands `--tug-color(gray, t: 100)` to `oklch(0.96 0 0)` (L_LIGHT)
- [ ] T-GRAY-INTENSITY-IGNORED: PostCSS expands `--tug-color(gray, i: 80, t: 50)` to same as `--tug-color(gray, t: 50)` (C=0 regardless)
- [ ] T-GRAY-ALPHA: PostCSS expands `--tug-color(gray, t: 50, a: 50)` with alpha suffix
- [ ] T-GRAY-ADJACENCY-ERROR: `parseTugColor("gray-red", KNOWN_HUES_WITH_GRAY, ..., ADJACENCY_RING)` fails (gray not in ring)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 3: Add source spans to TugColorError {#step-3}

**Depends on:** #step-2

**Commit:** `feat: add source spans (pos+end) to TugColorError for better error locations`

**References:** [D05] Source spans, Spec S03 (#s03-source-spans, #constraints)

**Artifacts:**
- Modified `tug-color-parser.ts` — `TugColorError` gains `end` field, all error-producing paths updated

**Tasks:**
- [ ] Add `end: number` to Token interface (computed as `pos + value.length` during tokenization) — this must land first since subsequent error span computations reference `token.end`
- [ ] Add `end: number` to `TugColorError` interface
- [ ] Update all `return { message, pos }` error returns in `tokenize()` to include `end` (typically `pos + 1` for single-char errors)
- [ ] Update all `errors.push()` calls in `parseColorTokens()` to include `end` based on `token.end`
- [ ] Update all `errors.push()` calls in `parseNumericTokens()` to include `end` based on `token.end`
- [ ] Update all `errors.push()` calls in `parseTugColor()` main loop to include `end`
- [ ] Update existing tests to check for `end` field presence (add `.toHaveProperty("end")` checks)

**Tests:**
- [ ] T-SPAN-SINGLE: Error for unknown color at pos=0 has end=length of the unknown ident
- [ ] T-SPAN-RANGE: Error for out-of-range number `-5` has pos at minus and end after the `5`
- [ ] T-SPAN-ALL-ERRORS: Every error object in any test case has both `pos` and `end` fields

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 4: Tokenizer rewrite — uppercase, hex escapes, NBSP {#step-4}

**Depends on:** #step-3

**Commit:** `feat: rewrite tokenizer with uppercase normalization, CSS hex escapes, NBSP handling`

**References:** [D02] Tokenizer coverage, Spec S02 (#s02-tokenizer-rules, #tokenizer-spec)

**Artifacts:**
- Modified `tug-color-parser.ts` — `tokenize()` function rewritten

**Tasks:**
- [ ] Extend the ident scanning branch to accept A-Z, normalizing to lowercase (`ch.toLowerCase()`)
- [ ] Add backslash handling: consume 1-6 hex digits, decode to codepoint, optionally consume one trailing space; if decoded char is a letter, normalize to lowercase and append to current ident; if not a valid ident char, handle appropriately
- [ ] Add U+00A0 to the whitespace check (`ch === "\u00A0"`)
- [ ] Preserve all existing token types and behavior for lowercase idents, numbers, comma, colon, minus, plus-error (Token already carries `end` from Step 3)

**Tests:**
- [ ] T-UPPER: `parseTugColor("Red")` succeeds with color.name="red"
- [ ] T-UPPER-MIXED: `parseTugColor("Cobalt-Indigo")` succeeds with adjacency
- [ ] T-HEX-ESCAPE: `parseTugColor("\\72 ed")` succeeds with color.name="red" (hex 72 = 'r')
- [ ] T-HEX-ESCAPE-UPPER: `parseTugColor("\\52 ed")` succeeds with color.name="red" (hex 52 = 'R' → 'r')
- [ ] T-NBSP: `parseTugColor("red,\u00A050")` succeeds (NBSP between comma and number)
- [ ] T-HEX-SINGLE: `parseTugColor("\\41")` tokenizes to ident "a" (hex 41 = 'A' → 'a')

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 5: Better error for bare minus without number {#step-5}

**Depends on:** #step-4

**Commit:** `feat: improve error message for bare minus without number in tug-color parser`

**References:** [D03] Bare minus error (#d03-bare-minus-error)

**Artifacts:**
- Modified `tug-color-parser.ts` — `parseNumericTokens()` updated

**Tasks:**
- [ ] In `parseNumericTokens`, detect the case where tokens start with a minus but the next token is not a number (or there is no next token)
- [ ] Produce slot-specific error: `"Bare '-' without a number for intensity"` (or tone/alpha as appropriate)
- [ ] Include source span (pos of minus, end of minus or next token)
- [ ] Leave color-slot bare minus handling unchanged (already handled by `parseColorTokens` with adjacency-appropriate message)

**Tests:**
- [ ] T-BARE-MINUS: `parseTugColor("red, -, 50")` produces error mentioning "bare" and "intensity" (numeric slot context)
- [ ] T-BARE-MINUS-END: `parseTugColor("red, -")` produces error for bare minus mentioning "intensity"
- [ ] T-BARE-MINUS-TONE: `parseTugColor("red, 50, -")` produces error mentioning "tone" (correct slot name)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 6: Soft warnings system {#step-6}

**Depends on:** #step-5

**Commit:** `feat: add soft warnings for suspicious tug-color values`

**References:** [D04] Soft warnings, Spec S04, Table T01 (#s04-warning-conditions, #t01-parse-result, #warnings-spec)

**Artifacts:**
- Modified `tug-color-parser.ts` — `TugColorWarning` type, warnings array in `ParseResult`, warning detection logic
- Modified `postcss-tug-color.ts` — log warnings from parse results

**Tasks:**
- [ ] Define `TugColorWarning` interface: `{ message: string; pos: number; end: number }`
- [ ] Update `ParseResult` ok:true branch to include optional `warnings?: TugColorWarning[]`
- [ ] Pass the `attempted` Set (which tracks explicitly provided slots) to the warning checker so achromatic intensity warnings only fire when intensity was explicitly set
- [ ] After successful parse in `parseTugColor`, check for suspicious value patterns per Spec S04 and build warnings array
- [ ] Only attach `warnings` field if array is non-empty
- [ ] In PostCSS plugin Declaration handler, check for `parseResult.warnings` on ok:true results and `console.warn()` each one

**Tests:**
- [ ] T-WARN-PURE-BLACK: `parseTugColor("red, 0, 0")` returns ok:true with warning about pure black
- [ ] T-WARN-PURE-WHITE: `parseTugColor("red, 0, 100")` returns ok:true with warning about pure white
- [ ] T-WARN-BLACK-EXPLICIT-INTENSITY: `parseTugColor("black, 50")` returns ok:true with warning about intensity ignored (intensity explicitly provided)
- [ ] T-WARN-WHITE-EXPLICIT-INTENSITY: `parseTugColor("white, 50")` returns ok:true with warning about intensity ignored (intensity explicitly provided)
- [ ] T-WARN-GRAY-EXPLICIT-INTENSITY: `parseTugColor("gray, 50")` returns ok:true with warning about intensity ignored for gray (intensity explicitly provided)
- [ ] T-WARN-BLACK-DEFAULT-NO-WARN: `parseTugColor("black")` returns ok:true with NO warnings (intensity=50 is defaulted, not explicit)
- [ ] T-WARN-WHITE-DEFAULT-NO-WARN: `parseTugColor("white")` returns ok:true with NO warnings (intensity=50 is defaulted, not explicit)
- [ ] T-WARN-GRAY-DEFAULT-NO-WARN: `parseTugColor("gray")` returns ok:true with NO warnings (intensity=50 is defaulted, not explicit)
- [ ] T-WARN-NO-FALSE-POSITIVE: `parseTugColor("red, 50, 50")` returns ok:true with no warnings
- [ ] T-WARN-FIELD-SHAPE: Warning objects have `message`, `pos`, and `end` fields

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 7: findTugColorCalls warns on unmatched parens {#step-7}

**Depends on:** #step-6

**Commit:** `feat: add findTugColorCallsWithWarnings for unmatched paren detection`

**References:** [D04] Soft warnings, Spec S06 (#s06-unmatched-paren, #find-calls-warning-spec)

**Artifacts:**
- Modified `tug-color-parser.ts` — new `findTugColorCallsWithWarnings` function, `FindCallsResult` type
- Modified `postcss-tug-color.ts` — switch to `findTugColorCallsWithWarnings` and log warnings

**Tasks:**
- [ ] Define `FindCallsResult` interface
- [ ] Implement `findTugColorCallsWithWarnings` that returns `{ calls, warnings }` — when depth > 0 after scanning to end, push a warning
- [ ] Keep `findTugColorCalls` unchanged for backward compatibility (it delegates to `findTugColorCallsWithWarnings` and returns only `.calls`)
- [ ] Update PostCSS plugin to use `findTugColorCallsWithWarnings` and log warnings

**Tests:**
- [ ] T-UNMATCHED-PAREN: `findTugColorCallsWithWarnings("--tug-color(red")` returns empty calls and one warning
- [ ] T-MATCHED-PAREN: `findTugColorCallsWithWarnings("--tug-color(red)")` returns one call and no warnings
- [ ] T-BACKWARD-COMPAT: `findTugColorCalls("--tug-color(red)")` still returns `TugColorCallSpan[]`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 8: Lookup-table dispatch for slot assignment {#step-8}

**Depends on:** #step-7

**Commit:** `refactor: replace if/else slot assignment chains with dispatch table`

**References:** [D07] Lookup dispatch, Spec S07 (#s07-dispatch-table, #dispatch-table-spec)

**Artifacts:**
- Modified `tug-color-parser.ts` — `SLOT_DISPATCH` table, refactored `parseTugColor` main loop

**Tasks:**
- [ ] Define `SLOT_DISPATCH` record mapping slot names to parser functions
- [ ] Replace both labeled and positional if/else chains in `parseTugColor` with `SLOT_DISPATCH[slotName](...)` calls
- [ ] Verify no behavior change by running full test suite

**Tests:**
- [ ] No new tests needed — this is a pure internal refactor. All existing tests verify behavior is preserved.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 9: Error recovery — report all problems in one pass {#step-9}

**Depends on:** #step-8

**Commit:** `feat: add error recovery to tug-color parser for multi-error reporting`

**References:** [D08] Error recovery, Spec S05 (#s05-error-recovery, #error-recovery-spec)

**Artifacts:**
- Modified `tug-color-parser.ts` — tokenizer error recovery and within-group slot failure tracking

**Tasks:**
- [ ] Change `tokenize()` return type from `Token[] | TugColorError` to `TokenizeResult` (`{ tokens: Token[]; errors: TugColorError[] }`) — skip unrecognized characters with an error instead of returning early
- [ ] Make `+` recoverable: record the helpful "hue offsets removed" error, skip the `+` character, and continue tokenizing (instead of aborting)
- [ ] Update `parseTugColor()` to consume `TokenizeResult`: merge tokenizer errors into the parser's error array, then proceed with argument parsing using the token array
- [ ] In the main parser loop, mark slots as "attempted but failed" when a within-group parse error occurs (e.g., ident where number expected), preventing false "missing required" errors for those slots
- [ ] Preserve existing multi-group error collection behavior (already works correctly across comma boundaries)
- [ ] Verify that single-error cases still produce the same errors as before

**Tests:**
- [ ] T-RECOVER-TOKENIZER: Input with a bad character mid-stream (e.g., `"red, 50, @, 80"`) reports error for `@` AND parses surrounding args
- [ ] T-RECOVER-PLUS: `parseTugColor("red+5, 50")` reports `+` error AND still parses `50` for intensity (no longer aborts)
- [ ] T-RECOVER-NO-MISSING: `parseTugColor("red, bad")` reports error for `bad` but NOT "missing tone" or "missing alpha" (slot marked as attempted)
- [ ] T-RECOVER-MULTI-GROUP: `parseTugColor("unknown, bad, -, zz")` reports errors for each group (existing behavior preserved)
- [ ] T-RECOVER-SINGLE: `parseTugColor("unknown")` still produces a single "Unknown color" error (no regression)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 10: Achromatic strip in palette gallery {#step-10}

**Depends on:** #step-2

**Commit:** `feat: add achromatic swatch strip (black/gray/white) to palette gallery`

**References:** [D06] Achromatic strip (#d06-achromatic-strip, #gray-semantics)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-palette-content.tsx` — new `TugAchromaticStrip` component
- Modified `src/components/tugways/cards/gallery-palette-content.css` — styles for achromatic strip

**Tasks:**
- [ ] Create `TugAchromaticStrip` component that renders three swatches: black (oklch(0 0 0)), gray at tone=50 (oklch(0.5 0 0)), white (oklch(1 0 0))
- [ ] Each swatch shows the color name and oklch value on hover/title
- [ ] Add CSS styles for the strip: inline layout, consistent swatch size with TugHueStrip swatches
- [ ] Render `TugAchromaticStrip` above or below the `TugHueStrip` in the palette gallery
- [ ] Optionally: show tone variations for gray (e.g., tone=20, 40, 50, 60, 80) as sub-swatches

**Tests:**
- [ ] T-ACHROMATIC-RENDER: Gallery palette content renders achromatic strip with data-testid="tug-achromatic-strip"
- [ ] T-ACHROMATIC-THREE: Achromatic strip contains exactly 3 primary swatches (black, gray, white)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 11: Final Integration Checkpoint {#step-11}

**Depends on:** #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** [D01] Gray canonical L, [D02] Tokenizer coverage, [D04] Soft warnings, [D05] Source spans, [D08] Error recovery (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria from Phase Overview are met
- [ ] Run full test suite end-to-end
- [ ] Verify gray expansion produces correct oklch values at tone=0, 50, 100
- [ ] Verify uppercase input is normalized in end-to-end PostCSS expansion
- [ ] Verify soft warnings appear in PostCSS console output for suspicious values
- [ ] Verify achromatic strip renders in gallery

**Tests:**
- [ ] T-INTEGRATION-ALL: `bun test` exits with code 0, covering all parser, PostCSS, and gallery test suites

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Gray pseudo-hue fully functional in --tug-color() notation with parser comprehensively rewritten to handle uppercase, CSS hex escapes, NBSP, soft warnings, source spans, lookup dispatch, and error recovery.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `--tug-color(gray, t: 50)` expands to correct oklch value with C=0 (`bun test` PostCSS suite)
- [ ] `parseTugColor("Gray")` succeeds (uppercase normalized) (`bun test` parser suite)
- [ ] All `TugColorError` objects carry both `pos` and `end` fields (`bun test` type checks)
- [ ] Soft warnings emitted for suspicious values without failing parse (`bun test` warning tests)
- [ ] `findTugColorCallsWithWarnings` warns on unmatched parens (`bun test`)
- [ ] Error recovery reports multiple errors in one pass (`bun test` recovery tests)
- [ ] Achromatic strip visible in palette gallery (`bun test` gallery tests)
- [ ] Full test suite passes: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

**Acceptance tests:**
- [ ] T-GRAY-DEFAULT, T-GRAY-TONE, T-GRAY-INTENSITY-IGNORED pass
- [ ] T-UPPER, T-HEX-ESCAPE, T-NBSP pass
- [ ] T-WARN-PURE-BLACK, T-WARN-GRAY-INTENSITY pass
- [ ] T-RECOVER-TOKENIZER, T-RECOVER-NO-MISSING, T-RECOVER-MULTI-GROUP, T-RECOVER-SINGLE pass
- [ ] T-ACHROMATIC-RENDER, T-ACHROMATIC-THREE pass

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add gray tone variations to `tug-palette.css` generation script (CSS custom properties for gray at various tones)
- [ ] Consider additional achromatic pseudo-hues (e.g., `warm-gray`, `cool-gray`) that have C > 0
- [ ] Extend tokenizer to handle CSS `url()` and string literals if --tug-color is ever used inside complex CSS functions
- [ ] IDE plugin for --tug-color() syntax highlighting and autocomplete with gray support

| Checkpoint | Verification |
|------------|--------------|
| Gray expansion correct | `bun test` PostCSS test suite (T-GRAY-*) |
| Tokenizer rewrite complete | `bun test` parser test suite (T-UPPER, T-HEX-*, T-NBSP) |
| Soft warnings functional | `bun test` warning tests (T-WARN-*) |
| Error recovery working | `bun test` recovery tests (T-RECOVER-*) |
| Full suite green | `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` |
