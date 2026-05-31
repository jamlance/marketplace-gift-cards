import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, createInkressOrder, getInkressOrder, isPaidStatus } from "@inkress/apps-core";
import { openPg } from "@inkress/apps-core/pgdb";
import { openMerchantTokens } from "@inkress/apps-core/merchant-tokens";
import { sendEmail, sesConfigured } from "@inkress/apps-core/ses";
import { documentPdf } from "@inkress/apps-core/pdf";
import { putObject, storageConfigured, decodeDataUrl, isAllowedImage } from "@inkress/apps-core/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEBHOOK_SECRET = process.env.INKRESS_WEBHOOK_SECRET || "";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[gift-cards] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("gift_cards", `
  CREATE TABLE IF NOT EXISTS designs (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    name TEXT NOT NULL, denominations JSONB NOT NULL DEFAULT '[]', allow_custom BOOLEAN NOT NULL DEFAULT true,
    min_amount NUMERIC NOT NULL DEFAULT 500, max_amount NUMERIC NOT NULL DEFAULT 50000,
    currency TEXT NOT NULL DEFAULT 'JMD', active BOOLEAN NOT NULL DEFAULT true,
    merchant_name TEXT, merchant_logo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS accent TEXT NOT NULL DEFAULT '#3b5bdb';
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'classic';
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS image TEXT;
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS terms TEXT;
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS expiry_months INTEGER;
  CREATE TABLE IF NOT EXISTS cards (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, design_id BIGINT,
    code TEXT NOT NULL, amount NUMERIC NOT NULL, balance NUMERIC NOT NULL, currency TEXT NOT NULL,
    recipient_name TEXT, recipient_email TEXT, buyer_email TEXT, message TEXT,
    ref TEXT, inkress_order_id TEXT, payment_url TEXT, state TEXT NOT NULL DEFAULT 'awaiting',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (merchant_id, code)
  );
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS deliver_on DATE;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS expires_on DATE;
  CREATE TABLE IF NOT EXISTS redemptions (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, card_id BIGINT, code TEXT, amount NUMERIC,
    note TEXT, created_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'redeem';
  CREATE INDEX IF NOT EXISTS idx_gc_cards ON cards (merchant_id, state, created_at DESC);
  CREATE TABLE IF NOT EXISTS webhook_subs (merchant_id BIGINT PRIMARY KEY, url TEXT NOT NULL, registered_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS webhook_seen (webhook_id TEXT PRIMARY KEY, seen_at TIMESTAMPTZ NOT NULL DEFAULT now());
`);

const app = express();
app.use("/webhooks/inkress", express.raw({ type: () => true, limit: "1mb" }));
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
  onBootstrap: (entry) => { tokens.save(entry.merchantId, entry.refreshToken).catch(() => {}); },
});
const tokens = await openMerchantTokens("gift_cards", core.cfg);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const PUBLIC_BASE = (req) => process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`;
function genCode() { const part = () => crypto.randomBytes(2).toString("hex").toUpperCase(); return `GC-${part()}-${part()}`; }
function qrUrl(data, size = 220) { return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`; }

// Card themes (gradient presets) — the visual "templates"
const THEMES = {
  classic: { grad: "linear-gradient(135deg,#3b5bdb,#5c7cfa)", accent: "#3b5bdb", fg: "#fff" },
  midnight: { grad: "linear-gradient(135deg,#0b1021,#1f2a52)", accent: "#7c8cf8", fg: "#fff" },
  sunset: { grad: "linear-gradient(135deg,#ff6b6b,#feca57)", accent: "#ff6b6b", fg: "#1a1a1a" },
  forest: { grad: "linear-gradient(135deg,#0f5132,#2f9e44)", accent: "#2f9e44", fg: "#fff" },
  rose: { grad: "linear-gradient(135deg,#d6336c,#f783ac)", accent: "#d6336c", fg: "#fff" },
  gold: { grad: "linear-gradient(135deg,#7a5901,#c9a227)", accent: "#c9a227", fg: "#1a1a1a" },
};
const themeOf = (d) => THEMES[d?.theme] || { grad: `linear-gradient(135deg,${d?.accent || "#3b5bdb"},${d?.accent || "#5c7cfa"})`, accent: d?.accent || "#3b5bdb", fg: "#fff" };

const serializeDesign = (d, req) => ({ id: d.id, name: d.name, denominations: d.denominations || [], allow_custom: d.allow_custom, min_amount: Number(d.min_amount), max_amount: Number(d.max_amount),
  currency: d.currency, active: d.active, accent: d.accent, theme: d.theme, image: d.image, terms: d.terms, expiry_months: d.expiry_months, public_url: `${PUBLIC_BASE(req)}/gift/${d.id}` });
const serializeCard = (c, req) => ({ id: c.id, code: c.code, amount: Number(c.amount), balance: Number(c.balance), currency: c.currency, recipient_name: c.recipient_name, recipient_email: c.recipient_email,
  message: c.message, state: c.state, deliver_on: c.deliver_on, delivered_at: c.delivered_at, expires_on: c.expires_on, created_at: c.created_at, pdf_url: req ? `${PUBLIC_BASE(req)}/api/cards/${c.id}/pdf` : null });

// ---- Designs (auth) --------------------------------------------------------
app.get("/api/designs", core.requireSession, async (req, res) => {
  const rows = await db.q(`SELECT * FROM designs WHERE merchant_id=$1 ORDER BY id DESC`, [req.session.merchantId]);
  res.json({ designs: rows.map((d) => serializeDesign(d, req)), connected: await tokens.hasToken(req.session.merchantId), ses_configured: sesConfigured(), storage: storageConfigured(), webhook_realtime: Boolean(WEBHOOK_SECRET), themes: Object.keys(THEMES) });
});
function designFields(b, m, d) {
  const denoms = Array.isArray(b.denominations) ? b.denominations.map(round2).filter((n) => n > 0) : (d?.denominations || []);
  return {
    name: String(b.name ?? d?.name ?? "Gift Card").slice(0, 80), denoms, allow_custom: b.allow_custom != null ? !!b.allow_custom : (d?.allow_custom ?? true),
    min_amount: b.min_amount != null ? (round2(b.min_amount) || 500) : Number(d?.min_amount ?? 500), max_amount: b.max_amount != null ? (round2(b.max_amount) || 50000) : Number(d?.max_amount ?? 50000),
    accent: /^#[0-9a-fA-F]{6}$/.test(b.accent) ? b.accent : (d?.accent || "#3b5bdb"), theme: THEMES[b.theme] ? b.theme : (d?.theme || "classic"),
    image: b.image !== undefined ? (b.image || null) : (d?.image ?? null), terms: b.terms !== undefined ? (String(b.terms || "").slice(0, 400) || null) : (d?.terms ?? null),
    expiry_months: b.expiry_months !== undefined ? (Number(b.expiry_months) || null) : (d?.expiry_months ?? null),
  };
}
app.post("/api/designs", core.requireSession, async (req, res) => {
  const m = req.session.data?.merchant || {}; const f = designFields(req.body || {}, m);
  const row = await db.one(`INSERT INTO designs (merchant_id, name, denominations, allow_custom, min_amount, max_amount, currency, accent, theme, image, terms, expiry_months, merchant_name, merchant_logo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.session.merchantId, f.name, JSON.stringify(f.denoms), f.allow_custom, f.min_amount, f.max_amount, m.currency_code || "JMD", f.accent, f.theme, f.image, f.terms, f.expiry_months, m.name || null, m.logo || m.logo_url || null]);
  res.status(201).json({ design: serializeDesign(row, req) });
});
app.patch("/api/designs/:id", core.requireSession, async (req, res) => {
  const d = await db.one(`SELECT * FROM designs WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const b = req.body || {}; const f = designFields(b, {}, d);
  const u = await db.one(`UPDATE designs SET name=$1, denominations=$2, allow_custom=$3, min_amount=$4, max_amount=$5, accent=$6, theme=$7, image=$8, terms=$9, expiry_months=$10, active=$11 WHERE id=$12 RETURNING *`,
    [f.name, JSON.stringify(f.denoms), f.allow_custom, f.min_amount, f.max_amount, f.accent, f.theme, f.image, f.terms, f.expiry_months, b.active != null ? !!b.active : d.active, d.id]);
  res.json({ design: serializeDesign(u, req) });
});
app.delete("/api/designs/:id", core.requireSession, async (req, res) => { await db.run(`DELETE FROM designs WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]); res.json({ ok: true }); });

// Card image upload (S3)
app.post("/api/upload", core.requireSession, async (req, res) => {
  if (!storageConfigured()) return res.status(503).json({ error: "storage_off", message: "Image hosting isn't configured — paste an image URL or pick a theme instead." });
  const decoded = decodeDataUrl(req.body?.data);
  if (!decoded || !isAllowedImage(decoded.contentType)) return res.status(400).json({ error: "bad_image", message: "Upload a JPG, PNG, WEBP or GIF." });
  if (decoded.body.length > 5 * 1024 * 1024) return res.status(400).json({ error: "too_big", message: "Image must be under 5MB." });
  try { const { url } = await putObject({ prefix: `gift-cards/${req.session.merchantId}`, body: decoded.body, contentType: decoded.contentType }); res.json({ url }); }
  catch (err) { res.status(502).json({ error: "upload_failed", message: err?.message }); }
});

// ---- Cards + redemption (auth) ---------------------------------------------
app.get("/api/cards", core.requireSession, async (req, res) => {
  if (req.query.refresh === "1" && !WEBHOOK_SECRET) {
    const awaiting = await db.q(`SELECT * FROM cards WHERE merchant_id=$1 AND state='awaiting' AND inkress_order_id IS NOT NULL LIMIT 25`, [req.session.merchantId]);
    for (const c of awaiting) { try { const ink = await getInkressOrder(core.cfg, req.session.accessToken, c.inkress_order_id); if (ink && isPaidStatus(ink)) await activateCard(c); } catch { /* */ } }
  }
  let rows = await db.q(`SELECT * FROM cards WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 400`, [req.session.merchantId]);
  const all = rows.slice();
  const q = String(req.query.q || "").trim().toLowerCase();
  const filter = String(req.query.filter || "");
  if (q) rows = rows.filter((c) => (c.code + (c.recipient_email || "") + (c.recipient_name || "")).toLowerCase().includes(q));
  if (filter && ["awaiting", "active", "redeemed", "scheduled"].includes(filter)) rows = rows.filter((c) => filter === "scheduled" ? (c.deliver_on && !c.delivered_at && c.state !== "awaiting") : c.state === filter);
  const live = all.filter((c) => c.state === "active" || c.state === "redeemed");
  res.json({ cards: rows.map((c) => serializeCard(c, req)), stats: {
    sold: live.length, outstanding: round2(live.reduce((s, c) => s + Number(c.balance), 0)),
    redeemed_value: round2(all.reduce((s, c) => s + (Number(c.amount) - Number(c.balance)), 0)), awaiting: all.filter((c) => c.state === "awaiting").length } });
});
app.post("/api/cards/lookup", core.requireSession, async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const c = await db.one(`SELECT * FROM cards WHERE merchant_id=$1 AND code=$2`, [req.session.merchantId, code]);
  if (!c) return res.json({ found: false });
  const history = await db.q(`SELECT amount, kind, note, created_at, created_by_name FROM redemptions WHERE card_id=$1 ORDER BY created_at DESC`, [c.id]);
  res.json({ found: true, card: serializeCard(c, req), history });
});
app.post("/api/cards/:id/redeem", core.requireSession, async (req, res) => {
  const c = await db.one(`SELECT * FROM cards WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (c.state === "awaiting") return res.status(400).json({ error: "not_active", message: "This card hasn't been paid for yet." });
  if (c.expires_on && c.expires_on < today()) return res.status(400).json({ error: "expired", message: "This card has expired." });
  const amount = round2(req.body?.amount);
  if (!(amount > 0) || amount > Number(c.balance)) return res.status(400).json({ error: "bad_amount", message: `Enter an amount up to ${c.balance}.` });
  const newBal = round2(Number(c.balance) - amount);
  const u = await db.one(`UPDATE cards SET balance=$1, state=$2 WHERE id=$3 RETURNING *`, [newBal, newBal <= 0 ? "redeemed" : "active", c.id]);
  await db.run(`INSERT INTO redemptions (merchant_id, card_id, code, amount, kind, note, created_by_name) VALUES ($1,$2,$3,$4,'redeem',$5,$6)`,
    [req.session.merchantId, c.id, c.code, amount, req.body?.note || null, req.actor?.name || null]);
  res.json({ card: serializeCard(u, req) });
});
// Manual reload / top-up (merchant adjustment — comp, refund-to-card, etc.)
app.post("/api/cards/:id/reload", core.requireSession, async (req, res) => {
  const c = await db.one(`SELECT * FROM cards WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!c) return res.status(404).json({ error: "not_found" });
  const amount = round2(req.body?.amount);
  if (!(amount > 0)) return res.status(400).json({ error: "bad_amount" });
  const u = await db.one(`UPDATE cards SET balance=balance+$1, amount=amount+$1, state='active' WHERE id=$2 RETURNING *`, [amount, c.id]);
  await db.run(`INSERT INTO redemptions (merchant_id, card_id, code, amount, kind, note, created_by_name) VALUES ($1,$2,$3,$4,'reload',$5,$6)`,
    [req.session.merchantId, c.id, c.code, amount, req.body?.note || "reload", req.actor?.name || null]);
  res.json({ card: serializeCard(u, req) });
});
app.get("/api/redemptions", core.requireSession, async (req, res) => res.json({ redemptions: await db.q(`SELECT id, code, amount, kind, note, created_by_name, created_at FROM redemptions WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 150`, [req.session.merchantId]) }));

// PDF (printable gift card)
app.get("/api/cards/:id/pdf", core.requireSession, async (req, res) => {
  const c = await db.one(`SELECT * FROM cards WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!c) return res.status(404).json({ error: "not_found" });
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [c.design_id]).catch(() => null);
  res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="${c.code}.pdf"`);
  res.send(Buffer.from(await cardPdf(c, d)));
});

app.get("/api/cards.csv", core.requireSession, async (req, res) => {
  const rows = await db.q(`SELECT * FROM cards WHERE merchant_id=$1 ORDER BY created_at DESC`, [req.session.merchantId]);
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((c) => [c.code, c.state, c.amount, c.balance, c.currency, c.recipient_email || "", c.deliver_on || "", c.expires_on || "", c.created_at?.toISOString?.() || c.created_at].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv"); res.setHeader("Content-Disposition", `attachment; filename="gift-cards.csv"`);
  res.send(["code,state,amount,balance,currency,recipient,deliver_on,expires_on,created", ...lines].join("\n"));
});

app.get("/api/status", core.requireSession, async (req, res) => {
  const mid = req.session.merchantId;
  let sub = await db.one(`SELECT * FROM webhook_subs WHERE merchant_id=$1`, [mid]);
  const canRegister = WEBHOOK_SECRET && (req.session.scope || []).includes("webhooks:manage");
  if (!sub && canRegister) {
    const url = `${PUBLIC_BASE(req)}/webhooks/inkress/${mid}`;
    try { await inkressApi(core.cfg, req.session.accessToken, `webhook_urls`, { method: "POST", body: JSON.stringify({ url, event: "orders" }) }); await db.run(`INSERT INTO webhook_subs (merchant_id, url) VALUES ($1,$2) ON CONFLICT (merchant_id) DO UPDATE SET url=$2`, [mid, url]); sub = { merchant_id: mid, url }; }
    catch (err) { if (String(err?.message || "").match(/already|unique|exist|422/i)) { await db.run(`INSERT INTO webhook_subs (merchant_id, url) VALUES ($1,$2) ON CONFLICT (merchant_id) DO NOTHING`, [mid, url]); sub = { merchant_id: mid, url }; } }
  }
  res.json({ realtime: Boolean(sub) && Boolean(WEBHOOK_SECRET), webhook_registered: Boolean(sub), can_register: Boolean(canRegister) });
});

// ---- PUBLIC buy page -------------------------------------------------------
app.get("/gift/:id", async (req, res) => {
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [req.params.id]).catch(() => null);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!d || !d.active) return res.status(404).send(publicShell("Unavailable", `<div class="pad"><h1>Gift cards unavailable</h1></div>`));
  res.send(buyPage(d));
});
app.post("/api/public/gift/:id", express.json(), async (req, res) => {
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [req.params.id]).catch(() => null);
  if (!d || !d.active) return res.status(404).json({ error: "closed" });
  const amount = round2(req.body?.amount);
  if (!(amount >= Number(d.min_amount) && amount <= Number(d.max_amount))) return res.status(400).json({ error: "bad_amount", message: `Amount must be between ${d.min_amount} and ${d.max_amount}.` });
  const recipient_email = String(req.body?.recipient_email || "").trim().toLowerCase();
  const buyer_email = String(req.body?.buyer_email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient_email)) return res.status(400).json({ error: "bad_email", message: "Enter the recipient's email." });
  const deliverOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.deliver_on) && req.body.deliver_on > today() ? req.body.deliver_on : null;
  let accessToken;
  try { accessToken = await tokens.accessTokenFor(d.merchant_id); } catch { return res.status(503).json({ error: "not_connected", message: "This shop hasn't finished setup." }); }
  const ref = `giftcard-${d.merchant_id}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  let created;
  try {
    created = await createInkressOrder(core.cfg, accessToken, {
      referenceId: ref, total: amount, currencyCode: d.currency, kind: "online", title: `Gift card — ${d.name}`,
      customer: { email: buyer_email || recipient_email, first_name: "Gift", last_name: "Buyer" },
      metaData: { source: "gift-cards", design_id: d.id, recipient: recipient_email },
    });
  } catch (err) { return res.status(502).json({ error: "order_failed", message: err?.message }); }
  const expires_on = d.expiry_months ? new Date(Date.now() + d.expiry_months * 30 * 86400000).toISOString().slice(0, 10) : null;
  await db.run(`INSERT INTO cards (merchant_id, design_id, code, amount, balance, currency, recipient_name, recipient_email, buyer_email, message, ref, inkress_order_id, payment_url, deliver_on, expires_on)
    VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [d.merchant_id, d.id, genCode(), amount, d.currency, req.body?.recipient_name || null, recipient_email, buyer_email || null, String(req.body?.message || "").slice(0, 300), ref, created.id != null ? String(created.id) : null, created.payment_url || null, deliverOn, expires_on]);
  res.json({ payment_url: created.payment_url });
});

// ---- PUBLIC balance check --------------------------------------------------
app.get("/balance", async (req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.send(balancePage()); });
app.post("/api/public/balance", express.json(), async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const c = await db.one(`SELECT * FROM cards WHERE code=$1 AND state IN ('active','redeemed')`, [code]).catch(() => null);
  if (!c) return res.json({ found: false });
  const history = await db.q(`SELECT amount, kind, created_at FROM redemptions WHERE card_id=$1 ORDER BY created_at DESC LIMIT 20`, [c.id]);
  res.json({ found: true, balance: Number(c.balance), amount: Number(c.amount), currency: c.currency, expires_on: c.expires_on, history });
});

// ---- Webhook receiver — activate card on payment ---------------------------
async function activateCard(c) {
  await db.run(`UPDATE cards SET state='active' WHERE id=$1 AND state='awaiting'`, [c.id]);
  if (c.deliver_on && c.deliver_on > today()) return; // scheduled — deliver later via scheduler
  await emailCard({ ...c, state: "active" }).catch(() => {});
  await db.run(`UPDATE cards SET delivered_at=now() WHERE id=$1 AND delivered_at IS NULL`, [c.id]);
}
app.post("/webhooks/inkress/:merchantId", async (req, res) => {
  const merchantId = Number(req.params.merchantId);
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (WEBHOOK_SECRET) {
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("base64");
    const got = String(req.get("x-inkress-webhook-signature") || "");
    const a = Buffer.from(expected), b = Buffer.from(got);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "bad_signature" });
  }
  res.json({ received: true });
  try {
    const evt = JSON.parse(raw.toString("utf8"));
    const o = evt?.order || evt?.data?.order;
    if (!o || !merchantId || String(o.status || "").toLowerCase() !== "paid") return;
    const wid = String(req.get("x-inkress-webhook-id") || `${o.id}.${o.status}`);
    if (await db.one(`SELECT 1 FROM webhook_seen WHERE webhook_id=$1`, [wid])) return;
    await db.run(`INSERT INTO webhook_seen (webhook_id) VALUES ($1) ON CONFLICT DO NOTHING`, [wid]);
    const c = await db.one(`SELECT * FROM cards WHERE merchant_id=$1 AND inkress_order_id=$2 AND state='awaiting'`, [merchantId, String(o.id)]);
    if (c) await activateCard(c);
  } catch (err) { console.error(`[gift-cards] webhook failed: ${err?.message}`); }
});

// ---- Scheduler: deliver scheduled cards on their date ----------------------
async function runDelivery() {
  try {
    const due = await db.q(`SELECT * FROM cards WHERE state='active' AND delivered_at IS NULL AND deliver_on IS NOT NULL AND deliver_on <= $1 LIMIT 100`, [today()]);
    for (const c of due) { try { await emailCard(c); await db.run(`UPDATE cards SET delivered_at=now() WHERE id=$1`, [c.id]); } catch { /* */ } }
  } catch (err) { console.error(`[gift-cards] delivery: ${err?.message}`); }
}
setInterval(runDelivery, 3600 * 1000); setTimeout(runDelivery, 50000);

async function emailCard(card) {
  if (!sesConfigured() || !card.recipient_email) return;
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [card.design_id]).catch(() => null);
  const shop = d?.merchant_name || "a shop";
  await sendEmail({ to: card.recipient_email, subject: `🎁 You've got a gift card from ${shop}`, html: cardEmail(shop, card, d, PUBLIC_BASE({ get: () => process.env.PUBLIC_BASE_URL?.replace(/^https?:\/\//, "") || "" })) });
}

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[gift-cards] listening on ${HOST}:${PORT}`));

// ---- html / pdf ------------------------------------------------------------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function money(n, c) { try { return new Intl.NumberFormat("en-JM", { style: "currency", currency: c }).format(n); } catch { return `${c} ${n}`; } }
function cardVisual(card, d) {
  const t = themeOf(d);
  const bg = d?.image ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url('${esc(d.image)}');background-size:cover;background-position:center` : `background:${t.grad}`;
  return `<div style="${bg};color:${t.fg};border-radius:16px;padding:20px;text-align:left;position:relative;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;">${esc(d?.name || "Gift Card")}</div>
    <div style="font-size:30px;font-weight:800;margin:6px 0 14px;">${esc(money(Number(card.amount), card.currency))}</div>
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="${qrUrl(card.code, 96)}" width="72" height="72" style="border-radius:8px;background:#fff;padding:4px;" alt="">
      <div><div style="font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.05em;">Code</div><div style="font-family:ui-monospace,monospace;font-size:18px;font-weight:700;letter-spacing:.06em;">${esc(card.code)}</div></div>
    </div></div>`;
}
function cardEmail(shop, card, d, base) {
  return `<div style="font-family:system-ui,sans-serif;max-width:460px;margin:0 auto;text-align:center;color:#1a1a1a;">
    <div style="font-size:40px;">🎁</div><h2 style="margin:4px 0 6px;">A gift from ${esc(shop)}</h2>
    ${card.message ? `<p style="color:#555;">"${esc(card.message)}"</p>` : ""}
    ${cardVisual(card, d)}
    ${card.expires_on ? `<p style="color:#999;font-size:12px;margin-top:10px;">Valid until ${esc(card.expires_on)}</p>` : ""}
    ${base ? `<p style="margin-top:12px;"><a href="${esc(base)}/balance" style="color:${esc(themeOf(d).accent)};font-size:13px;">Check your balance</a></p>` : ""}
    <p style="color:#aaa;font-size:12px;">Show this code or QR in store at ${esc(shop)} · via Marketplace</p></div>`;
}
function publicShell(title, inner, accent = "#3b5bdb") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1f2430;display:grid;place-items:center;min-height:100vh;padding:20px}
  .card{background:#fff;border:1px solid #e9ebef;border-radius:18px;box-shadow:0 14px 44px rgba(20,25,40,.12);max-width:440px;width:100%;overflow:hidden}
  .accent{height:4px;background:${accent}} .pad{padding:26px}
  .gcv{margin-bottom:16px}
  .logo{width:60px;height:60px;border-radius:16px;object-fit:cover;margin:0 auto 12px;display:block;border:1px solid #eee}
  h1{font-size:1.5rem;margin:0 0 6px;text-align:center} .blurb{color:#6b7280;text-align:center;margin:0 0 16px}
  .denoms{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px}
  .den{padding:10px 16px;border:1px solid #d4d8df;border-radius:10px;cursor:pointer;font-weight:600}.den.sel{border-color:${accent};background:#eef1fd;color:${accent}}
  label.fld{display:block;text-align:left;font-size:12px;color:#6b7280;margin:8px 0 3px}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d4d8df;border-radius:10px;font-size:15px;margin-bottom:6px}
  button{width:100%;padding:14px;border:0;border-radius:10px;background:${accent};color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  .bal{font-size:2rem;font-weight:800;text-align:center;margin:10px 0}.terms{color:#9aa;font-size:11px;text-align:center;margin-top:10px}
  .foot{text-align:center;color:#aab;font-size:12px;padding:14px}</style></head>
  <body><div class="card"><div class="accent"></div>${inner}<div class="foot">powered by Marketplace</div></div></body></html>`;
}
function buyPage(d) {
  const t = themeOf(d);
  const logo = d.merchant_logo ? `<img class="logo" src="${esc(d.merchant_logo)}" alt="">` : "";
  const denoms = (d.denominations || []).map((a) => `<div class="den" data-a="${a}">${esc(money(Number(a), d.currency))}</div>`).join("");
  const preview = cardVisual({ amount: d.denominations?.[0] || d.min_amount, currency: d.currency, code: "GC-XXXX-XXXX" }, d);
  return publicShell(`${d.name}`, `<div class="pad">${logo}
    <h1>${esc(d.name)}</h1><p class="blurb">A gift card for ${esc(d.merchant_name || "our shop")}</p>
    <div class="gcv">${preview}</div>
    <div class="denoms">${denoms}</div>
    ${d.allow_custom ? `<label class="fld">Custom amount (${esc(money(Number(d.min_amount), d.currency))}–${esc(money(Number(d.max_amount), d.currency))})</label><input id="amt" type="number" min="${d.min_amount}" max="${d.max_amount}" placeholder="Amount">` : `<input id="amt" type="hidden">`}
    <label class="fld">Recipient name (optional)</label><input id="rn" placeholder="Who's it for?">
    <label class="fld">Recipient email</label><input id="re" type="email" required placeholder="recipient@email.com">
    <label class="fld">Short message (optional)</label><input id="msg" placeholder="Happy birthday!">
    <label class="fld">Deliver on (optional — schedule the gift)</label><input id="don" type="date">
    <label class="fld">Your email (optional, for the receipt)</label><input id="be" type="email" placeholder="you@email.com">
    <button id="buy">Buy gift card</button>
    <div id="msgbox" style="display:none;color:#6b7280;text-align:center;margin-top:10px"></div>
    ${d.terms ? `<div class="terms">${esc(d.terms)}</div>` : ""}
    <script>let amt=0;document.querySelectorAll('.den').forEach(x=>x.addEventListener('click',()=>{document.querySelectorAll('.den').forEach(y=>y.classList.remove('sel'));x.classList.add('sel');amt=Number(x.dataset.a);const ai=document.getElementById('amt');if(ai.type!=='hidden')ai.value=amt;}));
    document.getElementById('buy').addEventListener('click',async()=>{const ai=document.getElementById('amt');const a=ai.type==='hidden'?amt:(Number(ai.value)||amt);if(!a){showMsg('Pick or enter an amount.');return;}const re=document.getElementById('re').value;if(!re){showMsg('Enter the recipient email.');return;}const b=document.getElementById('buy');b.disabled=true;b.textContent='Creating your link…';const r=await fetch('/api/public/gift/${d.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:a,recipient_name:document.getElementById('rn').value,recipient_email:re,message:document.getElementById('msg').value,deliver_on:document.getElementById('don').value,buyer_email:document.getElementById('be').value})});const j=await r.json();if(j.payment_url){window.location.href=j.payment_url;}else{b.disabled=false;b.textContent='Buy gift card';showMsg(j.message||'Something went wrong.');}});
    function showMsg(t){const m=document.getElementById('msgbox');m.style.display='block';m.textContent=t;}</script></div>`, t.accent);
}
function balancePage() {
  return publicShell("Check gift card balance", `<div class="pad">
    <h1>Gift card balance</h1><p class="blurb">Enter your gift card code to see what's left.</p>
    <input id="code" placeholder="GC-XXXX-XXXX" style="text-transform:uppercase;text-align:center;font-family:ui-monospace,monospace;letter-spacing:.08em">
    <button id="chk">Check balance</button>
    <div id="out" style="display:none;margin-top:14px"></div>
    <script>document.getElementById('chk').addEventListener('click',async()=>{const code=document.getElementById('code').value.trim().toUpperCase();if(!code)return;const r=await fetch('/api/public/balance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const j=await r.json();const o=document.getElementById('out');o.style.display='block';if(!j.found){o.innerHTML='<p style="text-align:center;color:#c92a2a">No active card with that code.</p>';return;}const f=(n)=>new Intl.NumberFormat('en-JM',{style:'currency',currency:j.currency}).format(n);o.innerHTML='<div class="bal">'+f(j.balance)+'</div><p style="text-align:center;color:#6b7280">of '+f(j.amount)+(j.expires_on?' · valid until '+j.expires_on:'')+'</p>';});</script></div>`);
}
async function cardPdf(c, d) {
  const t = themeOf(d);
  const totals = [{ label: "Original value", value: money(Number(c.amount), c.currency) }, { label: "Current balance", value: money(Number(c.balance), c.currency), bold: true }];
  const meta = [{ label: "Code", value: c.code }];
  if (c.recipient_name) meta.push({ label: "For", value: c.recipient_name });
  if (c.expires_on) meta.push({ label: "Valid until", value: String(c.expires_on).slice(0, 10) });
  return documentPdf({ brand: { name: d?.merchant_name || "Gift Card", accent: t.accent }, title: "Gift Card", number: c.code, badge: c.state === "redeemed" ? "USED" : "GIFT",
    meta, items: [], totals, note: [c.message ? `"${c.message}"` : "", d?.terms || "", "Present this code or its QR in store to redeem."].filter(Boolean).join("\n\n"), footer: d?.merchant_name || "Thank you." });
}
