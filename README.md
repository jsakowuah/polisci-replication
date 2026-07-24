# Political Science Replication Index

On this webpage, I have provided a searchable, tagged index of political science replication packages, built from flagship political science
journals' Harvard Dataverse collections. This page is auto-refreshed monthly to provide you with up-to-date replication datasets. 

Harvard Dataverse hosts thousands of replication packages for political science articles, but its
own interface doesn't support browsing across journals by method (survey experiment, regression
discontinuity, panel data...) or by data type. This project indexes flagship journals' collections
into a single static page with full-text/faceted search. (For a curated, non-searchable directory
of replication policies across a broader set of journals, including several not indexed here, see
[poliscidata.com's list](https://www.poliscidata.com/pages/journalReplicationData.php).)

## Journals covered

| Journal | Short | Dataverse collection |
|---|---|---|
| American Political Science Review | APSR | [`the_review`](https://dataverse.harvard.edu/dataverse/the_review) |
| American Journal of Political Science | AJPS | [`ajps`](https://dataverse.harvard.edu/dataverse/ajps) |
| Journal of Politics | JOP | [`jop`](https://dataverse.harvard.edu/dataverse/jop) |
| British Journal of Political Science | BJPS | [`BJPolS`](https://dataverse.harvard.edu/dataverse/BJPolS) |
| Political Science Research and Methods | PSRM | [`PSRM`](https://dataverse.harvard.edu/dataverse/PSRM) |
| World Politics | WP | [`world-politics`](https://dataverse.harvard.edu/dataverse/world-politics) |
| International Organization | IO | [`IOJ`](https://dataverse.harvard.edu/dataverse/IOJ) |
| International Studies Quarterly | ISQ | [`isq`](https://dataverse.harvard.edu/dataverse/isq) |
| Comparative Political Studies | CPS | [`cps`](https://dataverse.harvard.edu/dataverse/cps) |
| Legislative Studies Quarterly | LSQ | [`lsq`](https://dataverse.harvard.edu/dataverse/lsq) |
| Political Behavior | POLB | [`polbehavior`](https://dataverse.harvard.edu/dataverse/polbehavior) |
| Political Analysis | PAN | [`pan`](https://dataverse.harvard.edu/dataverse/pan) |
| Public Opinion Quarterly | POQ | [`poq`](https://dataverse.harvard.edu/dataverse/poq) |
| Journal of Experimental Political Science | JEPS | [`xps`](https://dataverse.harvard.edu/dataverse/xps) |
| PS: Political Science & Politics | PS | [`ps`](https://dataverse.harvard.edu/dataverse/ps) |
| Perspectives on Politics | PoP | [`perspectives`](https://dataverse.harvard.edu/dataverse/perspectives) |
| Brazilian Political Science Review | BPSR | [`bpsr`](https://dataverse.harvard.edu/dataverse/bpsr) |
| Revista DADOS | DADOS | [`revistadados`](https://dataverse.harvard.edu/dataverse/revistadados) |
| Foreign Policy Analysis | FPA | [`FPA`](https://dataverse.harvard.edu/dataverse/FPA) |
| International Interactions | II | [`interact`](https://dataverse.harvard.edu/dataverse/interact) |
| International Security | IS | [`isec`](https://dataverse.harvard.edu/dataverse/isec) |
| Italian Political Science Review | IPSR | [`ipsr-risp`](https://dataverse.harvard.edu/dataverse/ipsr-risp) |
| Japanese Journal of Political Science | JJPS | [`JJPS`](https://dataverse.harvard.edu/dataverse/JJPS) |
| Journal of Behavioral Public Administration | JBPA | [`JBPA`](https://dataverse.harvard.edu/dataverse/JBPA) |
| Journal of Human Rights | JHR | [`jhr`](https://dataverse.harvard.edu/dataverse/jhr) |
| Journal of Information Technology & Politics | JITP | [`jitp`](https://dataverse.harvard.edu/dataverse/jitp) |
| Journal of Law and Courts | JLC | [`jlc`](https://dataverse.harvard.edu/dataverse/jlc) |
| Journal of Public Policy | JPP | [`JPublicPolicy`](https://dataverse.harvard.edu/dataverse/JPublicPolicy) |
| Latin American Politics and Society | LAPS | [`LAPS`](https://dataverse.harvard.edu/dataverse/LAPS) |
| Public Administration | PA | [`pa`](https://dataverse.harvard.edu/dataverse/pa) |
| Public Administration Review | PAR | [`PAR`](https://dataverse.harvard.edu/dataverse/PAR) |
| Research & Politics | RP | [`researchandpolitics`](https://dataverse.harvard.edu/dataverse/researchandpolitics) |
| Security Studies | SS | [`securitystudies`](https://dataverse.harvard.edu/dataverse/securitystudies) |
| State Politics & Policy Quarterly | SPPQ | [`sppq`](https://dataverse.harvard.edu/dataverse/sppq) |

## Methodology

**Fetching**: `scripts/fetch_dataverse.R` crawls each journal's Dataverse collection via the public
[Search API](https://guides.dataverse.org/en/latest/api/search.html) (`type=dataset`, scoped with
`subtree=<alias>`). The API caps `rows` at 10 per request regardless of what's requested, so the
script paginates with `start` until it has walked the full collection. This is a full re-crawl on
every run rather than an incremental fetch — simpler, and self-healing for edited or backfilled
records, at the cost of a few hundred extra requests per month (not a meaningful cost at this
volume).

**Tagging**: `scripts/tag_datasets.R` applies the keyword rules in `config/tag_rules.csv` against
each dataset's title, abstract, and author-supplied keywords, via case-insensitive regex matching.
A dataset can get zero, one, or several tags in each category.

A keyword classifier will miss paraphrased methods (a paper that never uses the phrase "regression
discontinuity" but clearly runs one) and can over-match on common words (e.g. "experiment"
appearing in an unrelated sentence). Treat tags as a way to narrow a search, and verify by reading
the abstract or the dataset itself.

**Data quality note**: the `related_publication_citation` field is a best-effort citation string
supplied by the depositor, not a structured field — in practice it varies wildly, from a clean
single citation to (in at least one observed case) an entire multi-work bibliography pasted into
the field. It's carried through in the raw data for reference but not parsed or relied on for
anything.

## Repository layout

```
config/
  journals.csv     # journal registry — add a journal by adding a row here
  tag_rules.csv     # method/data-type keyword dictionary — add or refine a tag by adding a row here
scripts/
  lib_common.R      # HTTP helpers (retry/backoff), config loaders
  fetch_dataverse.R # crawls all configured journals -> data/raw/dataverse_datasets.csv
  tag_datasets.R    # applies tag rules -> data/replication_index.csv, docs/data/index.json
  run_pipeline.R    # runs fetch then tag; the GitHub Actions entry point
data/
  raw/dataverse_datasets.csv  # untagged crawl output
  replication_index.csv       # canonical tidy output (tags as pipe-delimited strings)
  meta.json                   # last-run summary
docs/                          # GitHub Pages source
  index.html, assets/app.js, assets/style.css
  data/index.json              # search payload consumed by the site (client-side Fuse.js search)
```

## Adding a journal

Add a row to `config/journals.csv` with the journal name, a short code, and its Dataverse
collection alias (found via the Dataverse UI URL, e.g. `dataverse.harvard.edu/dataverse/<alias>`,
or `GET /api/search?q=*&type=dataverse&q=<journal name>`). No code changes needed — the next
pipeline run will pick it up.

## Adding or refining a tag

Add a row to `config/tag_rules.csv`: `tag_category` (`method` or `data_type`), a `tag_label` to
display, and a `pattern` (case-insensitive regex, matched against title + abstract + keywords).
No code changes needed.

## Refresh cadence

The pipeline runs monthly via a scheduled GitHub Action (`.github/workflows/update-index.yml`),
plus on-demand via `workflow_dispatch`. Failures surface through GitHub's default Action-failure
email — there's no separate alerting.

## License

MIT — see [LICENSE](LICENSE).
