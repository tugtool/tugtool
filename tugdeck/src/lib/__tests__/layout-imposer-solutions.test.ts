/**
 * layout-imposer-solutions.test.ts — the space allocator's whole solution
 * space, enumerated.
 *
 * The allocator is a total function of (canvas width, imposition kind,
 * occupied slots and their widths, rail policies), and for any fixed discrete
 * configuration its answer is piecewise-linear in canvas width with a handful
 * of computable breakpoints. That is small enough to *check exhaustively*
 * rather than to spot-check, so this file does two things:
 *
 *  1. **The invariant sweep** — the strong net. Every configuration below is
 *     solved at every breakpoint (±1px, where the answer's slope changes) and
 *     across a coarse canvas sweep, and every point is asserted against the
 *     invariant order the solver implements: totality, bounds, greed
 *     soundness, tiling, monotonicity in canvas width, and tie fairness. These
 *     are PROPERTIES, so they survive an intentional retune of the numbers.
 *  2. **The golden table** — the drift net. A deterministic representative
 *     slice is serialized and compared against a checked-in JSON file, so ANY
 *     behavioral change, intended or not, shows up in review as a readable
 *     diff.
 *
 * Regenerate the golden deliberately:
 *
 * ```
 * cd tugdeck && IMPOSER_GOLDEN_UPDATE=1 bun test src/lib/__tests__/layout-imposer-solutions.test.ts
 * ```
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONTENT_WIDTH_COMFY_PX,
  CONTENT_WIDTH_SLIM_PX,
  CONTENT_WIDTH_WIDE_PX,
  IMPOSITION_GAP_PX,
  IMPOSITION_KINDS,
  allocateSidebarWidths,
  seamPicture,
  slotCount,
  solveSidebarWidths,
  travelFraction,
  type AllocatorInput,
  type ImpositionKind,
  type RailPolicy,
  type RailWidths,
  type SidebarSide,
} from "@/lib/layout-imposer";
import {
  DEFAULT_GAZETTE_WIDTH_PX,
  MIN_GAZETTE_WIDTH_PX,
} from "@/lib/gazette-measure";

const GAP = IMPOSITION_GAP_PX;
/** The ceiling the deck passes, for every rail. */
const CEILING = CONTENT_WIDTH_SLIM_PX;
/** The rank an unranked card takes (`card-registry`'s `DEFAULT_GREED_RANK`),
 *  spelled out because the imposer is pure and never reads the registry. */
const UNRANKED = 9;

/* ---------------------------------------------------------------------------
 * The configuration space (List L01)
 * ---------------------------------------------------------------------------*/

/** One rail fixture: what stands on each side, and the member floors a folded
 *  rail must never fall below. */
interface RailFixture {
  name: string;
  rails: { left?: RailPolicy; right?: RailPolicy };
  /** The per-side member floors this fixture's policies were folded from. */
  memberFloors: { left?: readonly number[]; right?: readonly number[] };
}

/** The Gazette's real registered policy — the widths this plan derives from
 *  its type, imported rather than re-hardcoded so a retune of the measure
 *  moves this sweep with it. */
const GAZETTE: RailPolicy = {
  preferredWidth: DEFAULT_GAZETTE_WIDTH_PX,
  minWidth: MIN_GAZETTE_WIDTH_PX,
  greedRank: 1,
};
const LENS: RailPolicy = { preferredWidth: 420, minWidth: 320, greedRank: 2 };
const JOTS: RailPolicy = { preferredWidth: 420, minWidth: 320, greedRank: 3 };
/** A rail the user has dragged wide: preference is theirs, and the solver
 *  reads it from the durable store, so a dragged width is an ordinary input. */
const DRAGGED: RailPolicy = {
  preferredWidth: 600,
  minWidth: 320,
  greedRank: UNRANKED,
};

/** The stacking fold `deck-manager`'s `_sidebarRails` performs. */
function foldRail(members: readonly RailPolicy[]): RailPolicy {
  return {
    preferredWidth: Math.max(...members.map((m) => m.preferredWidth)),
    minWidth: Math.max(...members.map((m) => m.minWidth)),
    greedRank: Math.min(...members.map((m) => m.greedRank)),
  };
}

const RAIL_FIXTURES: readonly RailFixture[] = [
  {
    name: "gazette-right",
    rails: { right: GAZETTE },
    memberFloors: { right: [GAZETTE.minWidth] },
  },
  {
    name: "lens-left",
    rails: { left: LENS },
    memberFloors: { left: [LENS.minWidth] },
  },
  {
    name: "jots-right",
    rails: { right: JOTS },
    memberFloors: { right: [JOTS.minWidth] },
  },
  {
    name: "gazette-jots-stacked-right",
    rails: { right: foldRail([GAZETTE, JOTS]) },
    memberFloors: { right: [GAZETTE.minWidth, JOTS.minWidth] },
  },
  {
    name: "lens-left+gazette-right",
    rails: { left: LENS, right: GAZETTE },
    memberFloors: { left: [LENS.minWidth], right: [GAZETTE.minWidth] },
  },
  {
    name: "jots-left+gazette-right",
    rails: { left: JOTS, right: GAZETTE },
    memberFloors: { left: [JOTS.minWidth], right: [GAZETTE.minWidth] },
  },
  {
    name: "equal-rank-pair",
    rails: {
      left: { preferredWidth: 400, minWidth: 320, greedRank: 5 },
      right: { preferredWidth: 400, minWidth: 320, greedRank: 5 },
    },
    memberFloors: { left: [320], right: [320] },
  },
  {
    name: "dragged-left+gazette-right",
    rails: { left: DRAGGED, right: GAZETTE },
    memberFloors: { left: [DRAGGED.minWidth], right: [GAZETTE.minWidth] },
  },
];

type Occupancy = { name: string; occupied: { slot: number; width: number }[] };

/** Every non-empty subset of the kind's slots, each at a uniform card width,
 *  plus one alternating slim/wide pattern per subset of two or more. */
function occupanciesFor(kind: ImpositionKind): Occupancy[] {
  const slots = slotCount(kind);
  const out: Occupancy[] = [];
  for (let mask = 1; mask < 1 << slots; mask += 1) {
    const taken: number[] = [];
    for (let slot = 0; slot < slots; slot += 1) {
      if ((mask & (1 << slot)) !== 0) taken.push(slot);
    }
    for (const [label, width] of [
      ["slim", CONTENT_WIDTH_SLIM_PX],
      ["comfy", CONTENT_WIDTH_COMFY_PX],
      ["wide", CONTENT_WIDTH_WIDE_PX],
    ] as const) {
      out.push({
        name: `${mask}:${label}`,
        occupied: taken.map((slot) => ({ slot, width })),
      });
    }
    if (taken.length >= 2) {
      out.push({
        name: `${mask}:mixed`,
        occupied: taken.map((slot, i) => ({
          slot,
          width: i % 2 === 0 ? CONTENT_WIDTH_SLIM_PX : CONTENT_WIDTH_WIDE_PX,
        })),
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * The breakpoints
 * ---------------------------------------------------------------------------*/

/** The sides carrying a rail, in the order the solver reads them. */
function sidesOf(rails: AllocatorInput["rails"]): SidebarSide[] {
  const sides: SidebarSide[] = [];
  if (rails.left !== undefined) sides.push("left");
  if (rails.right !== undefined) sides.push("right");
  return sides;
}

/** The bounds the solver derives for one rail. */
function boundsOf(policy: RailPolicy): {
  floor: number;
  ceiling: number;
  preferred: number;
} {
  const floor = Math.ceil(policy.minWidth);
  const ceiling = Math.max(Math.round(CEILING), floor);
  return {
    floor,
    ceiling,
    preferred: Math.min(
      Math.max(Math.round(policy.preferredWidth), floor),
      ceiling,
    ),
  };
}

/**
 * The canvas widths where a configuration's answer changes slope.
 *
 * `T*` is linear in canvas width with slope 1 (`T* = canvas − gap·(R+2) − B*`),
 * so a rail TOTAL maps to a canvas by adding back the constant. `B*` is read
 * off `solveSidebarWidths` at a reference canvas rather than recomputed here,
 * so this cannot drift from the solver's own fit. The interesting totals are
 * Σ floors, Σ preferred, Σ ceilings, and each partial-fill boundary in both
 * the drain order and the fill order.
 */
function breakpointCanvases(input: AllocatorInput): number[] {
  const sides = sidesOf(input.rails);
  const bounds = sides.map((side) => boundsOf(input.rails[side] as RailPolicy));
  const ranks = sides.map((side) => (input.rails[side] as RailPolicy).greedRank);
  const sum = (of: (b: (typeof bounds)[number]) => number): number =>
    bounds.reduce((running, b) => running + of(b), 0);

  const totals = new Set<number>([
    sum((b) => b.floor),
    sum((b) => b.preferred),
    sum((b) => b.ceiling),
  ]);
  // Drain order (least greedy first) and fill order (greediest first): each
  // rail's give / capacity, accumulated, is a boundary of the piecewise fill.
  const order = sides.map((_, i) => i);
  const drain = [...order].sort((a, b) => ranks[b] - ranks[a]);
  const fill = [...order].sort((a, b) => ranks[a] - ranks[b]);
  let running = sum((b) => b.preferred);
  for (const i of drain) {
    running -= bounds[i].preferred - bounds[i].floor;
    totals.add(running);
  }
  running = sum((b) => b.preferred);
  for (const i of fill) {
    running += bounds[i].ceiling - bounds[i].preferred;
    totals.add(running);
  }

  const reference = 2000;
  const solved = solveSidebarWidths({ ...input, canvasWidth: reference });
  if (solved === null) return [];
  // `solved = canvas − gap·(R+2) − B*`, so the canvas wanting total `T` is
  // `T + (reference − solved)`.
  const offset = reference - solved;
  const canvases: number[] = [];
  for (const total of totals) {
    for (const delta of [-1, 0, 1]) canvases.push(total + offset + delta);
  }
  return canvases;
}

/** The coarse sweep every configuration is also checked across. */
const SWEEP: readonly number[] = Array.from(
  { length: 32 },
  (_, i) => 700 + i * 100,
);

/* ---------------------------------------------------------------------------
 * The invariants (List L02)
 * ---------------------------------------------------------------------------*/

/** Whether the chain admits an EXACT tiling at the fitted band — every seam
 *  lands on the gap in the linear model, and no card is wider than the band,
 *  so `imposeRect`'s travel clamp does not part company with that model. */
function chainTilesExactly(input: AllocatorInput, widths: RailWidths): boolean {
  const chain = [...input.occupied]
    .sort((a, b) => a.slot - b.slot)
    .filter((entry, i, all) => i === 0 || all[i - 1].slot !== entry.slot);
  if (chain.length < 2) return false;
  const railTotal = (widths.left ?? 0) + (widths.right ?? 0);
  const railCount = sidesOf(input.rails).length;
  const band = input.canvasWidth - railTotal - GAP * (railCount + 2);
  const count = slotCount(input.kind);
  for (const entry of chain) if (entry.width > band) return false;
  for (let j = 0; j < chain.length - 1; j += 1) {
    const near = chain[j];
    const far = chain[j + 1];
    const fNear = travelFraction({ slot: near.slot, count });
    const fFar = travelFraction({ slot: far.slot, count });
    const seam =
      (fFar - fNear) * band + fNear * near.width - fFar * far.width - near.width;
    if (Math.abs(seam - GAP) > 1.5) return false;
  }
  return true;
}

/** Assert every invariant at one point of the space. */
function assertInvariants(
  input: AllocatorInput,
  fixture: RailFixture,
  where: string,
): RailWidths {
  const sides = sidesOf(input.rails);
  const widths = allocateSidebarWidths(input);

  // 1 — totality.
  expect(widths, `${where}: a standing rail is always answered for`).not.toBeNull();
  const answer = widths as RailWidths;

  for (const side of sides) {
    const policy = input.rails[side] as RailPolicy;
    const bounds = boundsOf(policy);
    const width = answer[side];
    expect(typeof width, `${where}: ${side} is answered`).toBe("number");

    // 2 — bounds.
    expect(width as number).toBeGreaterThanOrEqual(bounds.floor);
    expect(width as number).toBeLessThanOrEqual(bounds.ceiling);

    // 6 — a stacked rail clears every member's floor.
    for (const floor of fixture.memberFloors[side] ?? []) {
      expect(width as number).toBeGreaterThanOrEqual(floor);
    }
  }

  // 3 — greed soundness, both directions.
  for (const near of sides) {
    for (const far of sides) {
      const greedy = input.rails[near] as RailPolicy;
      const modest = input.rails[far] as RailPolicy;
      if (greedy.greedRank >= modest.greedRank) continue;
      const greedyBounds = boundsOf(greedy);
      const modestBounds = boundsOf(modest);
      const greedyWidth = answer[near] as number;
      const modestWidth = answer[far] as number;
      if (modestWidth > modestBounds.preferred) {
        expect(
          greedyWidth,
          `${where}: ${far} grew past its preference, so ${near} must be at its ceiling`,
        ).toBe(greedyBounds.ceiling);
      }
      if (greedyWidth < greedyBounds.preferred) {
        expect(
          modestWidth,
          `${where}: ${near} gave width, so ${far} must be at its floor`,
        ).toBe(modestBounds.floor);
      }
    }
  }

  // 4 — tiling: when the target is reachable and the chain admits an exact
  // fit, the answer produces one. The allowance is the rounding residual the
  // solver deliberately leaves with the band's travel.
  const bounds = sides.map((side) => boundsOf(input.rails[side] as RailPolicy));
  const floorTotal = bounds.reduce((sum, b) => sum + b.floor, 0);
  const ceilingTotal = bounds.reduce((sum, b) => sum + b.ceiling, 0);
  const solved = solveSidebarWidths(input);
  if (
    solved !== null &&
    solved >= floorTotal &&
    solved <= ceilingTotal &&
    chainTilesExactly(input, answer)
  ) {
    const picture = seamPicture(input, answer);
    const allowance = 2 + sides.length;
    expect(picture.worstError, `${where}: a reachable exact fit tiles`).toBeLessThanOrEqual(
      allowance,
    );
    expect(picture.worstOverlap).toBeLessThanOrEqual(allowance);
  }

  // 7 — tie fairness: equal ranks with equal bounds get equal widths.
  if (sides.length === 2) {
    const left = input.rails.left as RailPolicy;
    const right = input.rails.right as RailPolicy;
    const leftBounds = boundsOf(left);
    const rightBounds = boundsOf(right);
    if (
      left.greedRank === right.greedRank &&
      leftBounds.floor === rightBounds.floor &&
      leftBounds.ceiling === rightBounds.ceiling &&
      leftBounds.preferred === rightBounds.preferred
    ) {
      expect(
        Math.abs((answer.left as number) - (answer.right as number)),
        `${where}: tied rails with equal bounds split evenly`,
      ).toBeLessThanOrEqual(1);
    }
  }

  return answer;
}

/* ---------------------------------------------------------------------------
 * The sweep
 * ---------------------------------------------------------------------------*/

describe("the allocator's solution space", () => {
  test("every invariant holds at every point of the enumeration", () => {
    let points = 0;
    for (const kind of IMPOSITION_KINDS) {
      for (const occupancy of occupanciesFor(kind)) {
        for (const fixture of RAIL_FIXTURES) {
          const base: AllocatorInput = {
            canvasWidth: 0,
            kind,
            occupied: occupancy.occupied,
            rails: fixture.rails,
            maxRailWidth: CEILING,
          };
          const canvases = [
            ...new Set([
              ...SWEEP,
              ...breakpointCanvases({ ...base, canvasWidth: 2000 }),
            ]),
          ]
            .filter((canvas) => canvas > 0)
            .sort((a, b) => a - b);

          const previous: RailWidths = {};
          for (const canvasWidth of canvases) {
            const where = `${kind}/${occupancy.name}/${fixture.name}@${canvasWidth}`;
            const answer = assertInvariants(
              { ...base, canvasWidth },
              fixture,
              where,
            );
            // 5 — monotonicity in canvas width, per rail.
            for (const side of sidesOf(fixture.rails)) {
              const was = previous[side];
              if (was !== undefined) {
                expect(
                  answer[side] as number,
                  `${where}: ${side} never narrows as the canvas grows`,
                ).toBeGreaterThanOrEqual(was);
              }
              previous[side] = answer[side];
            }
            points += 1;
          }
        }
      }
    }
    // The enumeration is the assertion; this pins that it actually ran the
    // space rather than an empty loop.
    expect(points).toBeGreaterThan(50_000);
  });

  test("no rail standing is the only shape with no answer", () => {
    for (const kind of IMPOSITION_KINDS) {
      for (const occupancy of occupanciesFor(kind).slice(0, 4)) {
        expect(
          allocateSidebarWidths({
            canvasWidth: 1600,
            kind,
            occupied: occupancy.occupied,
            rails: {},
            maxRailWidth: CEILING,
          }),
        ).toBeNull();
      }
    }
  });
});

/* ---------------------------------------------------------------------------
 * The golden table
 * ---------------------------------------------------------------------------*/

const GOLDEN_PATH = join(import.meta.dir, "golden", "imposer-solutions.json");

interface GoldenRow {
  config: string;
  canvas: number;
  left: number | null;
  right: number | null;
}

/** The representative slice: every rail fixture × every kind, at one
 *  occupancy each (all slots, comfy — the shape a full deck actually stands
 *  in), across that configuration's own breakpoints. */
function goldenRows(): GoldenRow[] {
  const rows: GoldenRow[] = [];
  for (const kind of IMPOSITION_KINDS) {
    const slots = slotCount(kind);
    const occupied = Array.from({ length: slots }, (_, slot) => ({
      slot,
      width: CONTENT_WIDTH_COMFY_PX,
    }));
    for (const fixture of RAIL_FIXTURES) {
      const base: AllocatorInput = {
        canvasWidth: 2000,
        kind,
        occupied,
        rails: fixture.rails,
        maxRailWidth: CEILING,
      };
      const canvases = [...new Set(breakpointCanvases(base))]
        .filter((canvas) => canvas > 0)
        .sort((a, b) => a - b);
      for (const canvas of canvases.length > 0 ? canvases : [2000]) {
        const answer = allocateSidebarWidths({ ...base, canvasWidth: canvas });
        rows.push({
          config: `${kind}/${fixture.name}`,
          canvas,
          left: answer?.left ?? null,
          right: answer?.right ?? null,
        });
      }
    }
  }
  return rows.sort((a, b) =>
    a.config === b.config
      ? a.canvas - b.canvas
      : a.config < b.config
        ? -1
        : 1,
  );
}

describe("the golden table", () => {
  test("the checked-in table is what the solver produces", () => {
    const rows = goldenRows();
    const serialized = `${JSON.stringify(rows, null, 2)}\n`;
    if (process.env.IMPOSER_GOLDEN_UPDATE === "1") {
      writeFileSync(GOLDEN_PATH, serialized);
    }
    const golden = readFileSync(GOLDEN_PATH, "utf8");
    expect(
      serialized,
      "the solver's answers moved — review the diff, then regenerate with IMPOSER_GOLDEN_UPDATE=1",
    ).toBe(golden);
  });
});
