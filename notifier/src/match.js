// Filter normalisation and matching. Semantics mirror the site's facets
// (docs/assets/app.js matchesFacets): values within a category are OR'd,
// categories are AND'd, and an empty category matches everything. The free-text
// query is stricter than the site's fuzzy search: every word must appear.

const FACETS = [
  ["journal", "journal_short"],
  ["method", "method_tags"],
  ["data_type", "data_type_tags"],
];
const MAX_VALUES = 50;
const MAX_VALUE_LEN = 100;
const MAX_QUERY_LEN = 200;

// Returns canonical filters, or throws with a user-facing message.
export function normalizeFilters(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const [key] of FACETS) {
    const vals = input[key] ?? [];
    if (!Array.isArray(vals) || vals.length > MAX_VALUES) throw new Error(`Invalid ${key} filter.`);
    const clean = vals.map((v) => {
      if (typeof v !== "string" || !v.trim() || v.length > MAX_VALUE_LEN) throw new Error(`Invalid ${key} filter.`);
      return v.trim();
    });
    out[key] = [...new Set(clean)].sort();
  }
  const q = typeof input.q === "string" ? input.q.trim().replace(/\s+/g, " ") : "";
  if (q.length > MAX_QUERY_LEN) throw new Error("Search text is too long.");
  out.q = q;
  return out;
}

export function matches(filters, record) {
  for (const [key, field] of FACETS) {
    const wanted = filters[key];
    if (!wanted.length) continue;
    const have = Array.isArray(record[field]) ? record[field] : [record[field]];
    if (!have.some((v) => wanted.includes(v))) return false;
  }
  if (filters.q) {
    const haystack = [
      record.title,
      record.description,
      ...(record.keywords || []),
      ...(record.authors || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const term of filters.q.toLowerCase().split(" ")) {
      if (!haystack.includes(term)) return false;
    }
  }
  return true;
}

export function describeFilters(filters) {
  const parts = [];
  if (filters.journal.length) parts.push(`Journal: ${filters.journal.join(" or ")}`);
  if (filters.method.length) parts.push(`Method: ${filters.method.join(" or ")}`);
  if (filters.data_type.length) parts.push(`Data type: ${filters.data_type.join(" or ")}`);
  if (filters.q) parts.push(`Text: "${filters.q}"`);
  return parts.length ? parts.join("; ") : "All new replication packages";
}
