library(dplyr)
library(purrr)
library(readr)
library(tibble)

source("scripts/lib_common.R")

SEARCH_URL <- "https://dataverse.harvard.edu/api/search"
PAGE_SIZE <- 10L # server-enforced cap regardless of requested `rows`

# purrr re-exports rlang's `%||%` (NULL-coalesce), used below for optional API fields
first_or_na <- function(x) if (length(x) == 0) NA_character_ else x[[1]]
join_or_na <- function(x) if (length(x) == 0) NA_character_ else paste(x, collapse = "; ")

extract_item <- function(item, journal_name, journal_short) {
  tibble(
    journal = journal_name,
    journal_short = journal_short,
    title = item$name %||% NA_character_,
    doi = item$global_id %||% NA_character_,
    url = item$url %||% NA_character_,
    description = item$description %||% NA_character_,
    authors = join_or_na(item$authors),
    keywords_raw = join_or_na(item$keywords),
    related_publication_citation = first_or_na(map_chr(item$publications, ~ .x$citation %||% NA_character_)),
    file_count = item$fileCount %||% NA_integer_,
    published_at = item$published_at %||% NA_character_
  )
}

fetch_journal_datasets <- function(journal_name, journal_short, alias) {
  message(sprintf("Fetching %s (%s)...", journal_short, alias))

  first_page <- dataverse_get(SEARCH_URL, list(
    q = "*", type = "dataset", subtree = alias,
    rows = PAGE_SIZE, start = 0, sort = "date", order = "desc"
  ))
  total_count <- first_page$data$total_count
  message(sprintf("  total_count = %d", total_count))

  all_rows <- list(map_dfr(first_page$data$items, extract_item, journal_name = journal_name, journal_short = journal_short))

  # total_count <= PAGE_SIZE means the first page already has everything;
  # seq() errors ("wrong sign in 'by' argument") if asked to build a
  # descending range with a positive step, which is what total_count - 1 <
  # PAGE_SIZE produces.
  starts <- if (total_count > PAGE_SIZE) seq(PAGE_SIZE, total_count - 1, by = PAGE_SIZE) else integer(0)
  for (s in starts) {
    polite_sleep(0.4)
    page <- dataverse_get(SEARCH_URL, list(
      q = "*", type = "dataset", subtree = alias,
      rows = PAGE_SIZE, start = s, sort = "date", order = "desc"
    ))
    all_rows[[length(all_rows) + 1]] <- map_dfr(page$data$items, extract_item, journal_name = journal_name, journal_short = journal_short)
    if ((s / PAGE_SIZE) %% 10 == 0) {
      message(sprintf("  ...%d / %d", s, total_count))
    }
  }

  result <- bind_rows(all_rows)
  message(sprintf("  fetched %d rows for %s", nrow(result), journal_short))
  result
}

journals <- read_journals_config()

all_datasets <- pmap_dfr(
  list(journals$journal_name, journals$journal_short, journals$dataverse_alias),
  fetch_journal_datasets
) |>
  mutate(fetched_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"))

dir.create("data/raw", recursive = TRUE, showWarnings = FALSE)
write_csv(all_datasets, "data/raw/dataverse_datasets.csv")

message(sprintf("Wrote %d total rows to data/raw/dataverse_datasets.csv", nrow(all_datasets)))
