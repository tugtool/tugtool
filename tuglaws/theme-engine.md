# Theme System (CSS-First)

*The theme runtime is CSS-first and file-based.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## Source Of Truth

Theme data lives in checked-in CSS files:

| File | Role |
|---|---|
| `tugdeck/styles/tug-base-generated.css` | Base `brio` tokens |
| `tugdeck/styles/themes/harmony.css` | Override tokens for `harmony` |
| `tugdeck/styles/tug-theme-override.css` | Dev-only active override copy (empty for `brio`) |

Shipped themes: `brio` and `harmony`.

---

## Activation Model

### Development

- `POST /__themes/activate` is the activation API.
- `brio` writes an empty `tug-theme-override.css`.
- `harmony` copies `styles/themes/harmony.css` into `tug-theme-override.css`.
- The endpoint returns `{ theme, hostCanvasColor }`.

### Production

- Base theme is included by app CSS import.
- Non-base theme is activated via `<link id="tug-theme-override" href="/assets/themes/<name>.css">`.
- `activateProductionTheme()` inserts/updates/removes that link.
- On startup, if saved theme is non-`brio`, the link is applied before first visible paint.

---

## Host Canvas Color Contract

Each theme CSS file must define:

```css
body {
  --tugx-host-canvas-color: #rrggbb;
}
```

Rules:

- Must be literal 6-digit hex.
- Dev activation returns this value from source CSS metadata.
- Production activation reads the applied CSS value and normalizes to `#rrggbb`.
- Swift bridge receives only the normalized hex string.

---

## Accessibility Card Data Path

Theme Accessibility uses live CSS, not derivation:

1. Build-time token inventory: `TUG_TOKEN_NAMES`.
2. Runtime raw values: `getComputedStyle(...).getPropertyValue(name)`.
3. Runtime color resolution: hidden probe element for tokens needing computed color.
4. Contrast/CVD analysis from resolved runtime colors.

This card reports live findings only (failures, marginals, unresolved values, CVD warnings).

---

## Build Processing

PostCSS is used for CSS processing:

- Authoring syntax `--tug-color(...)` remains in source CSS.
- `postcss-tug-color` expands to regular CSS during Vite dev/build.

The system intentionally duplicates one value per theme (`--tugx-host-canvas-color`) to keep runtime simple and explicit.
