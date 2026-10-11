// Gift cards list: status tabs, search, filters, a boxed table, cursor pages, and bulk actions.
import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { useConfirm, useToast } from "@inkress/app-kit/client";
import {
  Align,
  BulkBar,
  Button,
  ButtonKind,
  ButtonLink,
  ButtonSize,
  DataTable,
  EmptyState,
  ExternalButton,
  FilterBar,
  FilterSelect,
  IconTone,
  PageHeader,
  Pager,
  SearchBox,
  StatusTabs,
  formatDate,
  formatMoney,
  formatTime,
  type Column,
} from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { BulkAction, CardFilter, CardSource, statusOf } from "~/lib/gift";
import { bulk, filterCounts, listCards, listDesigns, parseFilter, syncAwaiting } from "~/lib/gift.server";
import { CardStatusPill } from "~/components/status";
import type { Route } from "./+types/_app.cards._index";

export const meta: Route.MetaFunction = () => [{ title: "Gift cards · Gift Cards" }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const url = new URL(args.request.url);
  const filter = parseFilter(url.searchParams.get("status"));
  const source = url.searchParams.get("source");
  await syncAwaiting(db, m.id, m.accessToken).catch(() => 0);
  const [page, counts, designs] = await Promise.all([
    listCards(db, m.id, {
      filter,
      q: (url.searchParams.get("q") || "").trim().slice(0, 80),
      source: source === CardSource.Online || source === CardSource.Issued ? source : "",
      designId: Number(url.searchParams.get("design")) || null,
      after: Number(url.searchParams.get("after")) || null,
    }),
    filterCounts(db, m.id),
    listDesigns(db, m.id),
  ]);
  return {
    currency: m.currency,
    filter,
    page: { ...page, cards: page.cards.map((c) => ({ ...c, status: statusOf(c) })) },
    counts,
    outstanding: page.cards.reduce((s, c) => s + c.balance, 0),
    designs: designs.map((d) => ({ value: String(d.id), label: d.name })),
  };
}

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const form = await args.request.formData();
  const act = String(form.get("action")) as BulkAction;
  if (!(Object.values(BulkAction) as string[]).includes(act)) return { ok: false as const, message: "Unknown action." };
  const ids = String(form.get("ids") || "").split(",").map(Number).filter(Boolean);
  const r = await bulk(db, m.id, act, ids, m.actor);
  return { ok: true as const, action: act, ...r };
}

const BULK_DONE: Record<BulkAction, string> = { resend: "Emailed", extend: "Extended by 3 months:", deactivate: "Turned off" };

export default function Cards({ loaderData }: Route.ComponentProps) {
  const { currency, filter, page, counts, designs } = loaderData;
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fetcher = useFetcher<typeof action>();
  const confirm = useConfirm();
  const toast = useToast();
  const money = (n: number) => formatMoney(n, currency);
  type Row = (typeof page.cards)[number];

  useEffect(() => setSelected(new Set()), [params]);
  useEffect(() => {
    const d = fetcher.data;
    if (!d || fetcher.state !== "idle") return;
    if (d.ok) {
      toast({ kind: "success", message: `${BULK_DONE[d.action]} ${d.done} ${d.done === 1 ? "card" : "cards"}${d.skipped ? `, ${d.skipped} skipped` : ""}.` });
      setSelected(new Set());
    } else toast({ kind: "error", message: d.message });
  }, [fetcher.data, fetcher.state]);

  const chosen = page.cards.filter((c) => selected.has(String(c.id)));
  const run = async (act: BulkAction) => {
    if (act === BulkAction.Deactivate) {
      const ok = await confirm({
        title: `Turn off ${chosen.length} gift ${chosen.length === 1 ? "card" : "cards"}?`,
        body: `${money(chosen.reduce((s, c) => s + c.balance, 0))} of balance can't be spent until you turn them back on. Customers aren't told.`,
        confirm_label: `Turn off ${chosen.length}`,
        destructive: true,
      });
      if (!ok) return;
    }
    fetcher.submit({ action: act, ids: chosen.map((c) => c.id).join(",") }, { method: "post" });
  };

  const columns: Column<Row>[] = [
    { key: "card", header: "Card", render: (c) => (<><b className="gc-code">{c.code}</b><small>{c.designName ?? (c.source === "issued" ? "Issued by you" : "Gift card")}</small></>) },
    { key: "to", header: "For", hideOnSmall: true, render: (c) => (<>{c.recipientName || c.recipientEmail || <span className="ui-t3">No one named</span>}{c.recipientName && c.recipientEmail ? <small>{c.recipientEmail}</small> : null}</>) },
    { key: "source", header: "Source", hideOnSmall: true, render: (c) => (c.source === "issued" ? (<>Issued by you<small>{c.reason ? { store_credit: "Store credit", giveaway: "Giveaway", goodwill: "Goodwill" }[c.reason] : ""}</small></>) : (<>Bought online{c.buyerEmail && c.buyerEmail !== c.recipientEmail ? <small>by {c.buyerEmail}</small> : null}</>)) },
    { key: "status", header: "Status", render: (c) => <CardStatusPill status={c.status} card={c} /> },
    { key: "date", header: "Started", hideOnSmall: true, render: (c) => (<>{formatDate(c.createdAt)}<small>{formatTime(c.createdAt)}</small></>) },
    { key: "balance", header: "Balance", align: Align.Right, render: (c) => (<><b>{money(c.balance)}</b><small>of {formatMoney(c.amount, currency, { cents: false })}</small></>) },
  ];

  const next = new URLSearchParams(params);
  if (page.nextAfter) next.set("after", String(page.nextAfter));
  const filtered = Boolean(params.get("q") || params.get("source") || params.get("design"));

  return (
    <>
      <PageHeader
        title="Gift cards"
        summary={<>{counts.all} {counts.all === 1 ? "card" : "cards"} · <b>{counts.active}</b> active</>}
        actions={<ExternalButton href="/cards.csv" icon="dl" download>Export CSV</ExternalButton>}
      />
      <div className="ui-bar-row">
        <StatusTabs
          tabs={[
            { value: "", label: "Active", count: counts.active },
            { value: CardFilter.Expiring, label: "Expiring", count: counts.expiring, alert: counts.expiring > 0 },
            { value: CardFilter.UsedUp, label: "Used up", count: counts.used },
            { value: CardFilter.Expired, label: "Expired", count: counts.expired },
            ...(counts.awaiting ? [{ value: CardFilter.Awaiting, label: "Not paid", count: counts.awaiting }] : []),
            ...(counts.off ? [{ value: CardFilter.Off, label: "Turned off", count: counts.off }] : []),
            { value: CardFilter.All, label: "All" },
          ]}
        />
      </div>
      <FilterBar>
        <SearchBox placeholder="Code, name or email" />
        <FilterSelect label="Source" param="source" options={[{ value: CardSource.Online, label: "Bought online" }, { value: CardSource.Issued, label: "Issued by you" }]} />
        {designs.length > 1 ? <FilterSelect label="Design" param="design" options={designs} /> : null}
      </FilterBar>
      <DataTable
        columns={columns}
        rows={page.cards}
        rowKey={(c) => String(c.id)}
        rowHref={(c) => `/cards/${c.id}`}
        selected={selected}
        onSelectedChange={setSelected}
        empty={
          filtered ? (
            <EmptyState icon="search" title="No cards match" actions={<ButtonLink to={`?${filter === CardFilter.Active ? "" : `status=${filter}`}`} size={ButtonSize.Small}>Clear search and filters</ButtonLink>}>
              Try fewer filters, or check the spelling.
            </EmptyState>
          ) : (
            <EmptyState icon="gift" iconTone={IconTone.Violet} title={filter === CardFilter.Active ? "No active gift cards" : "Nothing here"} actions={<ButtonLink to="/cards/new" kind={ButtonKind.Primary} icon="plus">Issue a gift card</ButtonLink>}>
              Cards customers buy, and cards you issue, show up here with their balance.
            </EmptyState>
          )
        }
        footer={page.cards.length ? <Pager label={`${page.cards.length} of ${page.total} ${page.total === 1 ? "card" : "cards"}`} prevHref={page.hasPrev ? `?${(() => { const p = new URLSearchParams(params); p.delete("after"); return p; })()}` : null} nextHref={page.nextAfter ? `?${next}` : null} /> : undefined}
      />
      <BulkBar count={chosen.length} summary={`${money(chosen.reduce((s, c) => s + c.balance, 0))} balance`} onClear={() => setSelected(new Set())}>
        <Button size={ButtonSize.Small} icon="send" busy={fetcher.state !== "idle" && fetcher.formData?.get("action") === BulkAction.Resend} onClick={() => run(BulkAction.Resend)}>Resend</Button>
        <Button size={ButtonSize.Small} icon="clock" busy={fetcher.state !== "idle" && fetcher.formData?.get("action") === BulkAction.Extend} onClick={() => run(BulkAction.Extend)}>Extend 3 months</Button>
        <Button size={ButtonSize.Small} icon="x" busy={fetcher.state !== "idle" && fetcher.formData?.get("action") === BulkAction.Deactivate} onClick={() => run(BulkAction.Deactivate)}>Turn off</Button>
      </BulkBar>
    </>
  );
}

