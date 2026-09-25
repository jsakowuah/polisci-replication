import { normalizeFilters, matches, describeFilters } from "./match.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PENDING_PER_EMAIL = 5;
const RESEND_CONFIRM_AFTER_MS = 10 * 60 * 1000;
const PENDING_TTL_DAYS = 7;
const MAX_RECORDS_PER_EMAIL = 50;
const RESEND_BATCH_SIZE = 100; // Resend's batch endpoint limit

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));
      if (url.pathname === "/subscribe" && request.method === "POST") return cors(env, await subscribe(request, env, url));
      if (url.pathname === "/confirm") return await confirm(request, env, url);
      if (url.pathname === "/unsubscribe") return await unsubscribe(request, env, url);
      if (url.pathname === "/notify" && request.method === "POST") return await notify(request, env, url);
      return new Response("Not found", { status: 404 });
    } catch (err) {
      // Never echo request bodies (they contain emails) into logs or responses.
      console.error(`Unhandled error on ${url.pathname}: ${err.message}`);
      if (url.pathname === "/subscribe") return cors(env, json({ error: "Something went wrong. Please try again later." }, 500));
      return new Response("Something went wrong.", { status: 500 });
    }
  },
};

// --- Sign-up ---

async function subscribe(request, env, url) {
  const { success } = await env.SUBSCRIBE_LIMITER.limit({ key: "subscribe" });
  if (!success) return json({ error: "Too many sign-ups right now. Please try again in a minute." }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  // Honeypot: a hidden field real visitors never fill in. Pretend success.
  if (body.website) return json({ ok: true });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);

  let filters;
  try {
    filters = normalizeFilters(body.filters);
  } catch (err) {
    return json({ error: err.message }, 400);
  }
  const filtersJson = JSON.stringify(filters);

  // The response is identical whether or not the address is already
  // subscribed, so the form can't be used to discover who's on the list.
  const okResponse = json({ ok: true });

  const existing = await env.DB.prepare("SELECT id, confirmed, created_at FROM subscriptions WHERE email = ? AND filters = ?")
    .bind(email, filtersJson)
    .first();

  if (existing?.confirmed) return okResponse;

  let id;
  if (existing) {
    if (Date.now() - Date.parse(existing.created_at) < RESEND_CONFIRM_AFTER_MS) return okResponse;
    id = existing.id;
    await env.DB.prepare("UPDATE subscriptions SET created_at = ? WHERE id = ?").bind(nowIso(), id).run();
  } else {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE email = ? AND confirmed = 0")
      .bind(email)
      .first();
    if (n >= MAX_PENDING_PER_EMAIL) return okResponse;
    id = randomToken();
    await env.DB.prepare("INSERT INTO subscriptions (id, email, filters, confirmed, created_at) VALUES (?, ?, ?, 0, ?)")
      .bind(id, email, filtersJson, nowIso())
      .run();
  }

  const confirmUrl = `${url.origin}/confirm?token=${id}`;
  const summary = describeFilters(filters);
  try {
    await sendConfirmation(env, email, summary, confirmUrl);
  } catch (err) {
    // Don't leave a row behind that would throttle the person's retry.
    if (!existing) await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
    throw err;
  }
  return okResponse;
}

async function sendConfirmation(env, email, summary, confirmUrl) {
  await sendEmails(env, [
    {
      from: env.FROM_ADDRESS,
      to: [email],
      subject: "Confirm your replication data alerts",
      text:
        `Someone (hopefully you) asked to be emailed when new replication packages matching this filter are indexed:\n\n` +
        `  ${summary}\n\nConfirm here: ${confirmUrl}\n\n` +
        `If this wasn't you, ignore this email. Unconfirmed sign-ups are deleted after ${PENDING_TTL_DAYS} days.\n`,
      html: emailShell(
        `<p>Someone (hopefully you) asked to be emailed when new replication packages matching this filter are indexed:</p>
         <p style="padding:10px 14px;background:#f3f4f6;border-radius:6px">${esc(summary)}</p>
         <p><a href="${confirmUrl}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Confirm subscription</a></p>
         <p style="color:#6b7280;font-size:13px">If this wasn't you, ignore this email. Unconfirmed sign-ups are deleted after ${PENDING_TTL_DAYS} days.</p>`,
      ),
    },
  ]);
}

// Confirm and unsubscribe links answer GET with a button that POSTs, so email
// security scanners that pre-fetch links can't confirm or unsubscribe anyone.

async function confirm(request, env, url) {
  const token = url.searchParams.get("token") || "";
  if (request.method === "GET") {
    return page("Confirm subscription", `<form method="post"><button type="submit">Confirm my subscription</button></form>`);
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const row = await env.DB.prepare("UPDATE subscriptions SET confirmed = 1 WHERE id = ? RETURNING filters").bind(token).first();
  if (!row) return page("Link expired", `<p>This confirmation link has expired or was already used to unsubscribe. You can sign up again from the <a href="${env.SITE_URL}">index</a>.</p>`, 404);
  return page(
    "Subscribed",
    `<p>You're subscribed to: <strong>${esc(describeFilters(JSON.parse(row.filters)))}</strong>.</p>
     <p>You'll get an email after each weekly refresh that turns up matching packages, and none when nothing matches.</p>
     <p><a href="${env.SITE_URL}">Back to the index</a></p>`,
  );
}

async function unsubscribe(request, env, url) {
  const token = url.searchParams.get("token") || "";
  const all = url.searchParams.get("all") === "1";
  if (request.method === "GET") {
    const label = all ? "Unsubscribe from all alerts" : "Unsubscribe from this alert";
    return page("Unsubscribe", `<form method="post"><button type="submit">${label}</button></form>`);
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const row = await env.DB.prepare("SELECT email FROM subscriptions WHERE id = ?").bind(token).first();
  if (row) {
    if (all) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM subscriptions WHERE email = ?").bind(row.email),
        env.DB.prepare("DELETE FROM deliveries WHERE email = ?").bind(row.email),
      ]);
    } else {
      await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(token).run();
      const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE email = ?").bind(row.email).first();
      if (n === 0) await env.DB.prepare("DELETE FROM deliveries WHERE email = ?").bind(row.email).run();
    }
  }
  // Same answer whether or not the token existed (already unsubscribed is fine).
  return page("Unsubscribed", `<p>You've been unsubscribed and your address has been deleted${all ? " from every alert" : " from that alert"}.</p><p><a href="${env.SITE_URL}">Back to the index</a></p>`);
}

// --- Sending notices (called by the GitHub Action after each refresh) ---

async function notify(request, env, url) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.NOTIFY_TOKEN || !timingSafeEqual(auth, `Bearer ${env.NOTIFY_TOKEN}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await request.json();
  const batchId = String(payload.batch_id || "");
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (!batchId) return json({ error: "batch_id is required" }, 400);

  const cutoff = new Date(Date.now() - PENDING_TTL_DAYS * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM subscriptions WHERE confirmed = 0 AND created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM deliveries WHERE batch_id != ?").bind(batchId),
  ]);

  if (records.length === 0) return json({ ok: true, records: 0, emailed: 0 });

  const { results: subs } = await env.DB.prepare("SELECT id, email, filters FROM subscriptions WHERE confirmed = 1").all();
  const { results: done } = await env.DB.prepare("SELECT email FROM deliveries WHERE batch_id = ?").bind(batchId).all();
  const alreadySent = new Set(done.map((d) => d.email));

  // One email per address, combining all of that address's alerts.
  const byEmail = new Map();
  for (const sub of subs) {
    if (alreadySent.has(sub.email)) continue;
    const filters = JSON.parse(sub.filters);
    const hits = records.filter((r) => matches(filters, r));
    const entry = byEmail.get(sub.email) || { subs: [], hits: new Map() };
    entry.subs.push({ id: sub.id, summary: describeFilters(filters), count: hits.length });
    for (const r of hits) entry.hits.set(r.doi, r);
    byEmail.set(sub.email, entry);
  }

  const messages = [];
  for (const [email, { subs, hits }] of byEmail) {
    if (hits.size === 0) continue;
    messages.push({ email, message: buildDigest(env, url.origin, email, subs, [...hits.values()]) });
  }

  let emailed = 0;
  const failures = [];
  for (let i = 0; i < messages.length; i += RESEND_BATCH_SIZE) {
    const chunk = messages.slice(i, i + RESEND_BATCH_SIZE);
    try {
      await sendEmails(env, chunk.map((m) => m.message));
      await env.DB.batch(
        chunk.map((m) => env.DB.prepare("INSERT OR IGNORE INTO deliveries (batch_id, email) VALUES (?, ?)").bind(batchId, m.email)),
      );
      emailed += chunk.length;
    } catch (err) {
      failures.push(err.message);
    }
  }

  const status = failures.length ? 502 : 200;
  return json({ ok: failures.length === 0, records: records.length, emailed, pending: messages.length - emailed, failures }, status);
}

function buildDigest(env, origin, email, subs, hits) {
  const shown = hits.slice(0, MAX_RECORDS_PER_EMAIL);
  const more = hits.length - shown.length;
  const n = hits.length;
  const subject = `${n} new replication package${n === 1 ? "" : "s"} matching your alerts`;
  const unsubAll = `${origin}/unsubscribe?token=${subs[0].id}&all=1`;

  const itemsHtml = shown
    .map((r) => {
      const meta = [r.journal_short, r.year, (r.authors || []).slice(0, 4).join("; ")].filter(Boolean).join(" · ");
      const tags = [...(r.method_tags || []), ...(r.data_type_tags || [])].join(", ");
      return `<div style="margin:0 0 18px">
        <a href="${esc(r.url)}" style="font-weight:600;color:#1d4ed8;text-decoration:none">${esc(r.title)}</a>
        <div style="color:#6b7280;font-size:13px">${esc(meta)}</div>
        ${tags ? `<div style="color:#374151;font-size:13px">${esc(tags)}</div>` : ""}
      </div>`;
    })
    .join("");
  const itemsText = shown.map((r) => `- ${r.title}\n  ${r.journal_short} · ${r.year ?? "n.d."}\n  ${r.url}`).join("\n\n");

  const subsHtml = subs
    .map((s) => `<li>${esc(s.summary)} (${s.count} in this update) · <a href="${origin}/unsubscribe?token=${s.id}" style="color:#6b7280">unsubscribe</a></li>`)
    .join("");
  const subsText = subs.map((s) => `- ${s.summary}: unsubscribe at ${origin}/unsubscribe?token=${s.id}`).join("\n");
  const moreNote = more > 0 ? `…and ${more} more. See the full list on the index.` : "";

  return {
    from: env.FROM_ADDRESS,
    to: [email],
    subject,
    headers: {
      "List-Unsubscribe": `<${unsubAll}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    text: `${subject}\n\n${itemsText}\n\n${moreNote}\n\nBrowse the index: ${env.SITE_URL}\n\nYour alerts:\n${subsText}\nUnsubscribe from everything: ${unsubAll}\n`,
    html: emailShell(
      `<h2 style="font-size:18px;margin:0 0 16px">${esc(subject)}</h2>
       ${itemsHtml}
       ${moreNote ? `<p><a href="${env.SITE_URL}">${esc(moreNote)}</a></p>` : ""}
       <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
       <p style="color:#6b7280;font-size:13px;margin:0 0 6px">Your alerts:</p>
       <ul style="color:#6b7280;font-size:13px;padding-left:18px;margin:0 0 10px">${subsHtml}</ul>
       <p style="color:#6b7280;font-size:13px"><a href="${unsubAll}" style="color:#6b7280">Unsubscribe from everything</a></p>`,
    ),
  };
}

async function sendEmails(env, messages) {
  const single = messages.length === 1;
  const res = await fetch(single ? "https://api.resend.com/emails" : "https://api.resend.com/emails/batch", {
    method: "POST",
    // trim(): a key pasted at the `wrangler secret put` prompt can carry a stray newline
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(single ? messages[0] : messages),
  });
  if (!res.ok) {
    // Resend's error body describes the problem without echoing recipients.
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

// --- Helpers ---

function emailShell(inner) {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:600px;margin:0 auto;padding:24px;line-height:1.5">
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px">Political Science Replication Index</p>
    ${inner}
  </body></html>`;
}

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · Replication data alerts</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.55;color:#111827;background:#fff}
    button{font:inherit;padding:10px 18px;border:0;border-radius:6px;background:#1d4ed8;color:#fff;cursor:pointer}
    a{color:#1d4ed8}
    @media (prefers-color-scheme:dark){body{background:#111827;color:#f3f4f6}a{color:#93c5fd}}
  </style></head><body><h1 style="font-size:22px">${esc(title)}</h1>${body}</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" } });
}

function cors(env, res) {
  res.headers.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Vary", "Origin");
  return res;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nowIso() {
  return new Date().toISOString();
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
