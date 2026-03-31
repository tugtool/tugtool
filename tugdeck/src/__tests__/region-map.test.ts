import { describe, it, expect } from "bun:test";
import { RegionMap } from "../lib/region-map";

describe("RegionMap", () => {
  describe("empty state", () => {
    it("text is empty string", () => {
      const map = new RegionMap();
      expect(map.text).toBe("");
    });

    it("regionCount is 0", () => {
      const map = new RegionMap();
      expect(map.regionCount).toBe(0);
    });

    it("keys is empty array", () => {
      const map = new RegionMap();
      expect(map.keys).toEqual([]);
    });
  });

  describe("setRegion — insert new region", () => {
    it("adds a region and updates text", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.text).toBe("hello");
      expect(map.regionCount).toBe(1);
      expect(map.keys).toEqual(["a"]);
    });

    it("appends new regions in insertion order", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("b", "world");
      expect(map.regionCount).toBe(2);
      expect(map.keys).toEqual(["a", "b"]);
    });

    it("concatenates multiple regions with \\n\\n separators", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("b", "world");
      expect(map.text).toBe("hello\n\nworld");
    });

    it("concatenates three regions with \\n\\n separators", () => {
      const map = new RegionMap();
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      expect(map.text).toBe("alpha\n\nbeta\n\ngamma");
      expect(map.regionCount).toBe(3);
      expect(map.keys).toEqual(["a", "b", "c"]);
    });
  });

  describe("setRegion — update existing region", () => {
    it("updates text in place without changing order", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("b", "world");
      map.setRegion("a", "goodbye");
      expect(map.keys).toEqual(["a", "b"]);
      expect(map.regionCount).toBe(2);
      expect(map.text).toBe("goodbye\n\nworld");
    });

    it("updating last region reflects in concatenated text", () => {
      const map = new RegionMap();
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("b", "beta updated");
      expect(map.text).toBe("alpha\n\nbeta updated");
    });

    it("updating middle region reflects in concatenated text", () => {
      const map = new RegionMap();
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      map.setRegion("b", "BETA");
      expect(map.text).toBe("alpha\n\nBETA\n\ngamma");
      expect(map.keys).toEqual(["a", "b", "c"]);
    });
  });

  describe("removeRegion", () => {
    it("removes an existing region and updates text", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("b", "world");
      map.removeRegion("a");
      expect(map.regionCount).toBe(1);
      expect(map.keys).toEqual(["b"]);
      expect(map.text).toBe("world");
    });

    it("removes the last region leaving empty state", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.removeRegion("a");
      expect(map.regionCount).toBe(0);
      expect(map.keys).toEqual([]);
      expect(map.text).toBe("");
    });

    it("no-op for missing key", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.removeRegion("nonexistent");
      expect(map.regionCount).toBe(1);
      expect(map.text).toBe("hello");
    });

    it("no-op on empty map", () => {
      const map = new RegionMap();
      map.removeRegion("nonexistent");
      expect(map.regionCount).toBe(0);
      expect(map.text).toBe("");
    });

    it("removes middle region and re-concatenates correctly", () => {
      const map = new RegionMap();
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      map.removeRegion("b");
      expect(map.keys).toEqual(["a", "c"]);
      expect(map.text).toBe("alpha\n\ngamma");
    });
  });

  describe("clear", () => {
    it("resets everything to empty", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("b", "world");
      map.clear();
      expect(map.text).toBe("");
      expect(map.regionCount).toBe(0);
      expect(map.keys).toEqual([]);
    });

    it("can add regions after clear", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.clear();
      map.setRegion("b", "fresh");
      expect(map.text).toBe("fresh");
      expect(map.regionCount).toBe(1);
      expect(map.keys).toEqual(["b"]);
    });
  });

  describe("getRegionText", () => {
    it("returns correct text for an existing key", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.getRegionText("a")).toBe("hello");
    });

    it("returns undefined for a missing key", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.getRegionText("nonexistent")).toBeUndefined();
    });

    it("returns updated text after setRegion", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("a", "goodbye");
      expect(map.getRegionText("a")).toBe("goodbye");
    });
  });

  describe("hasRegion", () => {
    it("returns true for an existing key", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.hasRegion("a")).toBe(true);
    });

    it("returns false for a missing key", () => {
      const map = new RegionMap();
      expect(map.hasRegion("nonexistent")).toBe(false);
    });

    it("returns false after removing a region", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.removeRegion("a");
      expect(map.hasRegion("a")).toBe(false);
    });
  });

  describe("regionKeyAtOffset", () => {
    it("returns undefined for empty map", () => {
      const map = new RegionMap();
      expect(map.regionKeyAtOffset(0)).toBeUndefined();
    });

    it("returns the only region key for single-region map", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.regionKeyAtOffset(0)).toBe("a");
      expect(map.regionKeyAtOffset(4)).toBe("a");
    });

    it("returns correct key for offset in first region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta" — "alpha" is [0,5), separator is [5,7), "beta" is [7,11)
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      expect(map.regionKeyAtOffset(0)).toBe("a");
      expect(map.regionKeyAtOffset(4)).toBe("a");
    });

    it("returns correct key for offset in last region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta" — "beta" starts at offset 7
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      expect(map.regionKeyAtOffset(7)).toBe("b");
      expect(map.regionKeyAtOffset(10)).toBe("b");
    });

    it("returns correct key for offset in middle region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta\n\ngamma"
      // "alpha" = [0,5), sep [5,7), "beta" = [7,11), sep [11,13), "gamma" = [13,18)
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      expect(map.regionKeyAtOffset(7)).toBe("b");
      expect(map.regionKeyAtOffset(10)).toBe("b");
    });

    it("returns correct key at separator boundary — separator belongs to next region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta" — offset 5 is '\n' of the separator, which is >= region "b"'s start (7)? No.
      // region "a" starts at 0, region "b" starts at 7.
      // offset 5 is still >= 0 (a's start) and < 7 (b's start), so it returns "a".
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      expect(map.regionKeyAtOffset(5)).toBe("a");
      expect(map.regionKeyAtOffset(6)).toBe("a");
    });

    it("returns 'b' when offset equals start of second region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta" — "beta" starts at offset 7
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      expect(map.regionKeyAtOffset(7)).toBe("b");
    });
  });

  describe("regionRange", () => {
    it("returns undefined for a missing key", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.regionRange("nonexistent")).toBeUndefined();
    });

    it("returns correct range for single region", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      expect(map.regionRange("a")).toEqual({ start: 0, end: 5 });
    });

    it("returns correct range for first region in multi-region map", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta\n\ngamma"
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      expect(map.regionRange("a")).toEqual({ start: 0, end: 5 });
    });

    it("returns correct range for middle region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta\n\ngamma"
      // "beta" starts at 7, length 4, ends at 11
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      expect(map.regionRange("b")).toEqual({ start: 7, end: 11 });
    });

    it("returns correct range for last region", () => {
      const map = new RegionMap();
      // "alpha\n\nbeta\n\ngamma"
      // "gamma" starts at 13, length 5, ends at 18
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      expect(map.regionRange("c")).toEqual({ start: 13, end: 18 });
    });

    it("range end does not include separator", () => {
      const map = new RegionMap();
      map.setRegion("a", "hello");
      map.setRegion("b", "world");
      // "hello\n\nworld" — "hello" is [0,5), separator is "world" start minus 2
      const range = map.regionRange("a");
      expect(range).toEqual({ start: 0, end: 5 });
      // Verify the text at that range is the region text
      expect(map.text.slice(range!.start, range!.end)).toBe("hello");
    });

    it("regionRange end slices correct text from concatenation", () => {
      const map = new RegionMap();
      map.setRegion("a", "alpha");
      map.setRegion("b", "beta");
      map.setRegion("c", "gamma");
      const rangeA = map.regionRange("a")!;
      const rangeB = map.regionRange("b")!;
      const rangeC = map.regionRange("c")!;
      expect(map.text.slice(rangeA.start, rangeA.end)).toBe("alpha");
      expect(map.text.slice(rangeB.start, rangeB.end)).toBe("beta");
      expect(map.text.slice(rangeC.start, rangeC.end)).toBe("gamma");
    });
  });

  describe("multiple operations sequence", () => {
    it("insert three, update middle, remove first — final state is correct", () => {
      const map = new RegionMap();

      // Insert three regions
      map.setRegion("msg1", "First message");
      map.setRegion("msg2", "Second message");
      map.setRegion("msg3", "Third message");

      expect(map.regionCount).toBe(3);
      expect(map.keys).toEqual(["msg1", "msg2", "msg3"]);
      expect(map.text).toBe("First message\n\nSecond message\n\nThird message");

      // Update middle region
      map.setRegion("msg2", "Second message (updated)");

      expect(map.regionCount).toBe(3);
      expect(map.keys).toEqual(["msg1", "msg2", "msg3"]);
      expect(map.text).toBe(
        "First message\n\nSecond message (updated)\n\nThird message"
      );
      expect(map.getRegionText("msg2")).toBe("Second message (updated)");

      // Remove first region
      map.removeRegion("msg1");

      expect(map.regionCount).toBe(2);
      expect(map.keys).toEqual(["msg2", "msg3"]);
      expect(map.text).toBe("Second message (updated)\n\nThird message");
      expect(map.hasRegion("msg1")).toBe(false);
      expect(map.hasRegion("msg2")).toBe(true);
      expect(map.hasRegion("msg3")).toBe(true);

      // Verify ranges are updated after removal
      const rangeMsg2 = map.regionRange("msg2")!;
      const rangeMsg3 = map.regionRange("msg3")!;
      expect(map.text.slice(rangeMsg2.start, rangeMsg2.end)).toBe(
        "Second message (updated)"
      );
      expect(map.text.slice(rangeMsg3.start, rangeMsg3.end)).toBe(
        "Third message"
      );
    });
  });
});
