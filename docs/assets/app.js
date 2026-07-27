const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 200;

const state = {
  records: [],
  journals: [],
  fuse: null,
  query: "",
  activeFacets: { journal_short: new Set(), method_tags: new Set(), data_type_tags: new Set() },
  yearMin: null,
  yearMax: null,
  sort: "relevance",
  visibleCount: PAGE_SIZE,
};

const el = (id) => document.getElementById(id);

async function init() {
  const results = el("results");
  results.innerHTML = `<p class="loading-state">Loading replication packages…</p>`;

  let payload;
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    results.innerHTML = `<div class="error-state">The index could not be loaded. Please refresh the page or
      <a href="https://github.com/jsakowuah/polisci-replication/issues">report the problem</a>.</div>`;
    return;
  }

  state.records = payload.records;
  state.journals = payload.journals || [];

  const years = state.records.map((r) => r.year).filter((y) => Number.isFinite(y));
  state.dataYearMin = Math.min(...years);
  state.dataYearMax = Math.max(...years);

  el("last-refreshed").textContent = `Index last refreshed: ${formatDate(payload.generated_at)}`;
  renderStats(payload, years);

  state.fuse = new Fuse(state.records, {
    keys: [
      { name: "title", weight: 0.35 },
      { name: "description", weight: 0.25 },
      { name: "keywords", weight: 0.2 },
      { name: "authors", weight: 0.15 },
      { name: "doi", weight: 0.05 },
    ],
    threshold: 0.32,
    ignoreLocation: true,
  });

  const journalNames = new Map(state.journals.map((j) => [j.short, j.name]));
  buildFacet("facet-journal", "journal_short", collectValues(state.records, "journal_short"), journalNames);
  buildFacet("facet-method", "method_tags", collectValues(state.records, "method_tags", true));
  buildFacet("facet-data_type", "data_type_tags", collectValues(state.records, "data_type_tags", true));
  renderJournalsLegend(state.journals);

  el("year-from").placeholder = String(state.dataYearMin);
  el("year-to").placeholder = String(state.dataYearMax);

  applyStateFromUrl();
  syncControlsToState();

  let debounceHandle;
  el("search-box").addEventListener("input", (e) => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      state.query = e.target.value.trim();
      state.visibleCount = PAGE_SIZE;
      render();
      syncUrlFromState();
    }, SEARCH_DEBOUNCE_MS);
  });

  el("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
    syncUrlFromState();
  });

  el("year-from").addEventListener("change", (e) => {
    state.yearMin = e.target.value ? Number(e.target.value) : null;
    state.visibleCount = PAGE_SIZE;
    render();
    syncUrlFromState();
  });

  el("year-to").addEventListener("change", (e) => {
    state.yearMax = e.target.value ? Number(e.target.value) : null;
    state.visibleCount = PAGE_SIZE;
    render();
    syncUrlFromState();
  });

  el("clear-filters").addEventListener("click", () => {
    state.query = "";
    state.yearMin = null;
    state.yearMax = null;
    state.sort = "relevance";
    state.visibleCount = PAGE_SIZE;
    for (const set of Object.values(state.activeFacets)) set.clear();
    syncControlsToState();
    render();
    syncUrlFromState();
  });

  el("load-more").addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    render();
  });

  window.addEventListener("popstate", () => {
    applyStateFromUrl();
    syncControlsToState();
    render();
  });

  render();
}

function renderStats(payload, years) {
  const statsEl = el("stats-bar");
  if (!statsEl) return;
  const count = state.records.length.toLocaleString();
  const journalCount = state.journals.length;
  const yearMin = Math.min(...years);
  const yearMax = Math.max(...years);
  statsEl.innerHTML = `
    <span><strong>${count}</strong> packages</span>
    <span><strong>${journalCount}</strong> journals</span>
    <span><strong>${yearMin}–${yearMax}</strong></span>
  `;
}

function collectValues(records, field, isArray = false) {
  const counts = new Map();
  for (const r of records) {
    const vals = isArray ? r[field] || [] : [r[field]];
    for (const v of vals) {
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function buildFacet(containerId, field, valuesWithCounts, labelMap = null) {
  const container = el(containerId);
  container.innerHTML = "";
  for (const [value, count] of valuesWithCounts) {
    const chip = document.createElement("label");
    chip.className = "facet-chip";
    const displayLabel = labelMap && labelMap.has(value) ? `${value} — ${labelMap.get(value)}` : value;
    if (labelMap && labelMap.has(value)) {
      chip.title = labelMap.get(value);
    }
    chip.innerHTML = `<input type="checkbox" value="${escapeHtml(value)}" /> ${escapeHtml(displayLabel)} (${count})`;
    const checkbox = chip.querySelector("input");
    checkbox.addEventListener("change", () => {
      const set = state.activeFacets[field];
      if (checkbox.checked) {
        set.add(value);
        chip.classList.add("active");
      } else {
        set.delete(value);
        chip.classList.remove("active");
      }
      state.visibleCount = PAGE_SIZE;
      render();
      syncUrlFromState();
    });
    container.appendChild(chip);
  }
}

function renderJournalsLegend(journals) {
  const container = el("journals-legend-list");
  const countEl = el("journals-legend-count");
  if (!container) return;

  const sorted = [...journals].sort((a, b) => a.short.localeCompare(b.short));
  if (countEl) countEl.textContent = sorted.length;
  container.innerHTML = sorted
    .map((j) => `<div class="journal-entry"><strong>${escapeHtml(j.short)}</strong> ${escapeHtml(j.name)}</div>`)
    .join("");
}

function matchesFacets(record) {
  const { journal_short, method_tags, data_type_tags } = state.activeFacets;
  if (journal_short.size > 0 && !journal_short.has(record.journal_short)) return false;
  if (method_tags.size > 0 && !(record.method_tags || []).some((t) => method_tags.has(t))) return false;
  if (data_type_tags.size > 0 && !(record.data_type_tags || []).some((t) => data_type_tags.has(t))) return false;
  if (state.yearMin != null && (record.year == null || record.year < state.yearMin)) return false;
  if (state.yearMax != null && (record.year == null || record.year > state.yearMax)) return false;
  return true;
}

function sortRecords(records) {
  if (state.sort === "newest") return [...records].sort((a, b) => (b.year || 0) - (a.year || 0));
  if (state.sort === "oldest") return [...records].sort((a, b) => (a.year || 0) - (b.year || 0));
  return records;
}

function render() {
  const base = state.query
    ? state.fuse.search(state.query).map((r) => r.item)
    : state.records;
  const filtered = sortRecords(base.filter(matchesFacets));

  el("result-count").textContent = `${filtered.length.toLocaleString()} result${filtered.length === 1 ? "" : "s"}`;

  const container = el("results");
  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches. Try a broader search or clear some filters.</p>`;
    el("load-more").hidden = true;
    return;
  }

  const toShow = filtered.slice(0, state.visibleCount);
  for (const r of toShow) {
    container.appendChild(renderCard(r));
  }

  const loadMoreBtn = el("load-more");
  if (filtered.length > toShow.length) {
    loadMoreBtn.hidden = false;
    loadMoreBtn.textContent = `Showing ${toShow.length.toLocaleString()} of ${filtered.length.toLocaleString()} — load ${Math.min(PAGE_SIZE, filtered.length - toShow.length)} more`;
  } else {
    loadMoreBtn.hidden = true;
  }
}

function renderCard(r) {
  const card = document.createElement("article");
  card.className = "result-card";

  const authors = (r.authors || []).join(", ");
  const tagChips = [
    ...(r.method_tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`),
    ...(r.data_type_tags || []).map((t) => `<span class="tag-chip data-type">${escapeHtml(t)}</span>`),
  ].join("");

  const doiLink = r.doi
    ? `<a class="result-doi" href="https://doi.org/${escapeHtml(stripDoiPrefix(r.doi))}" target="_blank" rel="noopener">${escapeHtml(stripDoiPrefix(r.doi))}</a>`
    : "";

  card.innerHTML = `
    <h3><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a></h3>
    <div class="result-meta">${escapeHtml(r.journal_short)} · ${r.year ?? "n.d."} · ${escapeHtml(authors)}</div>
    <p class="result-desc">${escapeHtml(r.description || "")}</p>
    <div class="tag-row">${tagChips}</div>
    ${doiLink}
  `;
  return card;
}

function stripDoiPrefix(doi) {
  return doi.replace(/^doi:/i, "");
}

function formatDate(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- URL state sync (shareable searches) ---

function syncUrlFromState() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.activeFacets.journal_short.size) params.set("journal", [...state.activeFacets.journal_short].join(","));
  if (state.activeFacets.method_tags.size) params.set("method", [...state.activeFacets.method_tags].join(","));
  if (state.activeFacets.data_type_tags.size) params.set("data_type", [...state.activeFacets.data_type_tags].join(","));
  if (state.yearMin != null) params.set("from", String(state.yearMin));
  if (state.yearMax != null) params.set("to", String(state.yearMax));
  if (state.sort !== "relevance") params.set("sort", state.sort);

  const qs = params.toString();
  const newUrl = qs ? `?${qs}` : window.location.pathname;
  history.replaceState(null, "", newUrl);
}

function applyStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get("q") || "";
  state.yearMin = params.has("from") ? Number(params.get("from")) : null;
  state.yearMax = params.has("to") ? Number(params.get("to")) : null;
  state.sort = params.get("sort") || "relevance";

  for (const key of Object.keys(state.activeFacets)) state.activeFacets[key].clear();
  applyFacetParam(params, "journal", "journal_short");
  applyFacetParam(params, "method", "method_tags");
  applyFacetParam(params, "data_type", "data_type_tags");
}

function applyFacetParam(params, paramName, field) {
  const raw = params.get(paramName);
  if (!raw) return;
  for (const v of raw.split(",")) {
    if (v) state.activeFacets[field].add(v);
  }
}

function syncControlsToState() {
  el("search-box").value = state.query;
  el("sort-select").value = state.sort;
  el("year-from").value = state.yearMin ?? "";
  el("year-to").value = state.yearMax ?? "";

  for (const containerId of ["facet-journal", "facet-method", "facet-data_type"]) {
    const container = el(containerId);
    if (!container) continue;
    for (const chip of container.querySelectorAll(".facet-chip")) {
      const checkbox = chip.querySelector("input");
      const field = containerId === "facet-journal" ? "journal_short" : containerId === "facet-method" ? "method_tags" : "data_type_tags";
      const active = state.activeFacets[field].has(checkbox.value);
      checkbox.checked = active;
      chip.classList.toggle("active", active);
    }
  }
}

init();
