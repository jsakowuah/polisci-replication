library(httr2)
library(readr)

USER_AGENT <- "polisci-replication-index/1.0 (+https://github.com/; contact via repo issues)"

dataverse_get <- function(url, query = list()) {
  req <- request(url) |>
    req_user_agent(USER_AGENT) |>
    req_url_query(!!!query) |>
    req_retry(max_tries = 5, backoff = ~ min(2^.x, 30)) |>
    req_error(is_error = function(resp) FALSE)

  resp <- req_perform(req)
  if (resp_status(resp) >= 400) {
    stop(sprintf("Dataverse request failed (%s): %s", resp_status(resp), url))
  }
  resp_body_json(resp)
}

read_journals_config <- function(path = "config/journals.csv") {
  cfg <- read_csv(path, show_col_types = FALSE)
  required_cols <- c("journal_name", "journal_short", "dataverse_alias", "dataverse_collection_url")
  missing_cols <- setdiff(required_cols, names(cfg))
  if (length(missing_cols) > 0) {
    stop("config/journals.csv missing required columns: ", paste(missing_cols, collapse = ", "))
  }
  if (any(duplicated(cfg$journal_short))) {
    stop("config/journals.csv has duplicate journal_short values")
  }
  cfg
}

read_tag_rules <- function(path = "config/tag_rules.csv") {
  rules <- read_csv(path, show_col_types = FALSE)
  required_cols <- c("tag_category", "tag_label", "pattern")
  missing_cols <- setdiff(required_cols, names(rules))
  if (length(missing_cols) > 0) {
    stop("config/tag_rules.csv missing required columns: ", paste(missing_cols, collapse = ", "))
  }
  rules
}

polite_sleep <- function(seconds = 0.4) {
  Sys.sleep(seconds)
}
