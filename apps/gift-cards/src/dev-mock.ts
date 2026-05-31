/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

let DESIGNS: any[] = [
  { id: 1, name: "Jack Jack Gift Card", denominations: [1000, 2500, 5000, 10000], allow_custom: true, min_amount: 500, max_amount: 50000, currency: "JMD", active: true, accent: "#3b5bdb", theme: "midnight", image: null, terms: "Valid in-store · non-refundable", expiry_months: 12, public_url: location.origin + "/gift/1" },
];
let DID = 1;
const CARDS: any[] = [
  { id: 1, code: "GC-A1B2-C3D4", amount: 5000, balance: 2000, currency: "JMD", recipient_name: "Maria", recipient_email: "maria@example.com", message: "Happy birthday!", state: "active", deliver_on: null, delivered_at: new Date().toISOString(), expires_on: "2027-01-01", created_at: new Date(Date.now() - 9e7).toISOString(), pdf_url: location.origin + "/api/cards/1/pdf" },
  { id: 2, code: "GC-E5F6-G7H8", amount: 2500, balance: 2500, currency: "JMD", recipient_name: null, recipient_email: "devon@example.com", message: null, state: "active", deliver_on: "2099-12-25", delivered_at: null, expires_on: null, created_at: new Date(Date.now() - 36e5).toISOString(), pdf_url: location.origin + "/api/cards/2/pdf" },
  { id: 3, code: "GC-I9J0-K1L2", amount: 10000, balance: 0, currency: "JMD", recipient_name: "Kemar", recipient_email: "kemar@example.com", message: null, state: "redeemed", deliver_on: null, delivered_at: new Date().toISOString(), expires_on: null, created_at: new Date(Date.now() - 18e7).toISOString(), pdf_url: location.origin + "/api/cards/3/pdf" },
  { id: 4, code: "GC-M3N4-O5P6", amount: 1000, balance: 1000, currency: "JMD", recipient_name: null, recipient_email: "x@example.com", message: null, state: "awaiting", deliver_on: null, delivered_at: null, expires_on: null, created_at: new Date().toISOString(), pdf_url: null },
];
let CARDID = 4;
const REDS: any[] = [{ id: 1, code: "GC-I9J0-K1L2", amount: 10000, kind: "redeem", note: null, created_by_name: "Front Desk", created_at: new Date(Date.now() - 17e7).toISOString() }, { id: 2, code: "GC-A1B2-C3D4", amount: 3000, kind: "redeem", note: "haircut", created_by_name: "Keisha", created_at: new Date(Date.now() - 8e7).toISOString() }];
let RID = 2;

function stats() { const a = CARDS.filter((c) => c.state === "active" || c.state === "redeemed"); return { sold: a.length, outstanding: a.reduce((s, c) => s + c.balance, 0), redeemed_value: CARDS.reduce((s, c) => s + (c.amount - c.balance), 0), awaiting: CARDS.filter((c) => c.state === "awaiting").length }; }

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 80));
    const dm = u.pathname.match(/\/api\/designs\/(\d+)/);
    const rm = u.pathname.match(/\/api\/cards\/(\d+)\/(redeem|reload|pdf)/);

    if (u.pathname === "/api/cards") { let rows = CARDS.slice(); const q = (u.searchParams.get("q") || "").toLowerCase(); const fil = u.searchParams.get("filter"); if (q) rows = rows.filter((c) => (c.code + (c.recipient_email || "")).toLowerCase().includes(q)); if (fil === "scheduled") rows = rows.filter((c) => c.deliver_on && !c.delivered_at && c.state !== "awaiting"); else if (fil) rows = rows.filter((c) => c.state === fil); return json({ cards: rows, stats: stats() }); }
    if (u.pathname === "/api/cards.csv") return new Response("code,state,amount,balance\nGC-A1B2-C3D4,active,5000,2000", { status: 200, headers: { "Content-Type": "text/csv" } });
    if (u.pathname === "/api/cards/lookup") { const c = CARDS.find((x) => x.code === String(body.code).toUpperCase()); return json(c ? { found: true, card: c, history: REDS.filter((r) => r.code === c.code) } : { found: false }); }
    if (rm && rm[2] === "redeem") { const c = CARDS.find((x) => x.id === Number(rm[1])); c.balance = Math.round(c.balance - body.amount); if (c.balance <= 0) c.state = "redeemed"; REDS.unshift({ id: ++RID, code: c.code, amount: body.amount, kind: "redeem", note: null, created_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ card: c }); }
    if (rm && rm[2] === "reload") { const c = CARDS.find((x) => x.id === Number(rm[1])); c.balance += body.amount; c.amount += body.amount; c.state = "active"; REDS.unshift({ id: ++RID, code: c.code, amount: body.amount, kind: "reload", note: body.note || "reload", created_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ card: c }); }
    if (rm && rm[2] === "pdf") return new Response(new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }), { status: 200, headers: { "Content-Type": "application/pdf" } });
    if (u.pathname === "/api/redemptions") return json({ redemptions: REDS });
    if (u.pathname === "/api/upload") return json({ url: "https://placehold.co/600x360/png" });
    if (u.pathname === "/api/designs" && method === "GET") return json({ designs: DESIGNS, connected: true, ses_configured: true, storage: true, webhook_realtime: true, themes: ["classic", "midnight", "sunset", "forest", "rose", "gold"] });
    if (u.pathname === "/api/designs" && method === "POST") { const d = { id: ++DID, ...body, currency: "JMD", active: true, public_url: location.origin + "/gift/" + DID }; DESIGNS.unshift(d); return json({ design: d }, 201); }
    if (dm && method === "PATCH") { const d = DESIGNS.find((x) => x.id === Number(dm[1])); Object.assign(d, body); return json({ design: d }); }
    if (dm && method === "DELETE") { DESIGNS = DESIGNS.filter((x) => x.id !== Number(dm[1])); return json({ ok: true }); }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:write", "webhooks:manage", "offline_access"],
  };
}
