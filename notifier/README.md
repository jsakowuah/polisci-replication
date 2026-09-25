# Email alert notifier

A Cloudflare Worker that handles sign-ups for replication-data alerts and sends the notices.
Subscribers are stored in Cloudflare D1, and mail goes out through [Resend](https://resend.com).

Each subscription stores only an email address, the chosen filters, a random token, a confirmed
flag, and a sign-up timestamp (used only to expire unconfirmed sign-ups). No names or IP
addresses are stored, and the Worker never logs request bodies.

## Endpoints

| Route | Caller | What it does |
|---|---|---|
| `POST /subscribe` | the site's alert form | stores a pending subscription and emails a confirmation link |
| `GET/POST /confirm?token=` | confirmation email | GET shows a button; POST confirms |
| `GET/POST /unsubscribe?token=[&all=1]` | alert emails | GET shows a button; POST deletes the subscription (or every alert for that address) |
| `POST /notify` | GitHub Action, `Authorization: Bearer $NOTIFY_TOKEN` | matches `docs/data/new_datasets.json` against confirmed subscriptions and sends one digest per address |

Confirm and unsubscribe links answer GET with a button so that email scanners that pre-fetch
links can't act on anyone's behalf. Alert emails also carry one-click `List-Unsubscribe` headers,
so Gmail and Apple Mail show their built-in unsubscribe button.

## One-time setup

Requires Node.js for `npx wrangler`.

1. **Resend**: create an account, verify a sending domain (`alerts.josephsakowuah.com`, a subdomain
   of a domain whose DNS you control; `github.io` can't be used), and
   create an API key with sending access. Leave open and click tracking **off** for the domain.
   Update `FROM_ADDRESS` in `wrangler.toml` if you use a different address.
2. **Cloudflare D1**:
   ```sh
   cd notifier
   npx wrangler login
   npx wrangler d1 create polisci-replication-subscribers
   # paste the printed database_id into wrangler.toml
   npx wrangler d1 execute polisci-replication-subscribers --remote --file=schema.sql
   ```
3. **Secrets**:
   ```sh
   npx wrangler secret put RESEND_API_KEY
   openssl rand -hex 32            # use the output for NOTIFY_TOKEN in both places below
   npx wrangler secret put NOTIFY_TOKEN
   ```
4. **Deploy**: `npx wrangler deploy`. Note the URL it prints
   (`https://polisci-replication-notifier.<your-subdomain>.workers.dev`).
5. **GitHub**: in the repo's Settings → Secrets and variables → Actions, add the secret
   `NOTIFY_TOKEN` (same value as step 3) and the variable `NOTIFIER_URL` (the Worker URL, with no
   trailing slash).
6. **Site**: set `NOTIFIER_URL` at the top of `docs/assets/app.js` to the same Worker URL. The
   "Email me new matches" button appears once this is set.

The first pipeline run after this change seeds `data/seen_dois.csv` from the current crawl and
sends nothing. Notices start with the run after that.

## Operations

- **Re-sending after a failure**: re-run the workflow's failed job, or POST
  `docs/data/new_datasets.json` to `/notify` by hand. Addresses already emailed for that
  `batch_id` are skipped.
- **Subscriber count**: `npx wrangler d1 execute polisci-replication-subscribers --remote --command "SELECT confirmed, COUNT(*) FROM subscriptions GROUP BY confirmed"`
- **Limits**: Resend's free tier allows 100 emails/day and 3,000/month. Each subscriber gets at
  most one email per weekly run, so the free tier covers about 100 subscribers. Past that,
  upgrade the Resend plan. `/notify` returns 502 and lists the failures if any batch is rejected,
  which fails the Action and triggers GitHub's failure email.
- **Removing someone on request**: `npx wrangler d1 execute polisci-replication-subscribers --remote --command "DELETE FROM subscriptions WHERE email = 'x@example.com'; DELETE FROM deliveries WHERE email = 'x@example.com'"`
