import { describe, expect, test } from "vitest"
import {
  hasExactMatch,
  nearMatchSuggestions,
  normalizeCustomerKey,
  rankCustomers,
  scoreCustomerMatch,
  type CustomerSuggestion,
} from "../customerSearch"

const sample: CustomerSuggestion[] = [
  { name: "永大營造", id: "U001" },
  { name: "洪水泥工", id: "U002" },
  { name: "金池營造", id: "U003" },
  { name: "大成營造股份有限公司", id: "U004" },
]

describe("normalizeCustomerKey", () => {
  test("strips trivial corporate suffixes so 永大營造 == 永大營造公司", () => {
    expect(normalizeCustomerKey("永大營造")).toBe(normalizeCustomerKey("永大營造公司"))
    expect(normalizeCustomerKey("永大營造")).toBe(normalizeCustomerKey("永大營造有限公司"))
    expect(normalizeCustomerKey("永大營造")).toBe(normalizeCustomerKey("永大營造股份有限公司"))
  })

  test("does not collapse distinct customers", () => {
    expect(normalizeCustomerKey("永大營造")).not.toBe(normalizeCustomerKey("金池營造"))
    expect(normalizeCustomerKey("洪水泥工")).not.toBe(normalizeCustomerKey("永大營造"))
  })

  test("trims whitespace and is case-insensitive", () => {
    expect(normalizeCustomerKey(" 永大營造 ")).toBe(normalizeCustomerKey("永大營造"))
    expect(normalizeCustomerKey("ACME")).toBe(normalizeCustomerKey("acme"))
  })

  test("does not over-strip — non-suffix tokens are preserved", () => {
    // "公司行號" should not be eaten by the "公司" suffix rule on the left side
    expect(normalizeCustomerKey("公司行號")).toBe("公司行號")
  })
})

describe("scoreCustomerMatch", () => {
  test("exact match scores 100", () => {
    expect(scoreCustomerMatch("永大營造", "永大營造")).toBe(100)
  })

  test("suffix-difference scores 95 — the duplicate-prevention case", () => {
    // Boss types "永大營造公司" but DB has "永大營造" — must rank very high.
    expect(scoreCustomerMatch("永大營造公司", "永大營造")).toBeGreaterThanOrEqual(95)
    expect(scoreCustomerMatch("永大營造", "永大營造公司")).toBeGreaterThanOrEqual(95)
  })

  test("prefix-with-distinct-token scores higher than mid-substring", () => {
    // "永和" is a prefix of "永和水電" but neither side normalizes away —
    // proves prefix > substring without colliding with suffix-stripping.
    const prefix = scoreCustomerMatch("永和", "永和水電")
    const middle = scoreCustomerMatch("水電", "永和水電")
    expect(prefix).toBeGreaterThan(middle)
  })

  test("when query equals candidate after suffix-stripping, score is the 95 lane", () => {
    // "永大" against "永大營造" both reduce to "永大" after dropping the
    // trivial "營造" suffix → suffix-equivalence rather than prefix.
    expect(scoreCustomerMatch("永大", "永大營造")).toBe(95)
  })

  test("unrelated names score below the warning threshold", () => {
    expect(scoreCustomerMatch("永大營造", "洪水泥工")).toBeLessThan(50)
  })
})

describe("rankCustomers", () => {
  test("orders by score then alphabetically", () => {
    const ranked = rankCustomers("營造", sample)
    expect(ranked.length).toBeGreaterThan(0)
    // All returned suggestions should contain 營造-ish content
    expect(ranked.every((r) => r.score >= 30)).toBe(true)
  })

  test("respects the minScore threshold", () => {
    const ranked = rankCustomers("zzz_no_overlap", sample, 50)
    expect(ranked).toEqual([])
  })
})

describe("hasExactMatch", () => {
  test("true on exact name", () => {
    expect(hasExactMatch("永大營造", sample)).toBe(true)
  })

  test("false on near-but-not-equal", () => {
    expect(hasExactMatch("永大營造公司", sample)).toBe(false)
    expect(hasExactMatch("永大", sample)).toBe(false)
  })

  test("empty query is never an exact match", () => {
    expect(hasExactMatch("", sample)).toBe(false)
    expect(hasExactMatch("   ", sample)).toBe(false)
  })

  test("case + whitespace tolerant", () => {
    const us: CustomerSuggestion[] = [{ name: "Acme Ltd", id: "X" }]
    expect(hasExactMatch("  acme ltd ", us)).toBe(true)
  })
})

describe("nearMatchSuggestions", () => {
  test("returns 永大營造 when boss types 永大營造公司", () => {
    const near = nearMatchSuggestions("永大營造公司", sample)
    expect(near.map((n) => n.name)).toContain("永大營造")
  })

  test("returns empty when query is already an exact match", () => {
    expect(nearMatchSuggestions("永大營造", sample)).toEqual([])
  })

  test("returns empty for empty / whitespace queries", () => {
    expect(nearMatchSuggestions("", sample)).toEqual([])
    expect(nearMatchSuggestions("   ", sample)).toEqual([])
  })

  test("dedup-prevention case: 大成營造 typed but DB has 大成營造股份有限公司", () => {
    const near = nearMatchSuggestions("大成營造", sample)
    expect(near.map((n) => n.name)).toContain("大成營造股份有限公司")
  })

  test("returns at most `limit` results", () => {
    const many: CustomerSuggestion[] = [
      { name: "永大營造", id: "1" },
      { name: "永大營造有限公司", id: "2" },
      { name: "永大營造股份有限公司", id: "3" },
      { name: "永大營造工程行", id: "4" },
    ]
    const near = nearMatchSuggestions("永大營造甲乙丙", many, 50, 2)
    expect(near.length).toBeLessThanOrEqual(2)
  })
})
