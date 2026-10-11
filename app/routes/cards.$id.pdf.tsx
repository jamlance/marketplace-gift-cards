// A printable card (PDF) for handing over in person.
import { useMerchant } from "~/lib/merchant.server";
import { getCard, getDesign } from "~/lib/gift.server";
import { cardPdf } from "~/lib/card-pdf.server";
import type { Route } from "./+types/cards.$id.pdf";

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const card = await getCard(db, m.id, Number(args.params.id));
  if (!card) throw new Response("Not found", { status: 404 });
  const design = card.designId ? await getDesign(db, card.designId, m.id) : null;
  const bytes = await cardPdf(card, design, m.name);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${card.code}.pdf"` } });
}
