// Card designs: what customers pick from on the gift card page.
import { useFetcher } from "react-router";
import { useConfirm } from "@inkress/app-kit/client";
import { Button, ButtonKind, ButtonLink, ButtonSize, CopyField, EmptyState, IconTone, PageHeader, StatusPill, Box, Tone, formatMoney } from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { publicBaseUrl } from "~/lib/app-kit.server.mjs";
import { deleteDesign, listDesigns } from "~/lib/gift.server";
import { CardArt } from "~/components/card-art";
import type { Route } from "./+types/_app.designs._index";

export const meta: Route.MetaFunction = () => [{ title: "Designs · Gift Cards" }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  return { shopName: m.name, currency: m.currency, designs: await listDesigns(db, m.id), base: publicBaseUrl };
}

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const form = await args.request.formData();
  await deleteDesign(db, m.id, Number(form.get("id")));
  return { ok: true };
}

export default function Designs({ loaderData }: Route.ComponentProps) {
  const { designs, shopName, currency, base } = loaderData;
  const f = useFetcher();
  const confirm = useConfirm();
  const remove = async (id: number, name: string, sold: number) => {
    const ok = await confirm({
      title: sold ? `Hide ${name}?` : `Delete ${name}?`,
      body: sold ? "Cards already sold with this design keep working. Customers can't buy it any more." : "Customers can't buy it any more.",
      confirm_label: sold ? "Hide design" : "Delete design",
      destructive: true,
    });
    if (ok) f.submit({ id: String(id) }, { method: "post" });
  };
  return (
    <>
      <PageHeader title="Designs" summary="What customers choose from when they buy a gift card." actions={<ButtonLink to="/designs/new" kind={ButtonKind.Primary} icon="plus">New design</ButtonLink>} />
      {designs.length === 0 ? (
        <Box>
          <EmptyState icon="palette" iconTone={IconTone.Violet} title="No designs yet" actions={<ButtonLink to="/designs/new" kind={ButtonKind.Primary} icon="plus">Create a design</ButtonLink>}>
            A design is the card's look, the amounts on offer, and how long cards last.
          </EmptyState>
        </Box>
      ) : (
        <div className="gc-designs">
          {designs.map((d) => (
            <div className="gc-design" key={d.id}>
              <CardArt design={d} shopName={shopName} amount={d.amounts[0] ?? d.minAmount} currency={currency} small />
              <div className="meta">
                <b>{d.name}</b>
                {d.active ? <StatusPill tone={Tone.Ok}>On sale</StatusPill> : <StatusPill>Hidden</StatusPill>}
              </div>
              <div className="ui-t3" style={{ fontSize: 13 }}>
                {d.sold} sold · {d.expiryMonths ? `lasts ${d.expiryMonths} months` : "never expires"}
                <div className="gc-amounts">
                  {d.amounts.map((a) => <span key={a}>{formatMoney(a, currency, { cents: false })}</span>)}
                  {d.allowCustom ? <span>any amount</span> : null}
                </div>
              </div>
              {d.active && base ? <CopyField value={`${base}/gift/${d.id}`} /> : null}
              <div style={{ display: "flex", gap: 8 }}>
                <ButtonLink to={`/designs/${d.id}`} size={ButtonSize.Small} icon="edit">Edit</ButtonLink>
                {d.active ? <Button size={ButtonSize.Small} kind={ButtonKind.Ghost} onClick={() => remove(d.id, d.name, d.sold)}>{d.sold ? "Hide" : "Delete"}</Button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
