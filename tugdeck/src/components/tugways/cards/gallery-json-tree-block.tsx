/**
 * gallery-json-tree-block.tsx — visual fixture for `JsonTreeBlock`.
 *
 * `JsonTreeBlock` ([body-kinds/json-tree-block.tsx]) is a permanent
 * Layer-1 body kind — the collapsible JSON viewer behind
 * `DefaultToolBlock` and the drift fallback. This card mounts it
 * **standalone** (each instance paints its own frame + header with the
 * Expand-all / Collapse-all / Copy cluster) across the value-shapes it
 * has to handle:
 *
 *  1. **Primitives** — a flat object with one leaf of every JSON type
 *     (string / number / boolean / null) so the type-colour vocabulary
 *     is all on screen at once.
 *  2. **Nested** — an object several levels deep. With the default
 *     depth (3) the shallow region renders expanded and deeper nodes
 *     fold; Expand-all / Collapse-all flip the whole tree.
 *  3. **Array of objects** — the list shape a tool's
 *     `structured_result` usually carries, labelled "results".
 *  4. **Shallow default** — the same nested payload at `defaultDepth={1}`,
 *     i.e. how `DefaultToolBlock` opens a tool input: root expanded,
 *     top-level keys folded.
 *  5. **Empty** — `data={undefined}`, the layout-consistent empty
 *     marker (distinct from a JSON `null` leaf).
 *
 * All data is module-scope; the card opts out of [A9] state
 * preservation (no `componentStatePreservationKey`) — gallery fixtures
 * mount fresh each time.
 *
 * Laws: [L06] expand state is logical/React-owned inside the component,
 *       [L19] gallery-card authoring (module docstring, exported
 *       component, registered).
 *
 * @module components/tugways/cards/gallery-json-tree-block
 */

import "./gallery-json-tree-block.css";

import React from "react";

import { JsonTreeBlock } from "@/components/tugways/body-kinds/json-tree-block";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Mock JSON payloads
// ---------------------------------------------------------------------------

const PRIMITIVES = {
  name: "tugtool",
  version: 47,
  stable: true,
  deprecated: null,
  tagline: 'a unified command surface (quotes "kept" + escaped)',
};

const NESTED = {
  request: {
    method: "POST",
    url: "https://api.example.com/v2/sessions",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer …",
    },
    body: {
      session: {
        kind: "tide",
        options: { autoReconnect: true, backoffMs: [250, 500, 1000] },
      },
    },
  },
  response: {
    status: 201,
    durationMs: 84,
    payload: { id: "sess_8f3a", createdAt: "2026-05-14T00:00:00Z" },
  },
};

const ARRAY_OF_OBJECTS = [
  { id: 1, path: "src/main.tsx", matches: 3 },
  { id: 2, path: "src/app.tsx", matches: 1 },
  { id: 3, path: "src/components/tugways/cards/gallery-registrations.tsx", matches: 7 },
];

// ---------------------------------------------------------------------------
// GalleryJsonTreeBlock
// ---------------------------------------------------------------------------

export function GalleryJsonTreeBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-json-tree-block">
      <div className="cg-section gallery-json-tree-section">
        <TugLabel className="cg-section-title">
          Primitives — one leaf of every JSON type, with a label
        </TugLabel>
        <JsonTreeBlock data={PRIMITIVES} label="primitives" />
      </div>

      <TugSeparator />

      <div className="cg-section gallery-json-tree-section">
        <TugLabel className="cg-section-title">
          Nested — default depth 3: shallow region expanded, deeper nodes fold
        </TugLabel>
        <JsonTreeBlock data={NESTED} label="exchange" />
      </div>

      <TugSeparator />

      <div className="cg-section gallery-json-tree-section">
        <TugLabel className="cg-section-title">
          Array of objects — the structured-result list shape
        </TugLabel>
        <JsonTreeBlock data={ARRAY_OF_OBJECTS} label="results" />
      </div>

      <TugSeparator />

      <div className="cg-section gallery-json-tree-section">
        <TugLabel className="cg-section-title">
          Shallow default (depth 1) — how DefaultToolBlock opens a tool input
        </TugLabel>
        <JsonTreeBlock data={NESTED} label="input" defaultDepth={1} />
      </div>

      <TugSeparator />

      <div className="cg-section gallery-json-tree-section">
        <TugLabel className="cg-section-title">
          Empty — data is undefined: the layout-consistent empty marker
        </TugLabel>
        <JsonTreeBlock data={undefined} label="result" />
      </div>
    </div>
  );
}
