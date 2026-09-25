library(dplyr)
library(purrr)
library(readr)
library(stringr)
library(jsonlite)
library(tibble)

source("scripts/lib_common.R")

DESCRIPTION_TRUNCATE_CHARS <- 300L

raw <- read_csv("data/raw/dataverse_datasets.csv", show_col_types = FALSE)
rules <- read_tag_rules()

search_text <- str_c(
  coalesce(raw$title, ""), " ",
  coalesce(raw$description, ""), " ",
  coalesce(raw$keywords_raw, "")
)

tags_for_category <- function(category) {
  cat_rules <- rules |> filter(tag_category == category)
  hit_matrix <- sapply(cat_rules$pattern, function(p) str_detect(search_text, regex(p, ignore_case = TRUE)))
  if (is.null(dim(hit_matrix))) hit_matrix <- matrix(hit_matrix, ncol = 1)
  apply(hit_matrix, 1, function(row_hits) {
    hits <- cat_rules$tag_label[row_hits]
    if (length(hits) == 0) NA_character_ else paste(hits, collapse = "|")
  })
}

method_tags <- tags_for_category("method")
data_type_tags <- tags_for_category("data_type")

tagged <- raw |>
  mutate(
    method_tags = method_tags,
    data_type_tags = data_type_tags,
    year = as.integer(format(published_at, "%Y"))
  )

dir.create("data", showWarnings = FALSE)
write_csv(tagged, "data/replication_index.csv")
message(sprintf("Wrote %d rows to data/replication_index.csv", nrow(tagged)))

split_tags <- function(x) if (is.na(x)) list() else str_split(x, "\\|")[[1]]

records <- pmap(
  list(
    tagged$journal_short, tagged$title, tagged$doi, tagged$url,
    tagged$authors, tagged$year, tagged$description,
    tagged$method_tags, tagged$data_type_tags, tagged$keywords_raw
  ),
  function(journal_short, title, doi, url, authors, year, description, method_tags, data_type_tags, keywords_raw) {
    desc <- if (is.na(description)) "" else description
    list(
      journal_short = journal_short,
      title = title,
      doi = doi,
      url = url,
      # I() forces array output even for length-1 vectors: without it, jsonlite's
      # auto_unbox collapses a single author/tag into a bare JSON string instead of
      # a one-element array, which breaks app.js's .some()/.map()/.join() calls on
      # these fields for the many records that have exactly one author or one tag.
      authors = I(if (is.na(authors)) character(0) else str_split(authors, "; ")[[1]]),
      year = year,
      description = str_trunc(desc, DESCRIPTION_TRUNCATE_CHARS),
      method_tags = I(split_tags(method_tags)),
      data_type_tags = I(split_tags(data_type_tags)),
      keywords = I(if (is.na(keywords_raw)) character(0) else str_split(keywords_raw, "; ")[[1]])
    )
  }
)

journals_config <- read_journals_config()
journal_list <- pmap(
  list(journals_config$journal_short, journals_config$journal_name),
  function(short, name) list(short = short, name = name)
)

payload <- list(
  generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  methodology_version = "1",
  # Full journal names, keyed by short code, so docs/assets/app.js can render
  # a legend and facet tooltips without a hand-maintained copy of this list.
  journals = journal_list,
  records = records
)

dir.create("docs/data", recursive = TRUE, showWarnings = FALSE)
write_json(payload, "docs/data/index.json", auto_unbox = TRUE, null = "null")
message(sprintf("Wrote %d records to docs/data/index.json", length(records)))

# --- New-dataset detection (drives email notices) ---
# data/seen_dois.csv is an append-only ledger of every DOI ever indexed. It's
# kept separately from replication_index.csv so a record that drops out of one
# crawl (a transient API gap) and reappears in the next isn't announced twice.
SEEN_LEDGER <- "data/seen_dois.csv"
run_date <- format(Sys.time(), "%Y-%m-%d", tz = "UTC")

seen <- if (file.exists(SEEN_LEDGER)) {
  read_csv(SEEN_LEDGER, col_types = "cc")
} else {
  # First run with notices: seed from this crawl so the whole back catalogue
  # isn't announced as new. Notices start with the following run.
  message(sprintf("%s not found; seeding it (no notices this run)", SEEN_LEDGER))
  tibble(doi = tagged$doi, first_seen = run_date)
}

is_new <- !is.na(tagged$doi) & !(tagged$doi %in% seen$doi)
new_records <- records[is_new]

seen <- bind_rows(seen, tibble(doi = tagged$doi[is_new], first_seen = run_date)) |>
  distinct(doi, .keep_all = TRUE)
write_csv(seen, SEEN_LEDGER)

new_payload <- list(
  # batch_id lets the notifier refuse to send the same batch twice on a retry
  batch_id = payload$generated_at,
  generated_at = payload$generated_at,
  records = new_records
)
write_json(new_payload, "docs/data/new_datasets.json", auto_unbox = TRUE, null = "null")
message(sprintf("Wrote %d new records to docs/data/new_datasets.json", length(new_records)))

meta <- list(
  generated_at = payload$generated_at,
  journals = unique(tagged$journal_short),
  year_range = c(min(tagged$year, na.rm = TRUE), max(tagged$year, na.rm = TRUE)),
  methodology_version = "1",
  total_records = nrow(tagged)
)
write_json(meta, "data/meta.json", auto_unbox = TRUE)
message("Wrote data/meta.json")
