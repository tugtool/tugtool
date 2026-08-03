# Lens space allocation — the rail divides its height by priority, not by size {#lens-space-allocation}

A working brief for one change to the Lens stack: when the rail runs out of vertical space, decide *which* section gives it up. Today that decision is made by flexbox's default, which is proportional to how much a section has — so the section that matters most gives the most, and the section that matters least gives nothing at all.

The work is small and the mechanism is already in the platform. What needs deciding is stated at the end.

## What the rail does today {#today}

The stack is top-anchored and content-sized. Every section is `flex: 0 1 auto` (`lens-section-band.css`), so with room to spare each takes the height its content needs and the leftover sits as quiet background below the last band. Nothing scrolls. That half is right and stays.

Under pressure, flexbox distributes the deficit in proportion to each item's flex base size. Measured against the real app — thirty open cards in a 1181px rail:

| Section | wants | gets | gives |
|---|---|---|---|
| **Cards** | 948 | 596 | **352** |
| **Snippets** | 354 | 222 | **132** |
| **Layouts** | 362 | 362 | **0** |

The deficit is 483px and it lands 2.67 : 1 : 0 — exactly the ratio of the three content heights. Two things are wrong with that, and they compound:

- **The priority order is inverted.** Cards is the section the rail exists for, and being the tallest is precisely what makes it the biggest giver.
- **Layouts cannot give at all.** It holds no scroller, so its min-content size is its full height and flex freezes it on the first pass. It is not privileged by intent; it is unshrinkable by construction, which amounts to the same thing. The lowest-priority band is the only one guaranteed to keep every pixel it asked for.

## Not to be confused with the extent-floor defect {#not-the-floor}

A scrollbar on a Lens list that plainly fits, with slack below the last band, was a *different* bug — phantom scroll extent left by `.tug-list-view-floor`, fixed separately and gated by `tests/app-test/at0337-extent-floor-phantom.test.ts`. It presented as a space-allocation failure and is not one: the section was correctly sized throughout. Anything in this brief that reads as "the rail is scrolling when it shouldn't" should be checked against at0337 first.

## The invariant {#invariant}

> **No Lens list is scrollable while the stack has slack.** Scrolling begins at the pixel the stack runs out, and not before.

Stated on **scroll extent**, not on content height — that distinction is the whole lesson of the floor defect above, where content-based accounting said everything was fine while the scroller said otherwise.

This is already true and the change must keep it true. It is also directly assertable: measure `.lens-sections` client height minus the sum of the section heights; if that is greater than zero, no `.tug-list-view` in the Lens may have `scrollHeight > clientHeight`.

## The allocation {#allocation}

When the stack does run out, satisfy the sections in priority order — Cards fully, then Snippets, then the rest — with a floor under each so nothing collapses to a bare header.

**This wants no JavaScript allocator.** Flexbox's "resolve flexible lengths" step is already a waterfall: it shrinks in proportion to `basis × shrink-factor`, freezes any item that reaches its `min-block-size`, and redistributes the remaining deficit among the items still free. Give the sections widely separated shrink factors and per-section floors and the engine performs the priority waterfall itself:

```css
.lens-section                               { flex-shrink: 1; }      /* the rest */
.lens-section[data-lens-section="snippets"] { flex-shrink: 1e-4; }
.lens-section[data-lens-section="cards"]    { flex-shrink: 1e-8; }
.lens-section                               { min-block-size: var(--tugx-lens-section-floor); }
```

`data-lens-section` is already stamped on the band root by `lens-section-band.tsx`, so the hook exists.

At the measured 483px deficit, Cards' arithmetic share under those ratios is well under a tenth of a pixel: it gives nothing until Layouts and Snippets have both reached their floors, at which point flex releases the remaining deficit onto it. No measurement, no `ResizeObserver`, no re-entrancy, correct during a live window resize, and correct in a background window where there is no rAF to schedule anything with. It is appearance and geometry expressed in CSS, driven by nothing — [L06] as written rather than as worked around.

Three things have to land with it:

- **Layouts must become able to give.** Its body needs `overflow-y: auto` and `min-block-size: 0`, the same as the two list sections. Without that the shrink factors say nothing, because an unshrinkable item outranks every ratio. This is the actual repair for the measured defect.
- **A floor per section.** Proposed as `header + ~2 rows`, authored once as `--tugx-lens-section-floor` with per-section override. Stated plainly because it sits next to a standing rule: this is a *design minimum for a band*, not an estimate of content height — nothing here guesses how tall anything is. If the floor is unwanted, the rule degrades cleanly to header-only and the lower-priority bands squeeze to their headers.
- **The snippet-editor rule folds in.** `.lens-sections:has(.snippet-editor)` currently makes the editing section the sole giver by zeroing its siblings' shrink. Under the new scheme that is the same statement in the new vocabulary — the editing section takes the largest shrink factor — rather than a second mechanism competing with the first.

## Open decisions {#decisions}

**D1 — Where priority comes from.** Registry-fixed (Cards is always first, wherever it has been dragged) or **stack order** (whatever is on top gets space first). Stack order is the recommendation: it is self-explanatory, it makes the existing drag-reorder the control, and the default order already produces the Cards → Snippets → rest ranking that was asked for.

**D2 — Whether "the rest" is one tier or ranked.** Immaterial at three sections. It needs an answer before the Lens redesign v2 adds more, and D1's stack-order option answers it for free.

## Gating {#gating}

One app-test, two assertions, both against the real app:

- **Slack implies no scrolling** — the invariant above, measured on scroll extent.
- **Priority under pressure** — a seeded deck large enough to exhaust the rail, asserting Cards holds its full content height while Snippets and Layouts sit at their floors.

The geometry probe that produced the table in this brief is the shape of both.
