const RESULTS_LIMIT = 150;

const state = {
  records: [],
  fuse: null,
  query: "",
  activeFacets: { journal_short: new Set(), method_tags: new Set(), data_type_tags: new Set() },
};

const el = (id) => document.getElementById(id);

async function init() {
  const res = await fetch("data/index.json");
  const payload = await res.json();
  state.records = payload.records;
  state.journals = payload.journals || [];

  el("last-refreshed").textContent = `Index last refreshed: ${formatDate(payload.generated_at)}`;

  state.fuse = new Fuse(state.records, {
    keys: ["title", "description", "authors", "journal_short"],
    threshold: 0.32,
    ignoreLocation: true,
  });

  const journalNames = new Map(state.journals.map((j) => [j.short, j.name]));
  buildFacet("facet-journal", "journal_short", collectValues(state.records, "journal_short"), journalNames);
  buildFacet("facet-method", "method_tags", collectValues(state.records, "method_tags", true));
  buildFacet("facet-data_type", "data_type_tags", collectValues(state.records, "data_type_tags", true));
  renderJournalsLegend(state.journals);

  el("search-box").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    render();
  });

  render();
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
    if (labelMap && labelMap.has(value)) {
      chip.title = labelMap.get(value);
    }
    chip.innerHTML = `<input type="checkbox" value="${escapeHtml(value)}" /> ${escapeHtml(value)} (${count})`;
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
      render();
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
  return true;
}

function render() {
  const base = state.query
    ? state.fuse.search(state.query).map((r) => r.item)
    : state.records;
  const filtered = base.filter(matchesFacets);

  el("result-count").textContent = `${filtered.length.toLocaleString()} result${filtered.length === 1 ? "" : "s"}`;

  const container = el("results");
  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches. Try a broader search or clear some filters.</p>`;
    return;
  }

  const toShow = filtered.slice(0, RESULTS_LIMIT);
  for (const r of toShow) {
    container.appendChild(renderCard(r));
  }
  if (filtered.length > RESULTS_LIMIT) {
    const note = document.createElement("p");
    note.className = "empty-state";
    note.textContent = `Showing first ${RESULTS_LIMIT} of ${filtered.length.toLocaleString()} results — narrow your search or filters to see more.`;
    container.appendChild(note);
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

  card.innerHTML = `
    <h3><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a></h3>
    <div class="result-meta">${escapeHtml(r.journal_short)} · ${r.year ?? "n.d."} · ${escapeHtml(authors)}</div>
    <p class="result-desc">${escapeHtml(r.description || "")}</p>
    <div class="tag-row">${tagChips}</div>
  `;
  return card;
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

init();
