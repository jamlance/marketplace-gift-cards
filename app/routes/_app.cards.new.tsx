// Issue a card without taking a payment: store credit, a giveaway, or making something right.
import { useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import {
  Box,
  Button,
  ButtonKind,
  ButtonLink,
  Combobox,
  DateField,
  FormSection,
  MoneyField,
  OptionCards,
  PageHeader,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
  type ComboOption,
} from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { email } from "~/lib/app-kit.server.mjs";
import { ISSUE_LIMITS, ISSUE_REASON_LABEL, IssueReason } from "~/lib/gift";
import { defaultExpiry, issueCard, listDesigns, parseIssue } from "~/lib/gift.server";
import { CardArt } from "~/components/card-art";
import type { Route } from "./+types/_app.cards.new";

export const meta: Route.MetaFunction = () => [{ title: "Issue a gift card · Gift Cards" }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const designs = (await listDesigns(db, m.id)).filter((d) => d.active);
  return {
    currency: m.currency,
    shopName: m.name,
    emailReady: email.configured(),
    designs: designs.map((d) => ({ id: d.id, name: d.name, theme: d.theme, accent: d.accent, image: d.image, expiry: defaultExpiry(d.expiryMonths) })),
  };
}

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const parsed = parseIssue(await args.request.formData());
  if ("error" in parsed) return { errors: parsed.error };
  const { card } = await issueCard(db, m.id, m.currency, parsed, m.actor);
  return redirect(`/cards/${card.id}`);
}

const DETAIL: Record<IssueReason, string> = { store_credit: "For a return or exchange", giveaway: "A contest or promotion", goodwill: "Making something right with a customer" };

export default function IssueCard({ loaderData }: Route.ComponentProps) {
  const { currency, shopName, designs, emailReady } = loaderData;
  const errors = useActionData<typeof action>()?.errors ?? {};
  const nav = useNavigation();
  const [designId, setDesignId] = useState(String(designs[0]?.id ?? ""));
  const [amount, setAmount] = useState(5000);
  const [to, setTo] = useState<ComboOption | null>(null);
  const design = designs.find((d) => String(d.id) === designId) ?? null;

  const search = async (q: string): Promise<ComboOption[]> => {
    const r = await fetch(`/api/recipients?q=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    const j = (await r.json()) as { people: Array<{ email: string; name: string | null; cards: number }> };
    return j.people.map((p) => ({ value: p.email, label: p.name || p.email, detail: `${p.email} · ${p.cards} ${p.cards === 1 ? "card" : "cards"} before` }));
  };

  return (
    <>
      <PageHeader back={{ to: "/cards", label: "Gift cards" }} title="Issue a gift card" summary="Give credit without taking a payment. Nothing is charged." />
      <div className="ui-two">
        <Form method="post" id="issue">
          <FormSection title="Why" description="Shown in your reports, not to the customer.">
            <OptionCards name="reason" defaultValue={IssueReason.StoreCredit} options={(Object.values(IssueReason) as IssueReason[]).map((r) => ({ value: r, label: ISSUE_REASON_LABEL[r], detail: DETAIL[r] }))} />
            {errors.reason ? <div className="ui-error">{errors.reason}</div> : null}
          </FormSection>
          <FormSection title="Customer" description="Someone who's had a card before, or type a new email. Leave it empty to hand over the code yourself.">
            <Combobox
              label="Send to"
              name="recipient"
              placeholder="Name or email"
              search={search}
              allowFreeText={(t) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null)}
              freeTextLabel={(t) => `Send to ${t}`}
              onSelect={setTo}
              error={errors.recipient}
            />
            <TextField label="Their name (optional)" name="recipient_name" defaultValue={to && to.label !== to.value ? to.label : ""} key={to?.value ?? "none"} />
          </FormSection>
          <FormSection title="Amount" description={`Between ${ISSUE_LIMITS.min.toLocaleString()} and ${ISSUE_LIMITS.max.toLocaleString()}.`}>
            <div className="ui-field-row">
              <MoneyField label="Amount" name="amount" currency={currency} defaultValue={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} required error={errors.amount} />
              <DateField label="Expires on" name="expires_on" defaultValue={design?.expiry ?? ""} key={`exp-${designId}`} hint="Leave empty for no expiry." error={errors.expires_on} />
            </div>
            {designs.length > 1 ? <SelectField label="Design" name="design_id" value={designId} onChange={(e) => setDesignId(e.target.value)} options={designs.map((d) => ({ value: String(d.id), label: d.name }))} /> : <input type="hidden" name="design_id" value={designId} />}
          </FormSection>
          <FormSection title="Message" description="Optional. Goes in the email.">
            <TextAreaField label="Message" name="message" rows={3} maxLength={300} placeholder="Thanks for bringing the jacket back. Here's credit for your next visit." />
            <Switch name="send" defaultChecked={emailReady} label="Email the card now" description={emailReady ? "Only when there's an email address." : "Email isn't set up for Gift Cards yet; you'll share the code yourself."} disabled={!emailReady} />
          </FormSection>
          <div className="ui-form-actions" style={{ paddingBottom: 24 }}>
            <span className="ui-note">The card works straight away.</span>
            <ButtonLink to="/cards">Cancel</ButtonLink>
            <Button kind={ButtonKind.Primary} type="submit" busy={nav.state === "submitting"}>Issue card</Button>
          </div>
        </Form>
        <div style={{ position: "sticky", top: 16 }}>
          <Box title="Preview">
            <div className="gc-preview">
              <CardArt design={design} shopName={shopName} amount={amount} currency={currency} />
              <p>{to ? `${to.label} gets this by email.` : "Share the code yourself, or add an email to send it."}</p>
            </div>
          </Box>
        </div>
      </div>
    </>
  );
}
