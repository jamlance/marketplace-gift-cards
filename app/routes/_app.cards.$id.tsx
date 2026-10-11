// One card: balance, what the customer sees, the full history, and every change (each in its own small dialog).
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useConfirm, useToast } from "@inkress/app-kit/client";
import {
  Box,
  Button,
  ButtonKind,
  ButtonSize,
  Callout,
  CopyField,
  DateField,
  Dialog,
  ExternalButton,
  IconTone,
  KeyValue,
  MoneyField,
  PageHeader,
  StatTiles,
  TextAreaField,
  TextField,
  Timeline,
  Tone,
  Trend,
  formatDate,
  formatMoney,
  formatTime,
  type TimelineEntry,
} from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { publicBaseUrl } from "~/lib/app-kit.server.mjs";
import { CardState, HistoryKind, ISSUE_REASON_LABEL, SendResult, daysBetween, statusOf, type HistoryEntry } from "~/lib/gift";
import { GiftCardError, addNote, cardHistory, extend, getCard, redeem, resend, setActive, topUp } from "~/lib/gift.server";
import { CardStatusPill } from "~/components/status";
import type { Route } from "./+types/_app.cards.$id";

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.card.code ?? "Card"} · Gift Cards` }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const card = await getCard(db, m.id, Number(args.params.id));
  if (!card) throw new Response("That gift card doesn't exist.", { status: 404 });
  const history = await cardHistory(db, card.id);
  const today = new Date().toISOString().slice(0, 10);
  return { currency: card.currency, card, status: statusOf(card), history, today, balanceUrl: publicBaseUrl ? `${publicBaseUrl}/balance?code=${encodeURIComponent(card.code)}` : null };
}

const Intent = { Redeem: "redeem", TopUp: "topup", Extend: "extend", Resend: "resend", Remind: "remind", Off: "off", On: "on", Note: "note" } as const;
type Intent = (typeof Intent)[keyof typeof Intent];

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const card = await getCard(db, m.id, Number(args.params.id));
  if (!card) throw new Response("That gift card doesn't exist.", { status: 404 });
  const form = await args.request.formData();
  const intent = String(form.get("intent")) as Intent;
  const note = String(form.get("note") || "").trim() || null;
  try {
    switch (intent) {
      case Intent.Redeem:
        await redeem(db, m.id, card, form.get("amount"), note, m.actor);
        return { ok: true as const, intent, message: "Taken off the card." };
      case Intent.TopUp:
        await topUp(db, m.id, card, form.get("amount"), note, m.actor);
        return { ok: true as const, intent, message: "Added to the card." };
      case Intent.Extend:
        await extend(db, m.id, card, String(form.get("until") || "") || null, m.actor);
        return { ok: true as const, intent, message: "Expiry updated." };
      case Intent.Resend:
      case Intent.Remind: {
        const r = await resend(db, m.id, card, m.actor, intent === Intent.Remind);
        if (r === SendResult.NoEmail) return { ok: false as const, intent, message: "This card has no email address to send to." };
        if (r === SendResult.EmailOff) return { ok: false as const, intent, message: "Email isn't set up for Gift Cards yet." };
        return { ok: true as const, intent, message: `Emailed ${card.recipientEmail}.` };
      }
      case Intent.Off:
      case Intent.On:
        await setActive(db, m.id, card, intent === Intent.On, m.actor);
        return { ok: true as const, intent, message: intent === Intent.On ? "Card turned back on." : "Card turned off." };
      case Intent.Note:
        await addNote(db, m.id, card, note ?? "", m.actor);
        return { ok: true as const, intent, message: "Note added." };
      default:
        return { ok: false as const, intent, message: "Unknown action." };
    }
  } catch (e) {
    if (e instanceof GiftCardError) return { ok: false as const, intent, message: e.message };
    throw e;
  }
}

function describe(h: HistoryEntry, money: (n: number) => string): TimelineEntry {
  const by = h.by ? ` · ${h.by}` : "";
  const meta = `${formatDate(h.at)} · ${formatTime(h.at)}${by}`;
  const amt = h.amount != null ? money(h.amount) : "";
  const map: Record<HistoryKind, [string, Tone]> = {
    paid: [`Bought for ${amt}`, Tone.Ok],
    issued: [`Issued for ${amt}`, Tone.Ok],
    redeem: [`${amt} used`, Tone.Ok],
    reload: [`${amt} added`, Tone.Info],
    extended: ["Expiry changed", Tone.Info],
    deactivated: ["Turned off", Tone.Bad],
    reactivated: ["Turned back on", Tone.Info],
    resent: ["Card sent", Tone.Neutral],
    reminded: ["Reminder sent", Tone.Info],
    note: ["Note", Tone.Neutral],
  };
  const [title, tone] = map[h.kind] ?? [h.kind, Tone.Neutral];
  return { id: h.id, title, tone, meta, note: h.note && h.kind !== HistoryKind.Issued ? h.note : h.kind === HistoryKind.Issued ? h.note : undefined };
}

export default function CardDetail({ loaderData }: Route.ComponentProps) {
  const { card, status, history, currency, today, balanceUrl } = loaderData;
  const money = (n: number) => formatMoney(n, currency);
  const f = useFetcher<typeof action>();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState<Intent | null>(null);

  useEffect(() => {
    if (f.state !== "idle" || !f.data) return;
    toast({ kind: f.data.ok ? "success" : "error", message: f.data.message });
    if (f.data.ok) setOpen(null);
  }, [f.state, f.data]);

  const busy = (i: Intent) => f.state !== "idle" && f.formData?.get("intent") === i;
  const post = (intent: Intent) => f.submit({ intent }, { method: "post" });
  const usable = card.state !== CardState.Awaiting && card.state !== CardState.Deactivated;
  const daysLeft = card.expiresOn ? daysBetween(today, card.expiresOn) : null;
  const error = f.data && !f.data.ok && open === f.data.intent ? f.data.message : null;

  const turnOff = async () => {
    const ok = await confirm({
      title: `Turn off ${card.code}?`,
      body: `${money(card.balance)} can't be spent until you turn it back on. The customer isn't told.`,
      confirm_label: "Turn off card",
      destructive: true,
    });
    if (ok) post(Intent.Off);
  };

  return (
    <>
      <PageHeader
        back={{ to: "/cards", label: "Gift cards" }}
        title={<><span className="gc-code">{card.code}</span><CardStatusPill status={status} card={card} /></>}
        summary={<>{card.recipientName || card.recipientEmail || "No recipient"} · {card.source === "issued" ? `issued ${formatDate(card.createdAt, { year: true })}${card.reason ? ` as ${ISSUE_REASON_LABEL[card.reason].toLowerCase()}` : ""}` : `bought ${formatDate(card.createdAt, { year: true })} online`}</>}
        actions={
          card.state === CardState.Deactivated ? (
            <Button kind={ButtonKind.Primary} onClick={() => post(Intent.On)} busy={busy(Intent.On)}>Turn back on</Button>
          ) : card.state === CardState.Awaiting ? null : (
            <>
              <ExternalButton href={`/cards/${card.id}/pdf`} target="_blank" rel="noreferrer" icon="file">PDF</ExternalButton>
              <Button icon="send" onClick={() => post(Intent.Resend)} busy={busy(Intent.Resend)} disabled={!card.recipientEmail}>Resend</Button>
              <Button kind={ButtonKind.Primary} icon="orders" onClick={() => setOpen(Intent.Redeem)} disabled={!usable || card.balance <= 0 || status === "expired"}>Use balance</Button>
            </>
          )
        }
      />
      <div className="ui-two">
        <div className="ui-stack">
          <StatTiles
            tiles={[
              { label: "Balance", icon: "gift", iconTone: IconTone.Violet, value: money(card.balance), note: `of ${money(card.amount)}` },
              { label: "Used", icon: "orders", iconTone: IconTone.Blue, value: money(card.amount - card.balance), note: `${history.filter((h) => h.kind === HistoryKind.Redeem).length} times` },
              { label: "Expires", icon: "clock", iconTone: IconTone.Rose, value: daysLeft == null ? "Never" : daysLeft < 0 ? "Expired" : daysLeft === 0 ? "Today" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`, note: card.expiresOn ? formatDate(card.expiresOn, { year: true }) : "No expiry date", trend: daysLeft != null && daysLeft <= 30 ? Trend.Down : undefined },
            ]}
          />
          {status === "expiring" && card.balance > 0 ? (
            <Callout tone={Tone.Warn} title={`${money(card.balance)} will be lost ${daysLeft === 0 ? "today" : `in ${daysLeft} days`}.`} action={<><Button size={ButtonSize.Small} onClick={() => post(Intent.Remind)} busy={busy(Intent.Remind)} disabled={!card.recipientEmail}>Send reminder</Button><Button size={ButtonSize.Small} onClick={() => setOpen(Intent.Extend)}>Extend</Button></>}>
              {card.remindedAt ? `Last reminded ${formatDate(card.remindedAt)}.` : "The customer hasn't been reminded yet."}
            </Callout>
          ) : null}
          {status === "expired" && card.balance > 0 ? <Callout tone={Tone.Bad} title="This card has expired." action={<Button size={ButtonSize.Small} onClick={() => setOpen(Intent.Extend)}>Extend</Button>}>{money(card.balance)} is left on it. Extend it if you want the customer to be able to use it.</Callout> : null}
          {card.state === CardState.Awaiting ? <Callout tone={Tone.Info} title="Not paid yet.">The buyer started paying and didn't finish. The card turns on by itself when the payment comes through.</Callout> : null}
          {card.state === CardState.Deactivated ? <Callout tone={Tone.Neutral} title="Turned off.">Nobody can spend this card until you turn it back on.</Callout> : null}

          <Box title="Card" note="what the customer sees">
            <KeyValue
              items={[
                ["Code", <span className="gc-code">{card.code}</span>],
                ["Design", card.designName ?? "Default"],
                ["Sent to", card.recipientEmail ? `${card.recipientName ? `${card.recipientName} · ` : ""}${card.recipientEmail}` : "Not sent. Hand over the code yourself."],
                ...(card.deliveredAt ? ([["Delivered", `${formatDate(card.deliveredAt, { year: true })} · ${formatTime(card.deliveredAt)}`]] as Array<[string, string]>) : card.deliverOn ? ([["Sends on", formatDate(card.deliverOn, { year: true })]] as Array<[string, string]>) : []),
                ...(card.message ? ([["Message", `"${card.message}"`]] as Array<[string, string]>) : []),
                ...(card.buyerEmail ? ([["Bought by", card.buyerEmail]] as Array<[string, string]>) : []),
              ]}
            />
          </Box>
          {balanceUrl && card.state !== CardState.Awaiting ? (
            <Box title="Balance link" note="shows what's left, can't spend it">
              <CopyField value={balanceUrl} />
            </Box>
          ) : null}
          {usable ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button icon="plus" onClick={() => setOpen(Intent.TopUp)}>Add money</Button>
              <Button icon="clock" onClick={() => setOpen(Intent.Extend)}>Change expiry</Button>
              <Button kind={ButtonKind.Danger} icon="x" onClick={turnOff} busy={busy(Intent.Off)}>Turn off</Button>
            </div>
          ) : null}
        </div>

        <Box title="History" aside="newest first">
          <Timeline entries={history.map((h) => describe(h, money))} />
          <f.Form method="post" style={{ marginTop: 4 }}>
            <input type="hidden" name="intent" value={Intent.Note} />
            <TextAreaField label="Note for your team" name="note" rows={2} placeholder="e.g. Customer paid the rest in cash" />
            <Button type="submit" size={ButtonSize.Small} busy={busy(Intent.Note)}>Add note</Button>
          </f.Form>
        </Box>
      </div>

      <Dialog open={open === Intent.Redeem} onClose={() => setOpen(null)} title="Use balance" sub={`${card.code} · ${money(card.balance)} left`} footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button kind={ButtonKind.Primary} type="submit" form="redeem-form" busy={busy(Intent.Redeem)}>Take it off the card</Button></>}>
        <f.Form method="post" id="redeem-form">
          <input type="hidden" name="intent" value={Intent.Redeem} />
          <MoneyField label="Amount" name="amount" currency={currency} max={card.balance} required autoFocus error={error} hint={`Up to ${money(card.balance)}.`} />
          <TextField label="Order or note (optional)" name="note" placeholder="#10482" />
        </f.Form>
      </Dialog>
      <Dialog open={open === Intent.TopUp} onClose={() => setOpen(null)} title="Add money to this card" sub="For a refund to the card, or a goodwill top-up." footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button kind={ButtonKind.Primary} type="submit" form="topup-form" busy={busy(Intent.TopUp)}>Add money</Button></>}>
        <f.Form method="post" id="topup-form">
          <input type="hidden" name="intent" value={Intent.TopUp} />
          <MoneyField label="Amount" name="amount" currency={currency} required autoFocus error={error} />
          <TextField label="Why (optional)" name="note" placeholder="Refund for order #10390" />
        </f.Form>
      </Dialog>
      <Dialog open={open === Intent.Extend} onClose={() => setOpen(null)} title="Change expiry" sub={card.expiresOn ? `Now expires ${formatDate(card.expiresOn, { year: true })}` : "Has no expiry date"} footer={<><Button onClick={() => setOpen(null)}>Cancel</Button><Button kind={ButtonKind.Primary} type="submit" form="extend-form" busy={busy(Intent.Extend)}>Save</Button></>}>
        <f.Form method="post" id="extend-form">
          <input type="hidden" name="intent" value={Intent.Extend} />
          <DateField label="Expires on" name="until" min={today} defaultValue={card.expiresOn && card.expiresOn > today ? card.expiresOn : ""} error={error} hint="Leave empty for no expiry." />
        </f.Form>
      </Dialog>
    </>
  );
}
