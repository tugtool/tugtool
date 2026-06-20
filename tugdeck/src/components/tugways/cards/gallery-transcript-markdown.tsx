/**
 * gallery-transcript-markdown.tsx — design-spike card for TRANSCRIPT
 * markdown ([P04]/[P09]).
 *
 * The transcript renders assistant prose through `TugMarkdownBlock`
 * (natural flow), scoped by `.dev-card-transcript-code-body` at the 14px
 * transcript root. This card mounts that exact pairing with a COMPLETE
 * sample document — every standard markdown construct, every GFM
 * extension (tables with alignment, strikethrough, task lists,
 * footnotes, autolinks), and every renderer enhancement we support
 * (inline + display math, fenced code, images, mermaid) — plus the
 * spacing adjacencies that have bitten us (a heading after a paragraph,
 * a table, a code block, math, and a list). It is the canonical
 * reference for locking the transcript markdown look: what reads right
 * here is what the transcript shows, because it is the same component
 * and the same CSS.
 *
 * Width: the markdown lives in a `min-width: 0` scroll column so wide
 * blocks (code, mermaid) stay constrained to the card and scroll within
 * themselves — mirroring the transcript's entry-body column, which is
 * `min-width: 0` for the same reason. A table does NOT scroll within
 * itself: it wears the shared block chrome (sticky header strip + fold
 * cue) with its `<thead>` as a second sticky tier, so the page never
 * shows a scroller-inside-a-scroller (see the long-table case).
 *
 * @module components/tugways/cards/gallery-transcript-markdown
 */

import React from "react";

import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";

/** A tiny inline-SVG data URI so the image example renders (not broken). */
const SAMPLE_IMG =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='120'%20height='48'%3E%3Crect%20width='120'%20height='48'%20rx='6'%20fill='%234a90d9'/%3E%3Ctext%20x='60'%20y='30'%20font-family='sans-serif'%20font-size='14'%20fill='white'%20text-anchor='middle'%3Eimage%3C/text%3E%3C/svg%3E";

/** Complete sample — every construct + the adjacency cases that matter. */
const SAMPLE = `# Heading 1 — The Quadratic Formula

A paragraph with the full inline vocabulary: **bold**, *italic*, ***bold italic***, ~~strikethrough~~, \`inline code\`, a [markdown link](https://example.com), an autolink <https://example.com>, and inline math $E = mc^2$ — all in one sentence so we can see them sit on the line together.

## Heading 2 — Every heading level

### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

## Heading 2 — Display math (heading directly above an equation)

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

## Heading 2 — Heading immediately after math

The gap above this heading should match every other heading (no over-spacing after the equation block).

## Heading 2 — Lists

- Unordered item one
- Unordered item two, long enough to wrap onto a second line in the narrow transcript column so we can judge list line-height
  - Nested unordered a
  - Nested unordered b
- Unordered item three

1. Ordered item one
2. Ordered item two
   1. Nested ordered item

- [ ] An unchecked task item
- [x] A checked task item

## Heading 2 — Table with column alignment

| Left | Center | Right |
|:-----|:------:|------:|
| x | b | c |
| a longer left cell | mid | 42 |
| b² − 4ac | the discriminant | 1.5 |

## Heading 2 — Long table (block chrome + two-tier sticky headers)

| State | Capital |
|-------|---------|
| Alabama | Montgomery |
| Alaska | Juneau |
| Arizona | Phoenix |
| Arkansas | Little Rock |
| California | Sacramento |
| Colorado | Denver |
| Connecticut | Hartford |
| Delaware | Dover |
| Florida | Tallahassee |
| Georgia | Atlanta |
| Hawaii | Honolulu |
| Idaho | Boise |
| Illinois | Springfield |
| Indiana | Indianapolis |
| Iowa | Des Moines |
| Kansas | Topeka |
| Kentucky | Frankfort |
| Louisiana | Baton Rouge |
| Maine | Augusta |
| Maryland | Annapolis |
| Massachusetts | Boston |
| Michigan | Lansing |
| Minnesota | Saint Paul |
| Mississippi | Jackson |
| Missouri | Jefferson City |
| Montana | Helena |
| Nebraska | Lincoln |
| Nevada | Carson City |
| New Hampshire | Concord |
| New Jersey | Trenton |
| New Mexico | Santa Fe |
| New York | Albany |
| North Carolina | Raleigh |
| North Dakota | Bismarck |
| Ohio | Columbus |
| Oklahoma | Oklahoma City |
| Oregon | Salem |
| Pennsylvania | Harrisburg |
| Rhode Island | Providence |
| South Carolina | Columbia |
| South Dakota | Pierre |
| Tennessee | Nashville |
| Texas | Austin |
| Utah | Salt Lake City |
| Vermont | Montpelier |
| Virginia | Richmond |
| Washington | Olympia |
| West Virginia | Charleston |
| Wisconsin | Madison |
| Wyoming | Cheyenne |

## Heading 2 — Heading immediately after a table

This is the case that was badly over-spaced; it should now read with the same rhythm as the others.

\`\`\`typescript
// Fenced code with a language label + copy button.
function discriminant(a: number, b: number, c: number): number {
  const veryLongLineToProveHorizontalScrollStaysInsideTheBlockAndDoesNotPushTheCardWidth = b * b - 4 * a * c;
  return veryLongLineToProveHorizontalScrollStaysInsideTheBlockAndDoesNotPushTheCardWidth;
}
\`\`\`

### Heading 3 — Heading immediately after code

> A blockquote tests the left-rail rhythm.
>
> > A nested blockquote sits inside it.

#### Heading 4 — Heading after a blockquote

An image renders inline below:

![sample image](${SAMPLE_IMG})

## Heading 2 — Mermaid diagram

\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|yes| C[Do it]
  B -->|no| D[Skip it]
\`\`\`

## Heading 2 — Footnotes & rule

A claim that needs a citation.[^note] Another sentence follows.

[^note]: This is the footnote definition, linked back to its reference.

---

The end.`;

/**
 * GalleryTranscriptMarkdown — the complete transcript markdown fixture.
 */
export function GalleryTranscriptMarkdown(): React.ReactElement {
  return (
    <div
      className="cg-content"
      data-testid="gallery-transcript-markdown"
      style={{ padding: 0, height: "100%", overflow: "hidden", minWidth: 0 }}
    >
      {/* `min-width: 0` + `box-sizing: border-box` keep wide blocks
          (table / code / mermaid) constrained to the card and scrolling
          within themselves, mirroring the transcript's entry-body column.
          14px is the transcript root size; `dev-card-transcript-code-body`
          is the transcript's markdown scope. */}
      <div
        style={{
          height: "100%",
          minWidth: 0,
          overflowY: "auto",
          overflowX: "hidden",
          boxSizing: "border-box",
          padding: "16px 20px",
          fontSize: 14,
        }}
      >
        <TugMarkdownBlock
          className="dev-card-transcript-code-body"
          initialText={SAMPLE}
        />
      </div>
    </div>
  );
}
