// Printable card PDF, from the shared document layout (pdf.server.mjs, ported from apps-core).
import { documentPdf } from "./pdf.server.mjs";
import { money, themeOf } from "./card-design.mjs";
import type { Card, Design } from "./gift";

export async function cardPdf(card: Card, design: Design | null, shopName: string): Promise<Uint8Array> {
  const t = themeOf(design);
  const meta = [{ label: "Code", value: card.code }];
  if (card.recipientName) meta.push({ label: "For", value: card.recipientName });
  if (card.expiresOn) meta.push({ label: "Valid until", value: card.expiresOn });
  return documentPdf({
    brand: { name: design?.merchantName || shopName, accent: t.accent },
    title: "Gift card",
    number: card.code,
    badge: card.balance <= 0 ? "USED" : "GIFT",
    meta,
    items: [],
    totals: [
      { label: "Original value", value: money(card.amount, card.currency) },
      { label: "Balance", value: money(card.balance, card.currency), bold: true },
    ],
    note: [card.message ? `"${card.message}"` : "", design?.terms || "", "Show this code at checkout to pay with it."].filter(Boolean).join("\n\n"),
    footer: design?.merchantName || shopName,
  });
}
