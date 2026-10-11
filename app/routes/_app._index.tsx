// Overview: setup until it's done, then the numbers, the weekly chart and what needs the merchant.
// The page renders straight away; stats and the chart stream in with their own skeletons.
import { Suspense } from "react";
import { Await, Link, useFetcher } from "react-router";
import {
  AttentionItem,
  BarChart,
  Box,
  Button,
  ButtonKind,
  ButtonLink,
  ButtonSize,
  EmptyState,
  ErrorState,
  IconTone,
  SetupChecklist,
  Skeleton,
  StatTiles,
  StepState,
  Trend,
  formatDate,
  formatMoney,
  type SetupStep,
} from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { SendResult } from "~/lib/gift";
import { getSettings, listDesigns, overview, resend, updateSettings, findByCode, syncAwaiting } from "~/lib/gift.server";
import { email, ensureWebhook, publicBaseUrl } from "~/lib/app-kit.server.mjs";
import type { Route } from "./+types/_app._index";

export const meta: Route.MetaFunction = () => [{ title: "Gift Cards" }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  void ensureWebhook(m.id, m.accessToken).catch(() => false);
  await syncAwaiting(db, m.id, m.accessToken).catch(() => 0);
  const [settings, designs] = await Promise.all([getSettings(db, m.id), listDesigns(db, m.id)]);
  return {
    currency: m.currency,
    settings,
    designs: designs.map((d) => ({ id: d.id, active: d.active, hasAmounts: d.amounts.length > 0 || d.allowCustom })),
    emailReady: email.configured(),
    buyLink: designs[0] && publicBaseUrl ? `${publicBaseUrl}/gift/${designs[0].id}` : null,
    // Streamed: the page shows before these finish.
    stats: overview(db, m.id),
  };
}

const Intent = { HideSetup: "hide-setup", SendTest: "send-test" } as const;

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent"));
  if (intent === Intent.HideSetup) {
    await updateSettings(db, m.id, { setupHidden: true });
    return { ok: true as const };
  }
  if (intent === Intent.SendTest) {
    const to = String(form.get("email") || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false as const, message: "Enter your email address." };
    if (!email.configured()) return { ok: false as const, message: "Email isn't set up for Gift Cards yet, so a test can't be sent." };
    const sample = await db.one<{ code: string }>(`SELECT code FROM cards WHERE merchant_id=$1 AND state='active' ORDER BY id DESC LIMIT 1`, [m.id]);
    const card = sample ? await findByCode(db, m.id, sample.code) : null;
    if (!card) return { ok: false as const, message: "Issue a card first, then send yourself a copy." };
    const r = await resend(db, m.id, { ...card, recipientEmail: to }, m.actor);
    if (r !== SendResult.Sent) return { ok: false as const, message: "That email didn't send. Try again in a minute." };
    await updateSettings(db, m.id, { testSent: true });
    return { ok: true as const, message: `Sent to ${to}.` };
  }
  return { ok: false as const, message: "Unknown action." };
}

const trendOf = (now: number, before: number) => (before === 0 ? undefined : now >= before ? Trend.Up : Trend.Down);
const pct = (now: number, before: number) => (before === 0 ? null : Math.round((Math.abs(now - before) / before) * 100));

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { currency, settings, designs, emailReady, buyLink, stats } = loaderData;
  const money = (n: number) => formatMoney(n, currency, { cents: false });
  const test = useFetcher<typeof action>();
  const hide = useFetcher<typeof action>();

  const hasDesign = designs.some((d) => d.active);
  const hasAmounts = designs.some((d) => d.active && d.hasAmounts);
  const steps: SetupStep[] = [
    { id: "design", title: "Create a card design", detail: "Your colours and the name customers see.", state: hasDesign ? StepState.Done : StepState.Current, action: <ButtonLink to="/designs/new" kind={ButtonKind.Primary} size={ButtonSize.Small}>Create</ButtonLink> },
    { id: "amounts", title: "Choose the amounts customers can buy", detail: "Fixed amounts, any amount, or both.", state: hasAmounts ? StepState.Done : hasDesign ? StepState.Current : StepState.Todo, action: hasDesign ? <ButtonLink to="/designs" size={ButtonSize.Small}>Set amounts</ButtonLink> : undefined },
    {
      id: "share",
      title: "Share your gift card page",
      detail: buyLink ? "Customers buy here and pay through Inkress." : "Appears once you have a design.",
      state: !hasAmounts ? StepState.Todo : StepState.Current,
      action: buyLink ? <ButtonLink to="/settings" size={ButtonSize.Small}>Get the link</ButtonLink> : undefined,
    },
    {
      id: "test",
      title: "Send yourself a test card",
      detail: emailReady ? "See the email your customers get." : "Email isn't set up for this app yet.",
      state: settings.testSentAt ? StepState.Done : hasAmounts && emailReady ? StepState.Current : StepState.Todo,
      action: emailReady ? (
        <test.Form method="post" style={{ display: "flex", gap: 6 }}>
          <input type="hidden" name="intent" value={Intent.SendTest} />
          <input className="ui-input" name="email" type="email" placeholder="you@example.com" aria-label="Your email" style={{ height: 34, width: 200 }} required />
          <Button type="submit" size={ButtonSize.Small} busy={test.state !== "idle"}>Send</Button>
        </test.Form>
      ) : undefined,
    },
  ];
  // "Share" counts as done once the merchant has set things up and seen it; it can't be detected.
  if (hasAmounts && settings.testSentAt) steps[2]!.state = StepState.Done;

  return (
    <div className="ui-stack">
      {!settings.setupHidden && hide.state === "idle" && !hide.data ? (
        <div>
          <SetupChecklist title="Finish setting up Gift Cards" steps={steps} onHide={() => hide.submit({ intent: Intent.HideSetup }, { method: "post" })} />
          {test.data && "message" in test.data && test.data.message ? <p className={test.data.ok ? "ui-hint" : "ui-error"} style={{ marginTop: 8 }}>{test.data.message}</p> : null}
        </div>
      ) : null}

      <Suspense fallback={<StatsSkeleton />}>
        <Await resolve={stats} errorElement={<ErrorState title="The numbers didn't load." onRetry={() => window.location.reload()} />}>
          {(s) =>
            !s.hasCards ? (
              <Box>
                <EmptyState icon="gift" iconTone={IconTone.Violet} title="No gift cards yet" actions={<ButtonLink to="/cards/new" kind={ButtonKind.Primary} icon="plus">Issue a gift card</ButtonLink>}>
                  When customers buy one, or you issue one, it shows up here with its balance.
                </EmptyState>
              </Box>
            ) : (
              <>
                <StatTiles
                  tiles={[
                    { label: "Sold this month", icon: "bill", iconTone: IconTone.Green, value: money(s.soldThisMonth), trend: trendOf(s.soldThisMonth, s.soldLastMonth), note: pct(s.soldThisMonth, s.soldLastMonth) != null ? `${s.soldThisMonth >= s.soldLastMonth ? "↑" : "↓"} ${pct(s.soldThisMonth, s.soldLastMonth)}% vs last month` : "First month" },
                    { label: "Balance on cards", icon: "gift", iconTone: IconTone.Violet, value: money(s.outstanding), note: `${s.activeCards} active ${s.activeCards === 1 ? "card" : "cards"}` },
                    { label: "Redeemed this month", icon: "orders", iconTone: IconTone.Blue, value: money(s.redeemedThisMonth), trend: trendOf(s.redeemedThisMonth, s.redeemedLastMonth), note: pct(s.redeemedThisMonth, s.redeemedLastMonth) != null ? `${s.redeemedThisMonth >= s.redeemedLastMonth ? "↑" : "↓"} ${pct(s.redeemedThisMonth, s.redeemedLastMonth)}% vs last month` : "Used at your till and online" },
                    { label: "Expiring in 30 days", icon: "clock", iconTone: IconTone.Rose, value: money(s.expiringValue), note: `${s.expiringCount} ${s.expiringCount === 1 ? "card" : "cards"}` },
                  ]}
                />
                <div className="ui-split">
                  <Box padded>
                    <div className="ui-card-title">
                      <b>Gift card sales</b>
                      <span className="ui-t3">by week</span>
                      <span className="ui-right">This week <b>{money(s.weekly[s.weekly.length - 1]?.total ?? 0)}</b></span>
                    </div>
                    <BarChart bars={s.weekly.map((w) => ({ label: formatDate(w.weekStart), value: w.total }))} format={money} />
                    <p className="ui-hint">Cards customers bought online. Cards you issue aren't counted as sales.</p>
                  </Box>
                  <Box title="Needs you" padded={false} aside={<Link className="ui-link" to="/cards">All cards</Link>}>
                    {s.expiringCount ? (
                      <AttentionItem icon="clock" iconTone={IconTone.Rose} title={`${s.expiringCount} ${s.expiringCount === 1 ? "card expires" : "cards expire"} in the next 30 days`} detail={`${money(s.expiringValue)} will be lost unless it's used`} action={<ButtonLink to="/cards?status=expiring" size={ButtonSize.Small}>Remind</ButtonLink>} />
                    ) : null}
                    {s.awaitingStale ? (
                      <AttentionItem icon="bill" iconTone={IconTone.Slate} title={`${s.awaitingStale} ${s.awaitingStale === 1 ? "purchase wasn't" : "purchases weren't"} paid`} detail="Someone started buying a card and didn't finish paying." action={<ButtonLink to="/cards?status=awaiting" size={ButtonSize.Small}>See</ButtonLink>} />
                    ) : null}
                    {!s.expiringCount && !s.awaitingStale ? <EmptyState icon="check" iconTone={IconTone.Green} title="Nothing needs you">Expiring cards and unpaid purchases show up here.</EmptyState> : null}
                  </Box>
                </div>
              </>
            )
          }
        </Await>
      </Suspense>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <>
      <div className="ui-tiles" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="ui-tile" key={i}>
            <Skeleton width="50%" />
            <div style={{ height: 10 }} />
            <Skeleton width="70%" height={24} />
          </div>
        ))}
      </div>
      <div className="ui-split">
        <Box>
          <Skeleton height={200} />
        </Box>
        <Box>
          <Skeleton width="60%" />
        </Box>
      </div>
    </>
  );
}
