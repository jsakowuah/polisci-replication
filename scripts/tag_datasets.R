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
    tagged$method_tags, tagged$data_type_tags
  ),
  function(journal_short, title, doi, url, authors, year, description, method_tags, data_type_tags) {
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
      data_type_tags = I(split_tags(data_type_tags))
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

meta <- list(
  generated_at = payload$generated_at,
  journals = unique(tagged$journal_short),
  year_range = c(min(tagged$year, na.rm = TRUE), max(tagged$year, na.rm = TRUE)),
  methodology_version = "1",
  total_records = nrow(tagged)
)
write_json(meta, "data/meta.json", auto_unbox = TRUE)
message("Wrote data/meta.json")
