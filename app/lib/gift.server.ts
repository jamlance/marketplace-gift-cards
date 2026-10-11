// Gift card domain: typed rows, queries and every change a merchant can make. SERVER ONLY.
// History lives in the `redemptions` table (one row per event, `kind` says what happened); the name is
// the original app's and is kept so existing data reads correctly.
import type { SchemaPg } from "@inkress/app-kit/server";
import { newCode, sendCardEmail, today } from "./app-kit.server.mjs";
import { money } from "./card-design.mjs";
import {
  CardState,
  CardFilter,
  CardSource,
  IssueReason,
  ISSUE_REASON_LABEL,
  HistoryKind,
  EXPIRING_DAYS,
  PAGE_SIZE,
  CardStatus,
  statusOf,
  daysBetween,
  SendResult,
  ISSUE_LIMITS,
  BulkAction,
  type Card,
  type HistoryEntry,
  type IssueInput,
  type IssueLimits,
  type BulkResult,
  type Design,
  type DesignInput,
  type MerchantSettings,
} from "./gift";
export {
  CardState,
  CardFilter,
  CardSource,
  IssueReason,
  ISSUE_REASON_LABEL,
  HistoryKind,
  EXPIRING_DAYS,
  PAGE_SIZE,
  CardStatus,
  statusOf,
  daysBetween,
  SendResult,
  ISSUE_LIMITS,
  BulkAction,
  type Card,
  type HistoryEntry,
  type IssueInput,
  type IssueLimits,
  type BulkResult,
  type Design,
  type DesignInput,
  type MerchantSettings,
};


// ---- value sets -------------------------------------------------------------------------------

// ---- rows -------------------------------------------------------------------------------------

interface CardRow {
  id: string;
  merchant_id: string;
  design_id: string | null;
  code: string;
  amount: string;
  balance: string;
  currency: string;
  recipient_name: string | null;
  recipient_email: string | null;
  buyer_email: string | null;
  message: string | null;
  state: CardState;
  deliver_on: string | Date | null;
  delivered_at: Date | null;
  expires_on: string | Date | null;
  created_at: Date;
  source: CardSource;
  reason: IssueReason | null;
  deactivated_at: Date | null;
  reminded_at: Date | null;
  payment_url: string | null;
  design_name?: string | null;
}

const dateOnly = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function toCard(r: CardRow): Card {
  return {
    id: Number(r.id),
    code: r.code,
    amount: Number(r.amount),
    balance: Number(r.balance),
    currency: r.currency,
    recipientName: r.recipient_name,
    recipientEmail: r.recipient_email,
    buyerEmail: r.buyer_email,
    message: r.message,
    state: r.state,
    deliverOn: dateOnly(r.deliver_on),
    deliveredAt: iso(r.delivered_at),
    expiresOn: dateOnly(r.expires_on),
    createdAt: iso(r.created_at)!,
    source: r.source ?? CardSource.Online,
    reason: r.reason,
    designId: r.design_id != null ? Number(r.design_id) : null,
    designName: r.design_name ?? null,
    remindedAt: iso(r.reminded_at),
    paymentUrl: r.payment_url,
  };
}

const round2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

function addMonths(months: number, from: string = today()): string {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** A change was refused for a reason the merchant can fix. */
export class GiftCardError extends Error {}

// ---- list -------------------------------------------------------------------------------------

const FILTER_SQL: Record<CardFilter, string> = {
  active: `state='active' AND balance > 0 AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)`,
  expiring: `state='active' AND balance > 0 AND expires_on IS NOT NULL AND expires_on >= CURRENT_DATE AND expires_on <= CURRENT_DATE + ${EXPIRING_DAYS}`,
  used: `(state='redeemed' OR (state='active' AND balance <= 0))`,
  expired: `state='active' AND balance > 0 AND expires_on < CURRENT_DATE`,
  awaiting: `state='awaiting'`,
  off: `state='deactivated'`,
  all: `TRUE`,
};

export function parseFilter(v: string | null): CardFilter {
  return (Object.values(CardFilter) as string[]).includes(v ?? "") ? (v as CardFilter) : CardFilter.Active;
}

export interface CardListQuery {
  filter: CardFilter;
  q: string;
  source: CardSource | "";
  designId: number | null;
  /** Cursor: show cards older than this id. */
  after: number | null;
}

export interface CardPage {
  cards: Card[];
  nextAfter: number | null;
  hasPrev: boolean;
  /** Matching cards across all pages. */
  total: number;
}

export async function listCards(db: SchemaPg, merchantId: number, query: CardListQuery): Promise<CardPage> {
  const where = [`c.merchant_id=$1`, FILTER_SQL[query.filter].replace(/\b(state|balance|expires_on)\b/g, "c.$1")];
  const params: unknown[] = [merchantId];
  if (query.q) {
    params.push(`%${query.q.toLowerCase()}%`);
    where.push(`(lower(c.code) LIKE $${params.length} OR lower(coalesce(c.recipient_email,'')) LIKE $${params.length} OR lower(coalesce(c.recipient_name,'')) LIKE $${params.length} OR lower(coalesce(c.buyer_email,'')) LIKE $${params.length})`);
  }
  if (query.source) {
    params.push(query.source);
    where.push(`c.source=$${params.length}`);
  }
  if (query.designId) {
    params.push(query.designId);
    where.push(`c.design_id=$${params.length}`);
  }
  const base = where.join(" AND ");
  const totalRow = await db.one<{ n: string }>(`SELECT count(*) n FROM cards c WHERE ${base}`, params);
  const pageParams = [...params];
  let cursor = "";
  if (query.after) {
    pageParams.push(query.after);
    cursor = ` AND c.id < $${pageParams.length}`;
  }
  const rows = await db.q<CardRow>(
    `SELECT c.*, d.name AS design_name FROM cards c LEFT JOIN designs d ON d.id=c.design_id WHERE ${base}${cursor} ORDER BY c.id DESC LIMIT ${PAGE_SIZE + 1}`,
    pageParams,
  );
  const cards = rows.slice(0, PAGE_SIZE).map(toCard);
  return { cards, nextAfter: rows.length > PAGE_SIZE ? cards[cards.length - 1]!.id : null, hasPrev: Boolean(query.after), total: Number(totalRow?.n ?? 0) };
}

export async function filterCounts(db: SchemaPg, merchantId: number): Promise<Record<CardFilter, number>> {
  const cols = (Object.keys(FILTER_SQL) as CardFilter[]).map((k) => `count(*) FILTER (WHERE ${FILTER_SQL[k]})::int AS "${k}"`).join(", ");
  const r = await db.one<Record<CardFilter, number>>(`SELECT ${cols} FROM cards WHERE merchant_id=$1`, [merchantId]);
  return r ?? { active: 0, expiring: 0, used: 0, expired: 0, awaiting: 0, off: 0, all: 0 };
}

// ---- overview ---------------------------------------------------------------------------------

export interface Overview {
  soldThisMonth: number;
  soldLastMonth: number;
  outstanding: number;
  activeCards: number;
  redeemedThisMonth: number;
  redeemedLastMonth: number;
  expiringValue: number;
  expiringCount: number;
  awaitingStale: number;
  weekly: Array<{ weekStart: string; total: number }>;
  hasCards: boolean;
}

export async function overview(db: SchemaPg, merchantId: number): Promise<Overview> {
  const [money, redeemed, weekly] = await Promise.all([
    db.one<Record<string, string>>(
      `SELECT
         coalesce(sum(amount) FILTER (WHERE source='online' AND state<>'awaiting' AND created_at >= date_trunc('month', now())),0) sold_this,
         coalesce(sum(amount) FILTER (WHERE source='online' AND state<>'awaiting' AND created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now())),0) sold_last,
         coalesce(sum(balance) FILTER (WHERE ${FILTER_SQL.active}),0) outstanding,
         count(*) FILTER (WHERE ${FILTER_SQL.active}) active_cards,
         coalesce(sum(balance) FILTER (WHERE ${FILTER_SQL.expiring}),0) expiring_value,
         count(*) FILTER (WHERE ${FILTER_SQL.expiring}) expiring_count,
         count(*) FILTER (WHERE state='awaiting' AND created_at < now() - interval '1 day') awaiting_stale,
         count(*) FILTER (WHERE state<>'awaiting') any_cards
       FROM cards WHERE merchant_id=$1`,
      [merchantId],
    ),
    db.one<Record<string, string>>(
      `SELECT
         coalesce(sum(amount) FILTER (WHERE created_at >= date_trunc('month', now())),0) this_month,
         coalesce(sum(amount) FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now())),0) last_month
       FROM redemptions WHERE merchant_id=$1 AND kind='redeem'`,
      [merchantId],
    ),
    db.q<{ week: Date; total: string }>(
      `SELECT w.week, coalesce(sum(c.amount),0) total
         FROM generate_series(date_trunc('week', now()) - interval '13 weeks', date_trunc('week', now()), interval '1 week') AS w(week)
         LEFT JOIN cards c ON c.merchant_id=$1 AND c.source='online' AND c.state<>'awaiting' AND date_trunc('week', c.created_at)=w.week
        GROUP BY w.week ORDER BY w.week`,
      [merchantId],
    ),
  ]);
  const n = (k: string, src: Record<string, string> | null) => Number(src?.[k] ?? 0);
  return {
    soldThisMonth: n("sold_this", money),
    soldLastMonth: n("sold_last", money),
    outstanding: n("outstanding", money),
    activeCards: n("active_cards", money),
    redeemedThisMonth: n("this_month", redeemed),
    redeemedLastMonth: n("last_month", redeemed),
    expiringValue: n("expiring_value", money),
    expiringCount: n("expiring_count", money),
    awaitingStale: n("awaiting_stale", money),
    weekly: weekly.map((w) => ({ weekStart: w.week.toISOString().slice(0, 10), total: Number(w.total) })),
    hasCards: n("any_cards", money) > 0,
  };
}

// ---- one card ---------------------------------------------------------------------------------

export async function getCard(db: SchemaPg, merchantId: number, id: number): Promise<Card | null> {
  const r = await db.one<CardRow>(`SELECT c.*, d.name AS design_name FROM cards c LEFT JOIN designs d ON d.id=c.design_id WHERE c.id=$1 AND c.merchant_id=$2`, [id, merchantId]);
  return r ? toCard(r) : null;
}

export async function findByCode(db: SchemaPg, merchantId: number, code: string): Promise<Card | null> {
  const r = await db.one<CardRow>(`SELECT c.*, d.name AS design_name FROM cards c LEFT JOIN designs d ON d.id=c.design_id WHERE c.merchant_id=$1 AND upper(c.code)=$2`, [merchantId, code.trim().toUpperCase()]);
  return r ? toCard(r) : null;
}

export async function cardHistory(db: SchemaPg, cardId: number): Promise<HistoryEntry[]> {
  const rows = await db.q<{ id: string; kind: HistoryKind; amount: string | null; note: string | null; created_by_name: string | null; created_at: Date }>(
    `SELECT id, kind, amount, note, created_by_name, created_at FROM redemptions WHERE card_id=$1 ORDER BY created_at DESC, id DESC LIMIT 200`,
    [cardId],
  );
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, amount: r.amount != null ? Number(r.amount) : null, note: r.note, by: r.created_by_name, at: r.created_at.toISOString() }));
}

async function log(db: SchemaPg, card: Card, merchantId: number, kind: HistoryKind, amount: number | null, note: string | null, by: string | null): Promise<void> {
  await db.run(`INSERT INTO redemptions (merchant_id, card_id, code, amount, kind, note, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [merchantId, card.id, card.code, amount, kind, note, by]);
}

function assertUsable(c: Card): void {
  if (c.state === CardState.Awaiting) throw new GiftCardError("This card hasn't been paid for yet.");
  if (c.state === CardState.Deactivated) throw new GiftCardError("This card is turned off. Turn it back on first.");
  if (c.expiresOn && c.expiresOn < today()) throw new GiftCardError("This card has expired. Extend it first.");
}

export async function redeem(db: SchemaPg, merchantId: number, card: Card, amountIn: unknown, note: string | null, by: string | null): Promise<Card> {
  assertUsable(card);
  const amount = round2(amountIn);
  if (!(amount > 0)) throw new GiftCardError("Enter how much to take off the card.");
  if (amount > card.balance) throw new GiftCardError(`The card only has ${money(card.balance, card.currency)} left.`);
  const balance = round2(card.balance - amount);
  await db.run(`UPDATE cards SET balance=$1, state=$2 WHERE id=$3 AND merchant_id=$4`, [balance, balance <= 0 ? CardState.Redeemed : CardState.Active, card.id, merchantId]);
  await log(db, card, merchantId, HistoryKind.Redeem, amount, note, by);
  return { ...card, balance, state: balance <= 0 ? CardState.Redeemed : CardState.Active };
}

export async function topUp(db: SchemaPg, merchantId: number, card: Card, amountIn: unknown, note: string | null, by: string | null): Promise<void> {
  if (card.state === CardState.Awaiting) throw new GiftCardError("This card hasn't been paid for yet.");
  const amount = round2(amountIn);
  if (!(amount > 0)) throw new GiftCardError("Enter how much to add.");
  await db.run(`UPDATE cards SET balance=balance+$1, amount=amount+$1, state=CASE WHEN state='deactivated' THEN state ELSE 'active' END WHERE id=$2 AND merchant_id=$3`, [amount, card.id, merchantId]);
  await log(db, card, merchantId, HistoryKind.Reload, amount, note, by);
}

export async function extend(db: SchemaPg, merchantId: number, card: Card, until: string | null, by: string | null): Promise<void> {
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new GiftCardError("Pick a date.");
  if (until && until <= today()) throw new GiftCardError("Pick a date after today.");
  await db.run(`UPDATE cards SET expires_on=$1 WHERE id=$2 AND merchant_id=$3`, [until, card.id, merchantId]);
  await log(db, card, merchantId, HistoryKind.Extended, null, until ? `Now expires ${until}` : "No expiry", by);
}

export async function setActive(db: SchemaPg, merchantId: number, card: Card, on: boolean, by: string | null): Promise<void> {
  if (card.state === CardState.Awaiting) throw new GiftCardError("This card hasn't been paid for yet.");
  if (on) {
    if (card.state !== CardState.Deactivated) return;
    await db.run(`UPDATE cards SET state=CASE WHEN balance<=0 THEN 'redeemed' ELSE 'active' END, deactivated_at=NULL WHERE id=$1 AND merchant_id=$2`, [card.id, merchantId]);
    await log(db, card, merchantId, HistoryKind.Reactivated, null, null, by);
  } else {
    if (card.state === CardState.Deactivated) return;
    await db.run(`UPDATE cards SET state='deactivated', deactivated_at=now() WHERE id=$1 AND merchant_id=$2`, [card.id, merchantId]);
    await log(db, card, merchantId, HistoryKind.Deactivated, null, null, by);
  }
}

/** Email the card again (or a reminder). */
export async function resend(db: SchemaPg, merchantId: number, card: Card, by: string | null, reminder = false): Promise<SendResult> {
  assertUsable(card);
  if (!card.recipientEmail) return SendResult.NoEmail;
  const ok = await sendCardEmail(rowForEmail(card, merchantId));
  if (!ok) return SendResult.EmailOff;
  if (reminder) await db.run(`UPDATE cards SET reminded_at=now() WHERE id=$1`, [card.id]);
  await db.run(`UPDATE cards SET delivered_at=coalesce(delivered_at, now()) WHERE id=$1`, [card.id]);
  await log(db, card, merchantId, reminder ? HistoryKind.Reminded : HistoryKind.Resent, null, `Emailed ${card.recipientEmail}`, by);
  return SendResult.Sent;
}

function rowForEmail(c: Card, merchantId: number) {
  return { id: c.id, merchant_id: merchantId, design_id: c.designId, code: c.code, amount: c.balance > 0 ? c.balance : c.amount, currency: c.currency, recipient_name: c.recipientName, recipient_email: c.recipientEmail, message: c.message, expires_on: c.expiresOn };
}

export async function addNote(db: SchemaPg, merchantId: number, card: Card, note: string, by: string | null): Promise<void> {
  const text = note.trim().slice(0, 500);
  if (!text) throw new GiftCardError("Write the note first.");
  await log(db, card, merchantId, HistoryKind.Note, null, text, by);
}

// ---- issue ------------------------------------------------------------------------------------

export function parseIssue(form: FormData): IssueInput | { error: Record<string, string> } {
  const errors: Record<string, string> = {};
  const reason = String(form.get("reason") || "") as IssueReason;
  if (!(Object.values(IssueReason) as string[]).includes(reason)) errors.reason = "Pick why you're giving this card.";
  const to = String(form.get("recipient") || "").trim();
  const name = String(form.get("recipient_name") || "").trim() || null;
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to);
  if (to && !isEmail) errors.recipient = "Enter an email address, or leave it empty to hand the code over yourself.";
  const amount = round2(form.get("amount"));
  if (!(amount >= ISSUE_LIMITS.min && amount <= ISSUE_LIMITS.max)) errors.amount = `Between ${ISSUE_LIMITS.min.toLocaleString()} and ${ISSUE_LIMITS.max.toLocaleString()}.`;
  const expiresOn = String(form.get("expires_on") || "") || null;
  if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || expiresOn <= today())) errors.expires_on = "Pick a date after today, or leave it empty for no expiry.";
  if (Object.keys(errors).length) return { error: errors };
  return {
    reason,
    recipientName: name,
    recipientEmail: isEmail ? to.toLowerCase() : null,
    amount,
    expiresOn,
    message: String(form.get("message") || "").trim().slice(0, 300) || null,
    designId: Number(form.get("design_id")) || null,
    send: form.get("send") === "on" && isEmail,
  };
}

export async function issueCard(db: SchemaPg, merchantId: number, currency: string, input: IssueInput, by: string | null): Promise<{ card: Card; sent: boolean }> {
  let code = newCode();
  for (let i = 0; i < 5 && (await db.one(`SELECT 1 FROM cards WHERE merchant_id=$1 AND code=$2`, [merchantId, code])); i++) code = newCode();
  const row = await db.one<CardRow>(
    `INSERT INTO cards (merchant_id, design_id, code, amount, balance, currency, recipient_name, recipient_email, message, state, expires_on, source, reason, ref)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,'active',$9,'issued',$10,$11) RETURNING *`,
    [merchantId, input.designId, code, input.amount, currency, input.recipientName, input.recipientEmail, input.message, input.expiresOn, input.reason, `issued-${merchantId}-${Date.now().toString(36)}`],
  );
  const card = toCard(row!);
  await log(db, card, merchantId, HistoryKind.Issued, input.amount, ISSUE_REASON_LABEL[input.reason], by);
  let sent = false;
  if (input.send) {
    sent = await sendCardEmail(rowForEmail(card, merchantId)).catch(() => false);
    if (sent) {
      await db.run(`UPDATE cards SET delivered_at=now() WHERE id=$1`, [card.id]);
      await log(db, card, merchantId, HistoryKind.Resent, null, `Emailed ${card.recipientEmail}`, by);
    }
  }
  return { card, sent };
}

export function defaultExpiry(months: number | null): string | null {
  return months ? addMonths(months) : null;
}

/** People who've had a card from this merchant before, for the "Send to" search. */
export async function searchRecipients(db: SchemaPg, merchantId: number, q: string): Promise<Array<{ email: string; name: string | null; cards: number }>> {
  const like = `%${q.toLowerCase()}%`;
  const rows = await db.q<{ email: string; name: string | null; cards: string }>(
    `SELECT lower(recipient_email) email, max(recipient_name) name, count(*) cards FROM cards
      WHERE merchant_id=$1 AND recipient_email IS NOT NULL AND (lower(recipient_email) LIKE $2 OR lower(coalesce(recipient_name,'')) LIKE $2)
      GROUP BY lower(recipient_email) ORDER BY count(*) DESC LIMIT 8`,
    [merchantId, like],
  );
  return rows.map((r) => ({ email: r.email, name: r.name, cards: Number(r.cards) }));
}

// ---- bulk -------------------------------------------------------------------------------------

export async function bulk(db: SchemaPg, merchantId: number, action: BulkAction, ids: number[], by: string | null, extendMonths = 3): Promise<BulkResult> {
  let done = 0;
  let skipped = 0;
  for (const id of ids.slice(0, 200)) {
    const card = await getCard(db, merchantId, id);
    if (!card) {
      skipped++;
      continue;
    }
    try {
      if (action === BulkAction.Resend) {
        if ((await resend(db, merchantId, card, by)) === SendResult.Sent) done++;
        else skipped++;
      } else if (action === BulkAction.Extend) {
        const from = card.expiresOn && card.expiresOn > today() ? card.expiresOn : today();
        await extend(db, merchantId, card, addMonths(extendMonths, from), by);
        done++;
      } else {
        await setActive(db, merchantId, card, false, by);
        done++;
      }
    } catch {
      skipped++;
    }
  }
  return { done, skipped };
}

// ---- redemptions (merchant-wide history) ------------------------------------------------------

export async function recentRedemptions(db: SchemaPg, merchantId: number, before: number | null): Promise<{ rows: HistoryEntry[]; nextBefore: number | null }> {
  const params: unknown[] = [merchantId];
  let cursor = "";
  if (before) {
    params.push(before);
    cursor = ` AND id < $2`;
  }
  const rows = await db.q<{ id: string; kind: HistoryKind; amount: string | null; note: string | null; created_by_name: string | null; created_at: Date; code: string; card_id: string | null }>(
    `SELECT id, kind, amount, note, created_by_name, created_at, code, card_id FROM redemptions WHERE merchant_id=$1 AND kind IN ('redeem','reload')${cursor} ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`,
    params,
  );
  const page = rows.slice(0, PAGE_SIZE).map((r) => ({ id: Number(r.id), kind: r.kind, amount: r.amount != null ? Number(r.amount) : null, note: r.note, by: r.created_by_name, at: r.created_at.toISOString(), code: r.code, cardId: r.card_id != null ? Number(r.card_id) : null }));
  return { rows: page, nextBefore: rows.length > PAGE_SIZE ? page[page.length - 1]!.id : null };
}

// ---- designs ----------------------------------------------------------------------------------

interface DesignRow {
  id: string;
  name: string;
  denominations: number[] | string;
  allow_custom: boolean;
  min_amount: string;
  max_amount: string;
  currency: string;
  active: boolean;
  accent: string;
  theme: string;
  image: string | null;
  terms: string | null;
  expiry_months: number | null;
  merchant_name: string | null;
  merchant_logo: string | null;
  sold?: string;
}

function toDesign(r: DesignRow): Design {
  const amounts = (Array.isArray(r.denominations) ? r.denominations : JSON.parse(String(r.denominations || "[]"))).map(Number).filter((n: number) => n > 0);
  return {
    id: Number(r.id),
    name: r.name,
    amounts,
    allowCustom: r.allow_custom,
    minAmount: Number(r.min_amount),
    maxAmount: Number(r.max_amount),
    currency: r.currency,
    active: r.active,
    accent: r.accent,
    theme: r.theme,
    image: r.image,
    terms: r.terms,
    expiryMonths: r.expiry_months,
    merchantName: r.merchant_name,
    merchantLogo: r.merchant_logo,
    sold: Number(r.sold ?? 0),
  };
}

export async function listDesigns(db: SchemaPg, merchantId: number): Promise<Design[]> {
  const rows = await db.q<DesignRow>(
    `SELECT d.*, (SELECT count(*) FROM cards c WHERE c.design_id=d.id AND c.state<>'awaiting') sold FROM designs d WHERE d.merchant_id=$1 ORDER BY d.active DESC, d.id DESC`,
    [merchantId],
  );
  return rows.map(toDesign);
}

export async function getDesign(db: SchemaPg, id: number, merchantId?: number): Promise<Design | null> {
  const r = merchantId != null ? await db.one<DesignRow>(`SELECT * FROM designs WHERE id=$1 AND merchant_id=$2`, [id, merchantId]) : await db.one<DesignRow>(`SELECT * FROM designs WHERE id=$1`, [id]);
  return r ? toDesign(r) : null;
}

export function parseDesign(form: FormData, themes: string[]): DesignInput | { error: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = String(form.get("name") || "").trim().slice(0, 80);
  if (!name) errors.name = "Give the design a name customers will see.";
  const amounts = String(form.get("amounts") || "")
    .split(/[,\s]+/)
    .map((s) => round2(s.replace(/[^0-9.]/g, "")))
    .filter((n) => n > 0)
    .slice(0, 8);
  const allowCustom = form.get("allow_custom") === "on";
  const minAmount = round2(form.get("min_amount")) || 500;
  const maxAmount = round2(form.get("max_amount")) || 50000;
  if (!amounts.length && !allowCustom) errors.amounts = "Add at least one amount, or let customers choose any amount.";
  if (allowCustom && minAmount >= maxAmount) errors.max_amount = "The most must be more than the least.";
  const theme = String(form.get("theme") || "classic");
  const accent = String(form.get("accent") || "");
  const months = Number(form.get("expiry_months"));
  if (Object.keys(errors).length) return { error: errors };
  return {
    name,
    amounts,
    allowCustom,
    minAmount,
    maxAmount,
    theme: themes.includes(theme) ? theme : "classic",
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#2563eb",
    image: String(form.get("image") || "") || null,
    terms: String(form.get("terms") || "").trim().slice(0, 400) || null,
    expiryMonths: months > 0 ? Math.min(120, Math.round(months)) : null,
    active: form.get("active") !== "off",
  };
}

export async function saveDesign(db: SchemaPg, merchantId: number, id: number | null, d: DesignInput, merchant: { name: string | null; logo: string | null; currency: string }): Promise<number> {
  if (id) {
    const r = await db.one<{ id: string }>(
      `UPDATE designs SET name=$1, denominations=$2, allow_custom=$3, min_amount=$4, max_amount=$5, theme=$6, accent=$7, image=$8, terms=$9, expiry_months=$10, active=$11, merchant_name=coalesce($12, merchant_name), merchant_logo=coalesce($13, merchant_logo)
        WHERE id=$14 AND merchant_id=$15 RETURNING id`,
      [d.name, JSON.stringify(d.amounts), d.allowCustom, d.minAmount, d.maxAmount, d.theme, d.accent, d.image, d.terms, d.expiryMonths, d.active, merchant.name, merchant.logo, id, merchantId],
    );
    if (!r) throw new GiftCardError("That design doesn't exist any more.");
    return Number(r.id);
  }
  const r = await db.one<{ id: string }>(
    `INSERT INTO designs (merchant_id, name, denominations, allow_custom, min_amount, max_amount, currency, theme, accent, image, terms, expiry_months, active, merchant_name, merchant_logo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [merchantId, d.name, JSON.stringify(d.amounts), d.allowCustom, d.minAmount, d.maxAmount, merchant.currency, d.theme, d.accent, d.image, d.terms, d.expiryMonths, d.active, merchant.name, merchant.logo],
  );
  return Number(r!.id);
}

export async function deleteDesign(db: SchemaPg, merchantId: number, id: number): Promise<void> {
  const used = await db.one(`SELECT 1 FROM cards WHERE design_id=$1 AND merchant_id=$2 LIMIT 1`, [id, merchantId]);
  if (used) {
    await db.run(`UPDATE designs SET active=false WHERE id=$1 AND merchant_id=$2`, [id, merchantId]);
    return;
  }
  await db.run(`DELETE FROM designs WHERE id=$1 AND merchant_id=$2`, [id, merchantId]);
}

// ---- setup ------------------------------------------------------------------------------------

export async function getSettings(db: SchemaPg, merchantId: number): Promise<MerchantSettings> {
  const r = await db.one<{ setup_hidden: boolean; test_sent_at: Date | null }>(`SELECT setup_hidden, test_sent_at FROM merchant_settings WHERE merchant_id=$1`, [merchantId]);
  return { setupHidden: Boolean(r?.setup_hidden), testSentAt: iso(r?.test_sent_at ?? null) };
}

export async function updateSettings(db: SchemaPg, merchantId: number, patch: Partial<{ setupHidden: boolean; testSent: boolean }>): Promise<void> {
  await db.run(`INSERT INTO merchant_settings (merchant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [merchantId]);
  if (patch.setupHidden !== undefined) await db.run(`UPDATE merchant_settings SET setup_hidden=$2, updated_at=now() WHERE merchant_id=$1`, [merchantId, patch.setupHidden]);
  if (patch.testSent) await db.run(`UPDATE merchant_settings SET test_sent_at=now(), updated_at=now() WHERE merchant_id=$1`, [merchantId]);
}

// ---- export -----------------------------------------------------------------------------------

export async function cardsCsv(db: SchemaPg, merchantId: number): Promise<string> {
  const rows = (await db.q<CardRow>(`SELECT * FROM cards WHERE merchant_id=$1 ORDER BY id DESC`, [merchantId])).map(toCard);
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = "code,status,amount,balance,currency,recipient_name,recipient_email,source,reason,expires_on,created";
  return [head, ...rows.map((c) => [c.code, statusOf(c), c.amount, c.balance, c.currency, c.recipientName, c.recipientEmail, c.source, c.reason, c.expiresOn, c.createdAt].map(esc).join(","))].join("\n");
}

// ---- payment fallback -------------------------------------------------------------------------

/** When the payment webhook isn't registered, ask Inkress about recent unpaid cards. Bounded and best effort. */
export async function syncAwaiting(db: SchemaPg, merchantId: number, accessToken: string): Promise<number> {
  const { getOrderStatus, isPaid, activateCard } = await import("./app-kit.server.mjs");
  const rows = await db.q<CardRow & { inkress_order_id: string }>(
    `SELECT * FROM cards WHERE merchant_id=$1 AND state='awaiting' AND inkress_order_id IS NOT NULL AND created_at > now() - interval '3 days' ORDER BY id DESC LIMIT 5`,
    [merchantId],
  );
  let activated = 0;
  await Promise.race([
    Promise.all(
      rows.map(async (r) => {
        try {
          if (isPaid(await getOrderStatus(accessToken, r.inkress_order_id))) {
            await activateCard(r);
            activated++;
          }
        } catch {
          /* try again next time */
        }
      }),
    ),
    new Promise((res) => setTimeout(res, 3000)),
  ]);
  return activated;
}
