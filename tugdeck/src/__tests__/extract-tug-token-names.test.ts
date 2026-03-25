import { describe, expect, it } from "bun:test";

import { extractTokenNames } from "../../scripts/extract-tug-token-names";

describe("extract tug token names (thin)", () => {
  it("extracts declaration names, ignoring comments and value-side references", () => {
    const css = `
      /* --tug-commented: #000000; */
      body {
        --tug-alpha: #112233;
        --tug-beta: var(--tug-alpha);
        color: var(--tug-alpha);
        --other-token: #fff;
      }
      .x { border-color: var(--tug-beta); }
    `;

    const names = extractTokenNames(css);
    expect(names).toEqual(["--tug-alpha", "--tug-beta"]);
  });
});
