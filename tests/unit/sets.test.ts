import { describe, expect, it } from "vitest";
import {
  differingBits,
  generateInsertVariants,
  orderingCode,
  pairKey,
  transitionsToWrite,
  variantLetter,
} from "@/domain/sets";

describe("generateInsertVariants (Rule 7.9)", () => {
  const names = { a: "Opener: the flight in", b: "Airport security", c: "Hotel pillows", d: "Dad's texts" };
  it("inserts d into [a,b,c] at every position", () => {
    const v = generateInsertVariants(["a", "b", "c"], "d", names);
    expect(v.map((x) => x.bitIds)).toEqual([
      ["d", "a", "b", "c"],
      ["a", "d", "b", "c"],
      ["a", "b", "d", "c"],
      ["a", "b", "c", "d"],
    ]);
    expect(v.map((x) => x.letter)).toEqual(["A", "B", "C", "D"]);
    expect(v.map((x) => x.description)).toEqual([
      "Open with it",
      "After Opener: the flight in",
      "After Airport security",
      "Put it last",
    ]);
    expect(v.map((x) => orderingCode(["a", "b", "c"], x.bitIds))).toEqual(["d a b c", "a d b c", "a b d c", "a b c d"]);
  });
  it("empty base yields a single 'Open with it' variant", () => {
    expect(generateInsertVariants([], "d", names)).toEqual([{ letter: "A", description: "Open with it", bitIds: ["d"] }]);
  });
});

describe("variantLetter", () => {
  it("goes A…Z, AA, AB", () => {
    expect(variantLetter(0)).toBe("A");
    expect(variantLetter(25)).toBe("Z");
    expect(variantLetter(26)).toBe("AA");
    expect(variantLetter(27)).toBe("AB");
  });
});

describe("transitions", () => {
  it("counts gaps without a library row", () => {
    const lib = new Map([[pairKey("a", "b"), "written" as const], [pairKey("c", "d"), "hard_cut" as const]]);
    expect(transitionsToWrite(["a", "b", "c", "d"], lib)).toBe(1);
    expect(transitionsToWrite(["a", "d", "b", "c"], lib)).toBe(3);
  });
  it("reports differing bits", () => {
    expect(differingBits(["a", "b", "c"], ["a", "d", "b", "c"])).toEqual(["b", "c", "d"]);
  });
});
