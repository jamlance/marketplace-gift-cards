// Public balance check (no sign-in). Shows what's left; it can't be used to spend.
import { Form, useActionData, useNavigation, useSearchParams } from "react-router";
import { Button, ButtonKind, Callout, TextField, Tone, formatDate, formatMoney } from "@inkress/app-kit/ui";
import { requireDb } from "~/lib/app-kit.server.mjs";
import type { Route } from "./+types/balance";

export const meta: Route.MetaFunction = () => [{ title: "Gift card balance" }];

export async function action({ request }: Route.ActionArgs) {
  const db = await requireDb();
  const code = String((await request.formData()).get("code") || "").trim().toUpperCase().slice(0, 20);
  if (!/^GC-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code)) return { found: false as const, message: "That doesn't look like a gift card code. It starts with GC-." };
  const c = await db.one<{ balance: string; amount: string; currency: string; expires_on: Date | string | null; state: string; shop: string | null }>(
    `SELECT c.balance, c.amount, c.currency, c.expires_on, c.state, d.merchant_name shop FROM cards c LEFT JOIN designs d ON d.id=c.design_id WHERE upper(c.code)=$1 AND c.state IN ('active','redeemed')`,
    [code],
  );
  if (!c) return { found: false as const, message: "We couldn't find an active card with that code." };
  const exp = c.expires_on ? (c.expires_on instanceof Date ? c.expires_on.toISOString() : String(c.expires_on)).slice(0, 10) : null;
  return { found: true as const, code, balance: Number(c.balance), amount: Number(c.amount), currency: c.currency, expiresOn: exp, shop: c.shop };
}

export default function Balance() {
  const r = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  return (
    <main className="ui-public">
      <div className="ui-public-card">
        <div className="ui-public-body">
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 4px" }}>Gift card balance</h1>
          <p className="ui-t2" style={{ margin: "0 0 18px" }}>Type the code from your card to see what's left.</p>
          <Form method="post">
            <TextField label="Card code" name="code" defaultValue={params.get("code") ?? ""} placeholder="GC-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" className="gc-code" required />
            <Button kind={ButtonKind.Primary} type="submit" busy={nav.state !== "idle"} style={{ width: "100%", height: 44 }}>Check balance</Button>
          </Form>
          {r && !r.found ? <div style={{ marginTop: 14 }}><Callout tone={Tone.Bad}>{r.message}</Callout></div> : null}
          {r && r.found ? (
            <div style={{ marginTop: 18, textAlign: "center" }}>
              <div className="ui-t3" style={{ fontSize: 13 }}>{r.code}{r.shop ? ` · ${r.shop}` : ""}</div>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.03em" }} className="ui-num">{formatMoney(r.balance, r.currency)}</div>
              <div className="ui-t2">left of {formatMoney(r.amount, r.currency)}{r.expiresOn ? ` · works until ${formatDate(r.expiresOn, { year: true })}` : ""}</div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="ui-public-foot">Payments by Inkress</p>
    </main>
  );
}
