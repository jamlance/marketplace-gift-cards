// Redemptions: take a card at the till by its code, and see every use and top-up across all cards.
import { useEffect } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { useToast } from "@inkress/app-kit/client";
import {
  Align,
  Box,
  Button,
  ButtonKind,
  Callout,
  DataTable,
  EmptyState,
  MoneyField,
  PageHeader,
  Pager,
  StatusPill,
  TextField,
  Tone,
  formatDate,
  formatMoney,
  formatTime,
  type Column,
} from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { statusOf } from "~/lib/gift";
import { GiftCardError, findByCode, recentRedemptions, redeem } from "~/lib/gift.server";
import { CardStatusPill } from "~/components/status";
import type { Route } from "./+types/_app.redemptions";

export const meta: Route.MetaFunction = () => [{ title: "Redemptions · Gift Cards" }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const before = Number(new URL(args.request.url).searchParams.get("before")) || null;
  const page = await recentRedemptions(db, m.id, before);
  return { currency: m.currency, page, paged: Boolean(before) };
}

const Intent = { Lookup: "lookup", Redeem: "redeem" } as const;

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const form = await args.request.formData();
  const code = String(form.get("code") || "").trim().toUpperCase();
  const card = code ? await findByCode(db, m.id, code) : null;
  if (!card) return { intent: Intent.Lookup, found: false as const, message: code ? `No card with the code ${code}.` : "Type or scan the code." };
  if (form.get("intent") === Intent.Redeem) {
    try {
      const after = await redeem(db, m.id, card, form.get("amount"), String(form.get("note") || "") || null, m.actor);
      return { intent: Intent.Redeem, found: true as const, card: { ...after, status: statusOf(after) }, done: Number(form.get("amount")) };
    } catch (e) {
      if (e instanceof GiftCardError) return { intent: Intent.Redeem, found: true as const, card: { ...card, status: statusOf(card) }, message: e.message };
      throw e;
    }
  }
  return { intent: Intent.Lookup, found: true as const, card: { ...card, status: statusOf(card) } };
}

export default function Redemptions({ loaderData }: Route.ComponentProps) {
  const { currency, page, paged } = loaderData;
  const money = (n: number) => formatMoney(n, currency);
  const f = useFetcher<typeof action>();
  const toast = useToast();
  const [params] = useSearchParams();
  const d = f.data;
  const card = d && d.found ? d.card : null;
  const canUse = card && card.balance > 0 && (card.status === "active" || card.status === "expiring" || card.status === "scheduled");

  useEffect(() => {
    if (f.state === "idle" && d && d.intent === Intent.Redeem && "done" in d && d.done) toast({ kind: "success", message: `${money(d.done)} taken off ${d.card.code}.` });
  }, [f.state, d]);

  type Row = (typeof page.rows)[number];
  const columns: Column<Row>[] = [
    { key: "when", header: "When", render: (r) => (<>{formatDate(r.at)}<small>{formatTime(r.at)}</small></>) },
    { key: "card", header: "Card", render: (r) => (r.cardId ? <Link className="gc-code" to={`/cards/${r.cardId}`}><b>{r.code}</b></Link> : <b className="gc-code">{r.code}</b>) },
    { key: "what", header: "What", render: (r) => (r.kind === "reload" ? <StatusPill tone={Tone.Info}>Added</StatusPill> : <StatusPill tone={Tone.Ok}>Used</StatusPill>) },
    { key: "note", header: "Note", hideOnSmall: true, render: (r) => (<>{r.note || <span className="ui-t3">None</span>}{r.by ? <small>{r.by}</small> : null}</>) },
    { key: "amount", header: "Amount", align: Align.Right, render: (r) => <b>{r.kind === "reload" ? "+" : "−"}{money(r.amount ?? 0)}</b> },
  ];

  return (
    <>
      <PageHeader title="Redemptions" summary="Take a card at the till, and see every use." />
      <div className="ui-stack">
        <Box title="Use a card at the till">
          <f.Form method="post" className="gc-till">
            <input type="hidden" name="intent" value={Intent.Lookup} />
            <TextField label="Card code" name="code" placeholder="GC-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" className="gc-code" required />
            <Button type="submit" busy={f.state !== "idle" && f.formData?.get("intent") === Intent.Lookup}>Look up</Button>
          </f.Form>
          {d && !d.found ? <div style={{ marginTop: 12 }}><Callout tone={Tone.Bad}>{d.message}</Callout></div> : null}
          {card ? (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <b className="gc-code" style={{ fontSize: 16 }}>{card.code}</b>
                <CardStatusPill status={card.status} card={card} />
                <span className="ui-t2">{card.recipientName || card.recipientEmail || ""}</span>
                <span style={{ marginLeft: "auto", fontSize: 20, fontWeight: 700 }} className="ui-num">{money(card.balance)} left</span>
              </div>
              {canUse ? (
                <f.Form method="post" className="gc-till">
                  <input type="hidden" name="intent" value={Intent.Redeem} />
                  <input type="hidden" name="code" value={card.code} />
                  <MoneyField label="Amount to take off" name="amount" currency={currency} max={card.balance} required error={"message" in d! && d!.intent === Intent.Redeem ? d!.message : undefined} />
                  <TextField label="Order (optional)" name="note" placeholder="#10482" />
                  <Button kind={ButtonKind.Primary} type="submit" busy={f.state !== "idle" && f.formData?.get("intent") === Intent.Redeem}>Take it off</Button>
                </f.Form>
              ) : (
                <Callout tone={Tone.Warn}>This card can't be used right now ({card.status === "used" ? "nothing left on it" : card.status === "expired" ? "it has expired" : card.status === "off" ? "it's turned off" : "it isn't paid for"}). <Link className="ui-link" to={`/cards/${card.id}`}>Open the card</Link></Callout>
              )}
            </div>
          ) : null}
        </Box>
        <DataTable
          columns={columns}
          rows={page.rows}
          rowKey={(r) => String(r.id)}
          empty={<EmptyState icon="orders" title="No redemptions yet">Each time a card pays for something, it shows up here.</EmptyState>}
          footer={page.rows.length ? <Pager label={`${page.rows.length} shown`} prevHref={paged ? "?" : null} nextHref={page.nextBefore ? `?${(() => { const p = new URLSearchParams(params); p.set("before", String(page.nextBefore)); return p; })()}` : null} /> : undefined}
        />
      </div>
    </>
  );
}
