# Chromatic Token List

**Purpose:** Explicit enumeration of all chromatic (dual-use) tokens in the `--tug-base-*` token system, with usage contexts for each. These tokens are neither renamed nor classified as element or surface — they are a third category because they serve as both foreground and background depending on rendering context.

**Produced by:** Step 3 of the token audit and pairing extraction plan.

**References:** [D01] Token naming regularization, Spec S01 (Phase 2, Chromatic category), `token-inventory-baseline.md`

---

## Definition

A **chromatic token** is a pure chromatic signal value that can appear as:
- A **foreground color** (rendered on top of a surface — e.g., an accent-colored text label, a tone indicator dot)
- A **background color** (a surface that other elements render on — e.g., an accent-filled button background, a tone-tinted row background)

Because the same token plays both roles in different rendering contexts, it cannot be mechanically classified as element or surface by the naming convention alone. Instead, chromatic tokens are **explicitly enumerated** and paired with explicit contrast roles in the `element-surface-pairing-map.ts` per usage context.

---

## Total Count: 32 Chromatic Tokens

| Family | Count |
|--------|-------|
| Accent | 3 |
| Bare tone (chromatic signal values) | 7 |
| Highlight | 6 |
| Overlay | 3 |
| Toggle track | 7 |
| Toggle thumb | 2 |
| Radio dot | 1 |
| Field tone | 3 |
| **Total** | **32** |

---

## Family 1: Accent (3 tokens)

These tokens represent the primary accent color and its cool/subtle variants. They are used as:
- **Foreground:** accent-colored text, link underlines, active state indicators
- **Background:** filled accent button backgrounds, accent-tinted surfaces

| Token | Primary Foreground Use | Primary Background Use |
|-------|----------------------|----------------------|
| `--tug-base-accent-default` | Accent-colored text/links on `bg-canvas` or `surface-*` surfaces | Background of `control-filled-accent-*` buttons (element: `control-filled-accent-fg-*` renders on it) |
| `--tug-base-accent-cool-default` | Cool-tinted accent text | Cool-tinted button backgrounds (alternate accent family) |
| `--tug-base-accent-subtle` | Subtle accent highlights, de-emphasized accent text | Subtle accent tint backgrounds (hover states, badges) |

**Classification rationale:** These tokens do not carry `-fg-` or `-bg-` in their names, and they are genuinely dual-use across the component library. Adding suffixes would require two tokens per color value, which is not the direction of this refactor.

---

## Family 2: Bare Tone (7 tokens)

The raw chromatic signal values for the 7 semantic tone families. Each tone family also has `-bg`, `-fg`, `-border`, and `-icon` sibling tokens that *are* classified as surface or element. Only the bare tone token (no suffix) is chromatic.

| Token | Tone Family | Foreground Use | Background Use |
|-------|------------|---------------|---------------|
| `--tug-base-tone-accent` | accent | Accent tone indicators, dot markers | Accent tone row tinting, callout backgrounds |
| `--tug-base-tone-active` | active | Active-state text labels | Active-state row backgrounds |
| `--tug-base-tone-agent` | agent | Agent-status indicators | Agent-status tinted card backgrounds |
| `--tug-base-tone-caution` | caution | Caution text warnings, icons (alternate to `tone-caution-icon`) | Caution-tinted notification backgrounds |
| `--tug-base-tone-danger` | danger | Danger text labels | Danger-tinted alert backgrounds |
| `--tug-base-tone-data` | data | Data visualization ink | Data-tinted highlight backgrounds |
| `--tug-base-tone-success` | success | Success text confirmations | Success-tinted banner backgrounds |

**Note on tone siblings:** The sibling tokens are already classifiable and are NOT chromatic:
- `tone-*-bg` (7 tokens) — classified as **surface** (contain `-bg-`)
- `tone-*-fg` (7 tokens) — classified as **element** (contain `-fg-`)
- `tone-*-border` (7 tokens) — classified as **element** (contain `-border-`)
- `tone-*-icon` (7 tokens) — classified as **element** (contain `icon-`)

---

## Family 3: Highlight (6 tokens)

Overlay highlight values used by the inspector, drag-and-drop system, and canvas interaction layer. These appear as semi-transparent color washes layered on top of content (foreground overlay use) or as the background of a highlighted region (background use).

| Token | Use Context |
|-------|------------|
| `--tug-base-highlight-hover` | Hover state highlight overlay on canvas elements |
| `--tug-base-highlight-dropTarget` | Drop target highlight when dragging |
| `--tug-base-highlight-preview` | Preview highlight for pending changes |
| `--tug-base-highlight-inspectorTarget` | Inspector selection highlight overlay |
| `--tug-base-highlight-snapGuide` | Snap guide line color |
| `--tug-base-highlight-flash` | Flash animation color for "recently changed" UI states |

**Pairing note:** Highlight tokens are typically used with CSS `opacity` or as semi-transparent OKLCH values. They are decorative overlays — the underlying content contrast is established by separate element/surface pairings. Contrast role is always `decorative` when used as overlays.

---

## Family 4: Overlay (3 tokens)

Scrim and overlay colors used for modal dialogs, drawers, and dimming effects. These are background-like (they create a visual layer) but are rendered as the "foreground" of the scrim layer.

| Token | Use Context |
|-------|------------|
| `--tug-base-overlay-dim` | Dim overlay behind menus and popovers |
| `--tug-base-overlay-scrim` | Full-screen scrim behind modal dialogs |
| `--tug-base-overlay-highlight` | Highlight overlay on focused/selected areas |

**Pairing note:** Overlay tokens are typically semi-transparent; the legibility of any text on or through them depends on the combined visual result. Contrast role is `decorative` for scrim/dim overlays. No element token renders directly on overlay tokens in the token system.

---

## Family 5: Toggle Track (7 tokens)

The track (background rail) of toggle switches and checkboxes. These are surfaces that the toggle thumb renders on, but the token names lack the `-bg-` segment. They are explicitly enumerated as chromatic because:
1. The track IS a background (the thumb renders over it)
2. The name does not contain `-bg-` so the regex would miss them

| Token | State | Notes |
|-------|-------|-------|
| `--tug-base-toggle-track-off` | Off/unchecked rest | Thumb token: `toggle-thumb` |
| `--tug-base-toggle-track-off-hover` | Off/unchecked hover | Thumb token: `toggle-thumb` |
| `--tug-base-toggle-track-on` | On/checked rest | Thumb token: `toggle-thumb`; icon: `toggle-icon-*` |
| `--tug-base-toggle-track-on-hover` | On/checked hover | Thumb token: `toggle-thumb` |
| `--tug-base-toggle-track-disabled` | Any state, disabled | Thumb token: `toggle-thumb-disabled` |
| `--tug-base-toggle-track-mixed` | Indeterminate/mixed state | Thumb token: `toggle-thumb` |
| `--tug-base-toggle-track-mixed-hover` | Indeterminate/mixed hover | Thumb token: `toggle-thumb` |

**Pairings in element-surface-pairing-map.ts:**
- `toggle-thumb` on `toggle-track-on` — role: `ui-component` (thumb contrast on track)
- `toggle-thumb` on `toggle-track-off` — role: `decorative` (thumb is always legible regardless)
- `toggle-icon-mixed` on `toggle-track-mixed` — role: `ui-component` (indeterminate mark on track)
- `toggle-thumb-disabled` on `toggle-track-disabled` — role: `decorative`

---

## Family 6: Toggle Thumb (2 tokens)

The thumb (foreground circle) of toggle switches. These are element tokens by usage (rendered on top of the track) but lack `-fg-` in their names. They are classified as chromatic because they also serve as the "fill" color for a shape element.

| Token | Use Context |
|-------|------------|
| `--tug-base-toggle-thumb` | Active thumb color (on, off, mixed states) |
| `--tug-base-toggle-thumb-disabled` | Disabled state thumb color |

**Pairings:** See toggle track pairings above.

---

## Family 7: Radio Dot (1 token)

The filled dot inside a selected radio button. Rendered as a shape fill on top of the toggle track.

| Token | Use Context |
|-------|------------|
| `--tug-base-radio-dot` | Radio button selected-state center dot fill |

**Pairing:** `radio-dot` on `toggle-track-on` — role: `ui-component`. The radio button uses the toggle track token for its checked background.

---

## Family 8: Field Tone (3 tokens)

Chromatic signal values used in field validation UI (error/warning/success states on input fields). These appear as:
- **Foreground:** text color for validation messages
- **Background:** tinted field background in certain validation states
- **Border:** (but tone-*-border sibling handles this, which IS classifiable)

| Token | Tone | Use Context |
|-------|------|------------|
| `--tug-base-field-tone-danger` | danger | Input field error state — used for error text color AND as the tone signal for border coloring |
| `--tug-base-field-tone-caution` | caution | Input field warning state — warning text color and tone signal |
| `--tug-base-field-tone-success` | success | Input field success state — success text color and tone signal |

**Note:** `field-tone-*` tokens are distinct from `tone-*` bare tokens. They are field-domain-specific tones that may have different lightness/chroma tuning from the generic `tone-*` values. They are classified as chromatic because they lack the `-fg-` segment yet are used as text colors.

---

## Pairing Map Treatment

Chromatic tokens require explicit pairing entries with their **usage-context-specific** contrast roles. The pairing map must record the role per usage:

```typescript
// Example: accent-default as both element (on surface) and surface (element renders on it)
{ element: "--tug-base-fg-onAccent",     surface: "--tug-base-accent-default", role: "body-text",   context: "Text on accent-filled button" },
{ element: "--tug-base-icon-onAccent",   surface: "--tug-base-accent-default", role: "ui-component", context: "Icon on accent-filled button" },
// accent-default AS the element token (used as colored text):
{ element: "--tug-base-accent-default",  surface: "--tug-base-surface-default", role: "ui-component", context: "Accent-colored UI label on default surface" },
```

Each chromatic token that serves as a foreground element has an entry with itself as `element`. Each chromatic token that serves as a background surface has an entry with itself as `surface`. Both entries may exist for the same chromatic token.

---

## Classification Validation

After the Step 4 rename, all 32 chromatic tokens remain unchanged. Verifying they are properly excluded from the element/surface classification:

- None of the 32 tokens match the surface regex (`-bg-`, `-bg$`, `-surface-`)
- None match the element regex (`-fg-`, `-fg$`, `-border-`, `-border$`, `divider-` prefix or `-divider-`, `-divider$`, `-shadow-`, `-shadow$`, `-icon-`, `-icon$`) — except `toggle-icon-disabled` and `toggle-icon-mixed` which are **not** in this chromatic list (they correctly classify as element via the `icon-` match)
- All 32 are in the explicit chromatic enumeration per Spec S01

**Verification:** A classification script applied to these 32 tokens must place all of them in the "chromatic" bucket, not element or surface.
