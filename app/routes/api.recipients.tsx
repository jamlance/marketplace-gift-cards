// Search people who've had a card before (for "Send to"). Merchant session required.
import { useMerchant } from "~/lib/merchant.server";
import { searchRecipients } from "~/lib/gift.server";
import type { Route } from "./+types/api.recipients";

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const q = (new URL(args.request.url).searchParams.get("q") || "").trim().slice(0, 60);
  return Response.json({ people: q.length < 2 ? [] : await searchRecipients(db, m.id, q) });
}
