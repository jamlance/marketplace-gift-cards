// The app-kit singleton plus the pieces both server.mjs (Node) and route modules (Vite) need:
// the schema-pinned database, email + image storage, Inkress order calls, card activation,
// the webhook that activates paid cards, and the scheduled-delivery loop.
import crypto from "node:crypto";
import { defineAppKit, loadEnv, openSchemaPg, keyFromSecret, createWebhookHandler, KIT_DDL } from "@inkress/app-kit/server";
import { MemorySessionStorage, PgSessionStorage } from "@inkress/app-kit/server/session";
import { createDrizzleStorage } from "@inkress/app-kit/server/storage";
import { openMerchantTokens } from "@inkress/app-kit/server/tokens";
import { createAwsBlobStore, createAwsEmailProvider } from "@inkress/app-kit/server/services";
import { APP_DDL } from "./schema.server.mjs";
import { cardEmailHtml } from "./card-design.mjs";

const env = loadEnv();

/** Schema-pinned pool over the shared bookerva_apps database (schema = APP_NAME = gift_cards). */
export const db = env.databaseUrl
  ? openSchemaPg(env.appName, { ddl: KIT_DDL + "\n" + APP_DDL, connectionString: env.databaseUrl })
  : null;
if (db) db.ensure().catch((e) => console.error("[gift-cards] schema ensure:", e?.message));

const sessionStorage = db ? new PgSessionStorage(db, { encryptionKey: keyFromSecret(env.clientSecret) }) : new MemorySessionStorage();
const storage = db ? createDrizzleStorage(db, {}) : undefined;
const tokens = db ? openMerchantTokens(db, { clientId: env.clientId, clientSecret: env.clientSecret, apiBaseUrl: env.apiBaseUrl }) : undefined;

export const email = createAwsEmailProvider();
export const blob = createAwsBlobStore();
export const publicBaseUrl = (env.publicBaseUrl || "").replace(/\/$/, "");

export const appKit = defineAppKit({
  appName: env.appName,
  clientId: env.clientId,
  clientSecret: env.clientSecret,
  apiBaseUrl: env.apiBaseUrl,
  mode: env.mode,
  sessionStorage,
  storage,
  tokens,
  webhookSecret: env.webhookSecret,
  frameAncestors: env.frameAncestors,
  publicBaseUrl: env.publicBaseUrl,
  standalone: env.standalone,
  // No `scopes`: the token exchange then grants what the merchant approved for this client.
});

export { requireMerchant, getOptionalMerchant, bootstrapFromJwt } from "@inkress/app-kit/server";

/** The database, or a clear error when the deploy is missing APPS_DATABASE_URL. */
export async function requireDb() {
  if (!db) throw new Response("Gift Cards isn't connected to its database.", { status: 503 });
  await db.ensure();
  return db;
}

// ---- Inkress API (acting as the merchant) -----------------------------------------------------

const apiBase = env.apiBaseUrl.replace(/\/$/, "");

async function inkress(accessToken, path, init = {}) {
  const r = await fetch(`${apiBase}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg = body?.message || body?.error || body?.result?.message || `Inkress answered ${r.status}`;
    throw Object.assign(new Error(String(msg)), { status: r.status });
  }
  return body?.result ?? body;
}

/** Offline access token for a merchant (public pages, webhooks, scheduler). */
export async function merchantAccessToken(merchantId) {
  if (!tokens) throw new Error("offline tokens not configured");
  return tokens.accessTokenFor(merchantId);
}

export async function createOrder(accessToken, { referenceId, total, currency, title, customerEmail, meta, returnUrl }) {
  const d = await inkress(accessToken, "orders", {
    method: "POST",
    body: JSON.stringify({
      reference_id: referenceId,
      total,
      kind: "online",
      title,
      currency_code: currency,
      customer: { email: customerEmail, first_name: "Gift", last_name: "Buyer" },
      meta_data: { ...(meta || {}), ...(returnUrl ? { return_url: returnUrl } : {}) },
    }),
  });
  return { id: d?.id != null ? String(d.id) : null, paymentUrl: d?.payment_urls?.payment_url ?? null };
}

export async function getOrderStatus(accessToken, orderId) {
  const d = await inkress(accessToken, `orders/${encodeURIComponent(orderId)}`);
  return String(d?.status ?? d?.order?.status ?? "").toLowerCase();
}

export const isPaid = (status) => ["paid", "confirmed", "completed", "fulfilled"].includes(String(status).toLowerCase());

/** Register the orders webhook once per merchant so paid cards activate instantly. Best effort. */
export async function ensureWebhook(merchantId, accessToken) {
  if (!db || !env.webhookSecret || !publicBaseUrl) return false;
  const sub = await db.one(`SELECT 1 FROM webhook_subs WHERE merchant_id=$1`, [merchantId]);
  if (sub) return true;
  const url = `${publicBaseUrl}/webhooks/inkress/${merchantId}`;
  try {
    await inkress(accessToken, "webhook_urls", { method: "POST", body: JSON.stringify({ url, event: "orders" }) });
  } catch (e) {
    if (!/already|unique|exist|422/i.test(String(e?.message))) return false;
  }
  await db.run(`INSERT INTO webhook_subs (merchant_id, url) VALUES ($1,$2) ON CONFLICT (merchant_id) DO UPDATE SET url=$2`, [merchantId, url]);
  return true;
}

// ---- cards: codes, email, activation ----------------------------------------------------------

export function newCode() {
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `GC-${part()}-${part()}`;
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Email the card to its recipient. Returns false when email isn't set up or there's no address. */
export async function sendCardEmail(card) {
  if (!db || !email.configured() || !card.recipient_email) return false;
  const design = card.design_id ? await db.one(`SELECT * FROM designs WHERE id=$1`, [card.design_id]) : null;
  const shopName = design?.merchant_name || "the shop";
  await email.send({
    to: card.recipient_email,
    subject: `A gift card from ${shopName}`,
    html: cardEmailHtml({ shopName, card, design, balanceUrl: publicBaseUrl ? `${publicBaseUrl}/balance` : null }),
  });
  return true;
}

/** A paid card becomes active and is delivered now, unless it was scheduled for later. */
export async function activateCard(card) {
  if (!db) return;
  const r = await db.run(`UPDATE cards SET state='active' WHERE id=$1 AND state='awaiting'`, [card.id]);
  if (!r.rowCount) return;
  await db.run(`INSERT INTO redemptions (merchant_id, card_id, code, amount, kind, note) VALUES ($1,$2,$3,$4,'paid',NULL)`, [card.merchant_id, card.id, card.code, card.amount]);
  if (card.deliver_on && String(card.deliver_on).slice(0, 10) > today()) return;
  if (await sendCardEmail({ ...card, state: "active" }).catch(() => false)) {
    await db.run(`UPDATE cards SET delivered_at=now() WHERE id=$1 AND delivered_at IS NULL`, [card.id]);
  }
}

// Inkress order webhook → activate the card it paid for.
export const webhookHandler = createWebhookHandler(appKit, async (evt) => {
  if (!db) return;
  const p = evt.payload || {};
  const order = p.order || p.data?.order || p.event?.data?.order || p.event?.data || p.data || {};
  const status = String(order.status || evt.topic || "").toLowerCase();
  if (!order.id || !(isPaid(status) || /paid|confirmed/.test(evt.topic))) return;
  const card = await db.one(`SELECT * FROM cards WHERE merchant_id=$1 AND inkress_order_id=$2 AND state='awaiting'`, [evt.merchantId, String(order.id)]);
  if (card) await activateCard(card);
});

// ---- scheduled delivery -----------------------------------------------------------------------

async function deliverDue() {
  if (!db || !email.configured()) return;
  try {
    await db.ensure();
    const due = await db.q(`SELECT * FROM cards WHERE state='active' AND delivered_at IS NULL AND deliver_on IS NOT NULL AND deliver_on <= $1 LIMIT 100`, [today()]);
    for (const c of due) {
      try {
        if (await sendCardEmail(c)) await db.run(`UPDATE cards SET delivered_at=now() WHERE id=$1`, [c.id]);
      } catch (e) {
        console.error(`[gift-cards] delivery ${c.code}: ${e?.message}`);
      }
    }
  } catch (e) {
    console.error(`[gift-cards] delivery loop: ${e?.message}`);
  }
}

let schedulerStarted = false;
/** Hourly, plus once shortly after boot. Called by server.mjs only (not on import). */
export function startDeliveryScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(deliverDue, 30_000);
  setInterval(deliverDue, 3600_000);
}
