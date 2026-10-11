// Gift card value sets, shapes and pure rules. CLIENT-SAFE (no database, no secrets); gift.server.ts builds on it.

const today = (): string => new Date().toISOString().slice(0, 10);

export const CardState = { Awaiting: "awaiting", Active: "active", Redeemed: "redeemed", Deactivated: "deactivated" } as const;
export type CardState = (typeof CardState)[keyof typeof CardState];

/** What the list tabs filter on. Expiring/expired are derived from expires_on. */
export const CardFilter = { Active: "active", Expiring: "expiring", UsedUp: "used", Expired: "expired", Awaiting: "awaiting", Off: "off", All: "all" } as const;
export type CardFilter = (typeof CardFilter)[keyof typeof CardFilter];

export const CardSource = { Online: "online", Issued: "issued" } as const;
export type CardSource = (typeof CardSource)[keyof typeof CardSource];

export const IssueReason = { StoreCredit: "store_credit", Giveaway: "giveaway", Goodwill: "goodwill" } as const;
export type IssueReason = (typeof IssueReason)[keyof typeof IssueReason];
export const ISSUE_REASON_LABEL: Record<IssueReason, string> = { store_credit: "Store credit", giveaway: "Giveaway", goodwill: "Goodwill" };

export const HistoryKind = {
  Paid: "paid",
  Issued: "issued",
  Redeem: "redeem",
  Reload: "reload",
  Extended: "extended",
  Deactivated: "deactivated",
  Reactivated: "reactivated",
  Resent: "resent",
  Reminded: "reminded",
  Note: "note",
} as const;
export type HistoryKind = (typeof HistoryKind)[keyof typeof HistoryKind];

export const EXPIRING_DAYS = 30;
export const PAGE_SIZE = 25;

export interface Card {
  id: number;
  code: string;
  amount: number;
  balance: number;
  currency: string;
  recipientName: string | null;
  recipientEmail: string | null;
  buyerEmail: string | null;
  message: string | null;
  state: CardState;
  deliverOn: string | null;
  deliveredAt: string | null;
  expiresOn: string | null;
  createdAt: string;
  source: CardSource;
  reason: IssueReason | null;
  designId: number | null;
  designName: string | null;
  remindedAt: string | null;
  paymentUrl: string | null;
}

/** The status a merchant reads, derived once so the list, detail and filters agree. */
export const CardStatus = { Active: "active", Expiring: "expiring", Expired: "expired", UsedUp: "used", Awaiting: "awaiting", Off: "off", Scheduled: "scheduled" } as const;
export type CardStatus = (typeof CardStatus)[keyof typeof CardStatus];

export function statusOf(c: Card, now: string = today()): CardStatus {
  if (c.state === CardState.Deactivated) return CardStatus.Off;
  if (c.state === CardState.Awaiting) return CardStatus.Awaiting;
  if (c.state === CardState.Redeemed || c.balance <= 0) return CardStatus.UsedUp;
  if (c.expiresOn && c.expiresOn < now) return CardStatus.Expired;
  if (c.deliverOn && !c.deliveredAt && c.deliverOn > now) return CardStatus.Scheduled;
  if (c.expiresOn && daysBetween(now, c.expiresOn) <= EXPIRING_DAYS) return CardStatus.Expiring;
  return CardStatus.Active;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export interface HistoryEntry {
  id: number;
  kind: HistoryKind;
  amount: number | null;
  note: string | null;
  by: string | null;
  at: string;
  code?: string;
  cardId?: number | null;
}

export const SendResult = { Sent: "sent", NoEmail: "no_email", EmailOff: "email_off" } as const;
export type SendResult = (typeof SendResult)[keyof typeof SendResult];

export interface IssueInput {
  reason: IssueReason;
  recipientName: string | null;
  recipientEmail: string | null;
  amount: number;
  expiresOn: string | null;
  message: string | null;
  designId: number | null;
  send: boolean;
}

export interface IssueLimits {
  min: number;
  max: number;
}

export const ISSUE_LIMITS: IssueLimits = { min: 100, max: 500000 };

export const BulkAction = { Resend: "resend", Extend: "extend", Deactivate: "deactivate" } as const;
export type BulkAction = (typeof BulkAction)[keyof typeof BulkAction];

export interface BulkResult {
  done: number;
  skipped: number;
}

export interface Design {
  id: number;
  name: string;
  amounts: number[];
  allowCustom: boolean;
  minAmount: number;
  maxAmount: number;
  currency: string;
  active: boolean;
  accent: string;
  theme: string;
  image: string | null;
  terms: string | null;
  expiryMonths: number | null;
  merchantName: string | null;
  merchantLogo: string | null;
  sold: number;
}

export interface DesignInput {
  name: string;
  amounts: number[];
  allowCustom: boolean;
  minAmount: number;
  maxAmount: number;
  theme: string;
  accent: string;
  image: string | null;
  terms: string | null;
  expiryMonths: number | null;
  active: boolean;
}

export interface MerchantSettings {
  setupHidden: boolean;
  testSentAt: string | null;
}
