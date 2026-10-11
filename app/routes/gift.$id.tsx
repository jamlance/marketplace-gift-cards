// Public gift card page (no sign-in): pick an amount, say who it's for, pay through Inkress.
import { useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { Button, ButtonKind, Callout, DateField, EmptyState, MoneyField, TextAreaField, TextField, Tone, formatMoney } from "@inkress/app-kit/ui";
import { createOrder, merchantAccessToken, publicBaseUrl, requireDb, today, newCode } from "~/lib/app-kit.server.mjs";
import { defaultExpiry, getDesign } from "~/lib/gift.server";
import { CardArt } from "~/components/card-art";
import type { Route } from "./+types/gift.$id";

export const meta: Route.MetaFunction = ({ data }) => [{ title: data?.design ? `${data.design.name} · ${data.design.merchantName ?? "Gift card"}` : "Gift card" }];

export async function loader({ params, request }: Route.LoaderArgs) {
  const db = await requireDb();
  const design = await getDesign(db, Number(params.id));
  const paid = new URL(request.url).searchParams.get("paid") === "1";
  return { design: design && design.active ? design : null, paid };
}

export async function action({ params, request }: Route.ActionArgs) {
  const db = await requireDb();
  const d = await getDesign(db, Number(params.id));
  if (!d || !d.active) return { error: "These gift cards aren't on sale any more." };
  const form = await request.formData();
  const amount = Math.round(Number(form.get("amount") || form.get("custom") || 0) * 100) / 100;
  const fixed = d.amounts.includes(amount);
  if (!amount || (!fixed && !(d.allowCustom && amount >= d.minAmount && amount <= d.maxAmount))) {
    return { error: d.allowCustom ? `Pick an amount, or enter one between ${formatMoney(d.minAmount, d.currency, { cents: false })} and ${formatMoney(d.maxAmount, d.currency, { cents: false })}.` : "Pick an amount." };
  }
  const recipient = String(form.get("recipient_email") || "").trim().toLowerCase();
  const buyer = String(form.get("buyer_email") || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) return { error: "Enter the email of the person it's for." };
  if (buyer && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer)) return { error: "Check your email address." };
  const deliverOn = String(form.get("deliver_on") || "");
  const schedule = /^\d{4}-\d{2}-\d{2}$/.test(deliverOn) && deliverOn > today() ? deliverOn : null;

  const owner = await db.one<{ merchant_id: string }>(`SELECT merchant_id FROM designs WHERE id=$1`, [d.id]);
  const merchantId = Number(owner?.merchant_id);
  let accessToken: string;
  try {
    accessToken = await merchantAccessToken(merchantId);
  } catch {
    return { error: "This shop hasn't finished setting up gift cards. Please try again later." };
  }
  const ref = `giftcard-${merchantId}-${Date.now().toString(36)}-${newCode().slice(3, 7).toLowerCase()}`;
  let order: { id: string | null; paymentUrl: string | null };
  try {
    order = await createOrder(accessToken, {
      referenceId: ref,
      total: amount,
      currency: d.currency,
      title: `Gift card: ${d.name}`,
      customerEmail: buyer || recipient,
      meta: { source: "gift-cards", design_id: d.id, recipient },
      returnUrl: publicBaseUrl ? `${publicBaseUrl}/gift/${d.id}?paid=1` : undefined,
    });
  } catch {
    return { error: "We couldn't start the payment. Please try again in a minute." };
  }
  if (!order.paymentUrl) return { error: "We couldn't start the payment. Please try again in a minute." };
  await db.run(
    `INSERT INTO cards (merchant_id, design_id, code, amount, balance, currency, recipient_name, recipient_email, buyer_email, message, ref, inkress_order_id, payment_url, deliver_on, expires_on, source)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'online')`,
    [merchantId, d.id, newCode(), amount, d.currency, String(form.get("recipient_name") || "").trim() || null, recipient, buyer || null, String(form.get("message") || "").trim().slice(0, 300) || null, ref, order.id, order.paymentUrl, schedule, defaultExpiry(d.expiryMonths)],
  );
  return redirect(order.paymentUrl);
}

export default function BuyGiftCard({ loaderData }: Route.ComponentProps) {
  const { design, paid } = loaderData;
  const error = useActionData<typeof action>()?.error;
  const nav = useNavigation();
  const [amount, setAmount] = useState<number>(design?.amounts[0] ?? design?.minAmount ?? 0);
  if (!design) {
    return (
      <main className="ui-public">
        <div className="ui-public-card"><EmptyState icon="gift" title="These gift cards aren't on sale">Ask the shop for a new link.</EmptyState></div>
      </main>
    );
  }
  const shop = design.merchantName ?? "this shop";
  return (
    <main className="ui-public">
      <div className="ui-public-card">
        <div className="ui-public-body">
          {design.merchantLogo ? <img src={design.merchantLogo} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", display: "block", margin: "0 auto 12px" }} /> : null}
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", textAlign: "center", margin: "0 0 4px" }}>{design.name}</h1>
          <p className="ui-t2" style={{ textAlign: "center", margin: "0 0 18px" }}>A gift card for {shop}</p>
          <CardArt design={design} shopName={shop} amount={amount || design.minAmount} currency={design.currency} />
          {paid ? (
            <div style={{ marginTop: 18 }}><Callout tone={Tone.Ok} title="Thank you.">Your gift card is on its way. The person it's for gets it by email{" "}once the payment clears.</Callout></div>
          ) : (
            <Form method="post" style={{ marginTop: 18 }}>
              {design.amounts.length ? (
                <div className="gc-public-amounts" role="radiogroup" aria-label="Amount">
                  {design.amounts.map((a) => (
                    <label key={a}>
                      <input type="radio" name="amount" value={a} checked={amount === a} onChange={() => setAmount(a)} />
                      {formatMoney(a, design.currency, { cents: false })}
                    </label>
                  ))}
                </div>
              ) : null}
              {design.allowCustom ? <MoneyField label={design.amounts.length ? "Or another amount" : "Amount"} name="custom" currency={design.currency} min={design.minAmount} max={design.maxAmount} onChange={(e) => { const n = Number(e.target.value); if (n) setAmount(n); }} hint={`${formatMoney(design.minAmount, design.currency, { cents: false })} to ${formatMoney(design.maxAmount, design.currency, { cents: false })}`} /> : null}
              <TextField label="Who it's for (name)" name="recipient_name" autoComplete="off" />
              <TextField label="Their email" name="recipient_email" type="email" required autoComplete="off" />
              <TextAreaField label="A short message (optional)" name="message" rows={2} maxLength={300} placeholder="Happy birthday!" />
              <DateField label="Send it on (optional)" name="deliver_on" hint="Leave empty to send it as soon as you've paid." />
              <TextField label="Your email, for the receipt (optional)" name="buyer_email" type="email" autoComplete="email" />
              {error ? <div style={{ marginBottom: 12 }}><Callout tone={Tone.Bad}>{error}</Callout></div> : null}
              <Button kind={ButtonKind.Primary} type="submit" busy={nav.state !== "idle"} style={{ width: "100%", height: 46 }}>Pay {formatMoney(amount || 0, design.currency, { cents: false })}</Button>
              {design.terms ? <p className="ui-hint" style={{ textAlign: "center", marginTop: 12 }}>{design.terms}</p> : null}
            </Form>
          )}
        </div>
      </div>
      <p className="ui-public-foot">Payments by Inkress</p>
    </main>
  );
}
