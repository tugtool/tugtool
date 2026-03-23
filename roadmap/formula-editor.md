# Formula Editor

## Problem Statement

When tuning theme recipes (`recipes/dark.ts`, `recipes/light.ts`), there is no
way to connect what you see on screen to the formula that produced it. You see a
color, but you don't know which formula field controls it, what its current
value is, or how changing it would affect other tokens. Editing requires
round-tripping between the browser, source code, and mental models of the rules
table.

The goal: hover any element, see exactly which formula fields produce its
colors, drag sliders to change those values, and have the changes write through
to the recipe source files on disk — live, with instant visual feedback.

## Architecture

Five parts, built in order. Each is independently useful.

### Part 1: Reverse Map — formula field → tokens

Build a static index that maps each `DerivationFormulas` field to the CSS
tokens it affects. This is the foundation everything else depends on.

**How it works:**

The rules table (`theme-rules.ts`) is a flat `Record<string, DerivationRule>`.
Each `ChromaticRule` has `intensityExpr`, `toneExpr`, and optional `alphaExpr`
— arrow functions that read from `DerivationFormulas`. These functions reference
formula fields like `formulas.roleIntensity` or `formulas.surfaceCanvasTone`.

To build the reverse map:

1. For each rule in RULES, extract the formula field references from each
   expression. Two approaches:
   - **Runtime introspection**: call each expression with a Proxy-wrapped
     DerivationFormulas that records which fields are accessed. This is the
     simplest and most accurate approach — no source parsing needed.
   - **Static analysis**: regex on source to extract `formulas.fieldName`
     references. Simpler but misses computed references.

2. Build `Map<formulaFieldName, Array<{token, property}>>` where `property`
   is "intensity", "tone", "alpha", or "hueSlot".

3. Also build the inverse: `Map<tokenName, Array<{field, property}>>` — given
   a token, which formula fields feed into it.

**The Proxy approach in detail:**

```typescript
function buildReverseMap(rules: Record<string, DerivationRule>): {
  fieldToTokens: Map<string, Array<{token: string, property: string}>>;
  tokenToFields: Map<string, Array<{field: string, property: string}>>;
} {
  const fieldToTokens = new Map();
  const tokenToFields = new Map();

  for (const [tokenName, rule] of Object.entries(rules)) {
    if (rule.type !== "chromatic") continue;

    for (const [property, expr] of [
      ["intensity", rule.intensityExpr],
      ["tone", rule.toneExpr],
      ["alpha", rule.alphaExpr],
    ]) {
      if (!expr) continue;
      const accessed: string[] = [];
      const proxy = new Proxy({} as DerivationFormulas, {
        get(_, field: string) {
          accessed.push(field);
          return 0; // dummy return
        },
      });
      try { expr(proxy); } catch { /* some exprs may fail with dummy values */ }

      for (const field of accessed) {
        // record field → token mapping
        // record token → field mapping
      }
    }
  }

  return { fieldToTokens, tokenToFields };
}
```

This runs once at dev-server startup. The map is static for a given rules
table — it doesn't depend on the recipe or spec values.

**Hue slot resolution:** Some tokens use formula-mediated hue slots (e.g.,
`hueSlot: "surfaceApp"` reads `formulas.surfaceAppHueSlot`). The Proxy
approach catches these too — the expression will access `surfaceAppHueSlot`
on the proxy.

**Constant expressions:** Some rules use `lit(50)` — a helper that returns a
constant function with no formula field reference. The Proxy will correctly
record no fields for these. The inspector should display them as
`tone = 50 (constant)` — visible but not editable. Editing constant
expressions requires changing the rules table, which is out of scope.

**Output:** Export the reverse map as a module that the inspector can import.
Generate it at dev-server startup alongside token generation, or compute it
lazily on first inspector activation.

### Part 2: Extend style inspector — show formula fields

Extend the existing style inspector overlay (`style-inspector-overlay.ts`) to
show formula provenance alongside the current token chain display.

**Current behavior:** Shift+Alt hover shows computed color → token chain →
palette variable → TugColor provenance.

**New behavior:** After the token chain, add a "Formula" section showing:

```
Formula: surfaceCanvasTone = 5
         surfaceCanvasIntensity = 2
         hueSlot = canvas → indigo-violet
```

The formula section shows which `DerivationFormulas` fields produced this
token's tone, intensity, alpha, and hue. Values are the current computed
values from the active recipe.

**Implementation:**

1. At inspector init (or on first activation), compute the reverse map from
   Part 1.
2. Also run the active recipe function to get the current `DerivationFormulas`
   values.
3. When inspecting an element, after resolving the token chain, look up the
   terminal token name in `tokenToFields`.
4. For each referenced formula field, show the field name and its current
   value from the formulas object.
5. Render as additional rows in the existing panel DOM structure.

**Where the active recipe comes from:** The dev server already knows the active
theme (from tugbank). It runs `deriveTheme()` via `activateThemeOverride` to
generate override CSS. Extend `ActivateResult` to include the
`DerivationFormulas` object and the active mode. Expose this data via a dev
endpoint (`GET /__themes/formulas`). The response includes:
- The `DerivationFormulas` field values
- The active theme's `mode` field (`"dark"` or `"light"`) — this determines
  which recipe file to edit (`src/components/tugways/recipes/dark.ts` or
  `src/components/tugways/recipes/light.ts`)
- The active theme name

The inspector fetches this once on activation and refreshes after each edit.
The mode-to-file mapping is automatic — the user never has to specify which
recipe file to target.

**Token chain → formula field resolution:** The formula section only appears
when the inspector's token chain resolves to a terminal token that exists in
the RULES table. If the chain stops at an intermediate component token (e.g.,
`--tug-card-bg`) that hasn't been walked to its RULES-level terminal, the
inspector must follow the `var()` chain down to the terminal before looking
up formula fields. The existing `resolveTokenChain` already does this — the
formula lookup uses the last hop in the chain.

### Part 3: Editable controls — sliders and number inputs

Replace the static formula field display (Part 2) with interactive controls.
Each numeric formula field gets a slider and number input. Dragging the slider
or typing a value sends the change to the server.

**Control types by formula field property:**

- **Tone fields** (0-100): slider + number input, step 1
- **Intensity fields** (0-100): slider + number input, step 1
- **Alpha fields** (0-1): slider + number input, step 0.01
- **Hue slot fields** (string): dropdown of available hue slot names

**Interaction model:**

1. User hovers element, sees formula fields with current values
2. User clicks a formula field → it becomes an editable slider/input
3. User drags slider → browser applies a temporary CSS override immediately
   (same technique the theme generator card uses for live preview — direct
   style injection, no file round-trip)
4. On drag-end (pointerup), the final value is sent to the server
5. Server writes the new value to the recipe file on disk
6. File watcher triggers token regeneration (~300ms)
7. HMR updates the CSS with the canonical generated values
8. Screen repaints — should match the preview since the same value was used

This two-phase approach (instant preview during drag, file write on release)
avoids the 300-500ms pipeline latency during continuous slider movement. The
temporary CSS override is discarded once HMR delivers the real update.

**Preview during drag uses `document.body.style.setProperty()`.** All `--tug-*`
tokens are declared on `body {}` selectors in the generated stylesheets. Inline
styles on `document.documentElement` would be overridden by the `body {}` rule
and have no visible effect. During drag, call
`document.body.style.setProperty(tokenName, newValue)` for each affected token.
On drag-end, call `document.body.style.removeProperty(tokenName)` to clear the
inline overrides — the HMR-delivered stylesheet update will supply the correct
values.

**Preview during drag uses delta approximation.** The browser does not re-run
`deriveTheme()` during drag — that would require shipping the full derivation
engine to the client. Instead, it adjusts affected CSS custom property values
by the delta. If the user drags tone from 5 to 8, the preview applies +3 to
the computed oklch lightness of all affected tokens. This is an approximation
(the actual derivation may apply clamping or nonlinear transforms) but is good
enough for visual feedback during drag. The file write on release produces the
exact correct values via the full pipeline.

**StructuralRule tokens skip drag preview.** Some tokens are governed by
`StructuralRule` entries in the rules table — these produce non-color CSS values
(e.g., border-radius, spacing) that cannot be approximated by delta adjustment
to oklch components. For formula fields that only affect StructuralRule tokens,
the slider control should display a "(applies on release)" indicator so the user
knows the visual update will come from the file pipeline, not from an instant
preview. The control still works — it just has ~300ms latency instead of being
frame-instant.

**High-fan-out fields** like `roleIntensity` affect 150+ tokens. The preview
must update all of them per frame during drag. This is feasible (setting CSS
custom properties on `document.body.style` is fast) but should be tested early
with a high-fan-out field to confirm performance.

**Implementation:**

- Controls are pure DOM (no React) — consistent with the existing inspector
  approach (Law L01).
- Each control stores: formula field name, current value.
- onChange sends a POST to the Vite middleware (Part 4).
- The `GET /__themes/formulas` endpoint returns formulas and mode in the
  `ActivateResult` — callers read from the return value rather than relying
  on module-level cache side effects. This keeps `activateThemeOverride`
  testable with mock fs. The endpoint handler calls `activateThemeOverride`,
  reads formulas and mode from the returned `ActivateResult`, and serves them.
- Incoming HMR updates refresh the formulas by re-fetching the endpoint,
  which updates all visible controls to their new values (handles cascading
  changes where one formula field affects others through the recipe logic).

**Pinned mode is the primary editing mode.** The tuning workflow is:

1. Shift+Alt hover to activate → see formula fields
2. Click to pin → panel stays open
3. Drag sliders to tune → live preview during drag, file write on release
4. Click a different element → panel updates to that element's formulas
5. Drag those sliders → live preview
6. Escape when done → panel dismissed, all changes are on disk

This requires a change to the current pin behavior. Today, clicking while
pinned unpins. In formula editor mode, clicking a different element while
pinned should re-inspect the new element (update the panel) instead of
unpinning. The close button and Escape dismiss the panel. This lets the user
pin once and click around the UI, tuning formula fields across different
elements in a single session without re-activating the inspector each time.

### Part 4: Write-back middleware — recipe file editing

A Vite plugin middleware endpoint that accepts formula field changes and writes
them to the recipe source files on disk.

**Endpoint:** `POST /__themes/formula`

**Request body:**
```json
{
  "field": "surfaceCanvasTone",
  "value": 8
}
```

The recipe file is not specified in the request — the server determines it
automatically from the active theme's `mode` field. If the active theme has
`mode: "dark"`, the server edits `src/components/tugways/recipes/dark.ts`. This means the inspector
never needs to know the file path — it just sends field + value.

**What it does:**

1. Read the active theme's mode from the cached ThemeSpec (same cache as
   `GET /__themes/formulas`). Map mode to recipe file:
   `"dark"` → `src/components/tugways/recipes/dark.ts`,
   `"light"` → `src/components/tugways/recipes/light.ts`.
2. Read the file.
3. Find the line that assigns the formula field. Recipe files use object
   literal return syntax — the return statement is a single object literal
   with one property per line. There are two patterns:

   **Expression properties** — field name, colon, value expression, comma:
   ```typescript
   surfaceCanvasTone: canvasTone,
   surfaceCanvasTone: canvasTone + 6,
   filledSurfaceHoverTone: Math.max(0, Math.min(100, spec.role.tone + 5)),
   ```
   Regex: `/^(\s*){fieldName}\s*:\s*(.+),\s*$/m`

   **Shorthand properties** — field name alone (value comes from a same-name
   local variable, e.g., `cardBodyTone,`):
   ```typescript
   cardBodyTone,
   cardBodyIntensity,
   ```
   Regex: `/^(\s*){fieldName}\s*,\s*$/m`

   The write-back must handle both patterns. For an expression property,
   replace the value between the colon and comma. For a shorthand property,
   expand it to the full `fieldName: newValue,` form.

4. Replace the value with the raw literal:
   `surfaceCanvasTone: 8,`

   This intentionally replaces computed expressions with literal values.
   When you're tuning by hand, you want direct control. If the formula was
   `canvasTone + 6` and you set it to 8, the line becomes
   `surfaceCanvasTone: 8,`. You can always restore the expression later by
   editing the source directly.

   **Raw literal only — no clamping.** The write-back writes the exact
   numeric value from the slider. It does not attempt to wrap the value in
   `Math.max`/`Math.min` or replicate any clamping logic from the original
   expression. The slider range itself constrains valid values (0-100 for
   tone/intensity, 0-1 for alpha). If the original expression had clamping,
   that clamping is lost — the user can restore it manually if needed.

5. Write the file back to disk.
6. The file watcher picks up the change → `generate:tokens` runs → HMR
   updates the CSS → screen repaints.

**Response:**
```json
{
  "ok": true,
  "file": "src/components/tugways/recipes/dark.ts",
  "field": "surfaceCanvasTone",
  "oldValue": "canvasTone",
  "newValue": "8"
}
```

The response includes the old expression so the inspector can show a
"changed from" indicator.

**Error handling:** If the regex doesn't find the field assignment, return
400 with a clear error. This means the recipe file has an unexpected format
— the user should edit it manually.

**Important:** This endpoint only exists in dev mode. It is never available
in production builds.

### Part 5: Diff and commit workflow

After a tuning session, the user switches to the terminal and sees the
recipe file changes as a normal git diff. They review, adjust if needed,
and commit.

**No special tooling needed for this part.** `git diff` shows exactly what
changed. The recipe files are clean TypeScript with one assignment per line
— diffs are readable.

**Optional enhancement:** A summary endpoint that returns all formula fields
that were changed in the current session, grouped by recipe file. The
inspector could show a "changes" badge with a count. But this is polish,
not essential.

## Scope and Ordering

| Part | What | Effort | Dependencies |
|------|------|--------|-------------|
| 1 | Reverse map (formula field ↔ token) | Medium | theme-rules.ts, DerivationFormulas |
| 2 | Inspector shows formula fields | Small | Part 1, style-inspector-overlay.ts |
| 3 | Editable slider/input controls | Medium | Part 2 |
| 4 | Write-back middleware | Small | Part 3, vite.config.ts |
| 5 | Diff/commit workflow | None | Git (already works) |

Parts 1-2 are independently useful — even without editing, seeing which
formula fields produce a token is valuable for understanding the system.

Parts 3-4 are the live editing experience.

Part 5 is free — it's just git.

## Key Design Decisions

**Proxy-based reverse map, not source parsing.** Runtime introspection with
Proxy is simpler, more accurate, and doesn't require parsing TypeScript. It
catches computed expressions that static analysis would miss.

**Literal replacement, not expression editing.** When the user drags a slider,
the formula becomes a literal number. This is intentional — live tuning is
about finding the right value, not writing the right expression. The user can
restore expressions later in source. Two regex patterns handle the recipe file
format: expression properties (`fieldName: expr,`) and shorthand properties
(`fieldName,`). Both are replaced with `fieldName: literal,`. No AST
manipulation needed.

**Two-phase slider feedback.** During drag, the browser applies a temporary
CSS override for instant visual feedback — no file round-trip. On drag-end,
the final value is written to disk. The file pipeline (write → watcher →
token gen → HMR) takes ~300ms, which is fine for a single write on release
but too slow for continuous drag. The temporary override bridges the gap.

**Dev-only, pure DOM.** The formula editor is a development tool. It doesn't
ship in production builds. It uses direct DOM manipulation consistent with the
existing style inspector (Law L01, Law L06). No React state, no components.

**Formulas come from ActivateResult, not module-level cache.**
`activateThemeOverride` already runs `deriveTheme()` for the active theme.
Extend `ActivateResult` to include the `DerivationFormulas` object and the
active `mode` string. The `GET /__themes/formulas` endpoint handler calls
`activateThemeOverride` and reads formulas/mode from the return value — no
hidden module-level cache write. This keeps `activateThemeOverride` testable
with mock fs (the existing test pattern). The inspector fetches the endpoint
once on activation and refreshes after each edit.

## What This Does NOT Cover

- **ThemeSpec editing** — the theme generator card already handles spec-level
  editing (hue, tone, intensity sliders for the seed values). This editor is
  for the formula layer below that.
- **Adding new formula fields** — this editor changes values of existing fields.
  Adding new fields requires editing the recipe function and the rules table.
- **Rules table editing** — the rules table maps tokens to formula expressions.
  Changing which formula field a token reads is a structural change, not a
  tuning change.
- **New recipe modes** — creating a third recipe (e.g., "high-contrast") is a
  separate task. This editor works with whatever recipes exist.

## Verification

After implementation, verify:

1. Hover any element with Shift+Alt → formula fields shown with current values
2. Pin the inspector, drag a tone slider → screen color updates in real time
3. Check the recipe file on disk → literal value was written
4. `git diff` shows clean, readable changes to the recipe file
5. `bun test` passes — formula editor is dev-only, doesn't affect tests
6. `bun run build` passes — formula editor is excluded from production
