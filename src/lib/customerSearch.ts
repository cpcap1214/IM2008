/**
 * Customer-name fuzzy matching used by the order entry form to surface
 * existing customers as the boss types — the core抓手 for preventing
 * duplicate entities like "永大營造" vs "永大營造公司" sneaking into the DB.
 *
 * The functions are pure so they can be unit-tested without React.
 */

export type CustomerSuggestion = {
  /** Display name as it appears in `Users` or on existing orders. */
  name: string
  /** Bound `customerId` (LINE UID) if known, otherwise null for ghost customers. */
  id: string | null
}

export type RankedCustomer = {
  suggestion: CustomerSuggestion
  score: number
}

const TRIVIAL_SUFFIXES = [
  "股份有限公司",
  "有限公司",
  "公司",
  "工程行",
  "營造",
  "建設",
  "Co.",
  "Co",
  "Ltd.",
  "Ltd",
  "Inc.",
  "Inc",
]

/**
 * Normalize a customer name to a stable key for equality / similarity checks:
 * lower-case, drop whitespace, drop common corporate suffixes. The suffix
 * stripping is what catches "永大營造" vs "永大營造公司" — after normalization
 * both reduce to "永大".
 */
export function normalizeCustomerKey(raw: string): string {
  let s = raw.trim().toLocaleLowerCase().replace(/\s+/g, "")
  // Strip trivial suffixes from the right, longest first.
  const suffixes = [...TRIVIAL_SUFFIXES].sort((a, b) => b.length - a.length)
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of suffixes) {
      const lowered = suffix.toLocaleLowerCase()
      if (s.endsWith(lowered) && s.length > lowered.length) {
        s = s.slice(0, -lowered.length)
        changed = true
        break
      }
    }
  }
  return s
}

/**
 * Score how closely a typed query matches an existing customer name.
 * 100 = exact, 80 = prefix, 60 = substring, 50 = query is a superstring
 * of the candidate (catches "永大營造公司" → "永大營造"), 0–40 = partial
 * character overlap. Anything ≥ 50 is treated as a "near match" worth
 * warning the user about.
 */
export function scoreCustomerMatch(query: string, candidate: string): number {
  const q = query.trim().toLocaleLowerCase().replace(/\s+/g, "")
  const c = candidate.trim().toLocaleLowerCase().replace(/\s+/g, "")
  if (!q || !c) return 0
  if (q === c) return 100

  const qk = normalizeCustomerKey(query)
  const ck = normalizeCustomerKey(candidate)
  if (qk && ck && qk === ck) return 95 // matches after suffix stripping

  if (c.startsWith(q)) return 80
  if (c.includes(q)) return 60
  if (q.includes(c)) return 50

  // Character-overlap fallback for typos / re-ordered tokens.
  const qChars = new Set(q)
  let overlap = 0
  for (const ch of qChars) if (c.includes(ch)) overlap++
  return Math.round((overlap / qChars.size) * 40)
}

/**
 * Rank suggestions by match score (descending). Suggestions with score
 * below `minScore` are dropped. Ties break alphabetically (zh-Hant collation)
 * so the UI is deterministic.
 */
export function rankCustomers(
  query: string,
  suggestions: CustomerSuggestion[],
  minScore = 30,
): RankedCustomer[] {
  const ranked = suggestions
    .map((suggestion) => ({
      suggestion,
      score: scoreCustomerMatch(query, suggestion.name),
    }))
    .filter((r) => r.score >= minScore)
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.suggestion.name.localeCompare(b.suggestion.name, "zh-Hant")
  })
  return ranked
}

/**
 * True iff the trimmed `query` exactly matches some suggestion's name
 * (case-insensitive, whitespace-collapsed). When this is true, the form
 * is "aligned" with the existing entity — no warning should fire.
 */
export function hasExactMatch(
  query: string,
  suggestions: CustomerSuggestion[],
): boolean {
  const q = query.trim().toLocaleLowerCase().replace(/\s+/g, "")
  if (!q) return false
  return suggestions.some(
    (s) => s.name.trim().toLocaleLowerCase().replace(/\s+/g, "") === q,
  )
}

/**
 * Suggestions that are similar to the query but not exactly equal — these
 * are what we warn the boss about so they pick the existing entity rather
 * than creating a near-duplicate.
 */
export function nearMatchSuggestions(
  query: string,
  suggestions: CustomerSuggestion[],
  threshold = 50,
  limit = 3,
): CustomerSuggestion[] {
  if (!query.trim()) return []
  if (hasExactMatch(query, suggestions)) return []
  return rankCustomers(query, suggestions, threshold)
    .slice(0, limit)
    .map((r) => r.suggestion)
}
