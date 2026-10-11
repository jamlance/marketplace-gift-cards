// All cards as CSV (opens in Excel and Sheets).
import { useMerchant } from "~/lib/merchant.server";
import { cardsCsv } from "~/lib/gift.server";
import type { Route } from "./+types/cards[.]csv";

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  return new Response(await cardsCsv(db, m.id), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gift-cards-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
