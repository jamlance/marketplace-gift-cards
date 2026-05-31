import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtMoney, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Design { id: number; name: string; denominations: number[]; allow_custom: boolean; min_amount: number; max_amount: number; currency: string; active: boolean; accent: string; theme: string; image: string | null; terms: string | null; expiry_months: number | null; public_url: string; }
interface Card { id: number; code: string; amount: number; balance: number; currency: string; recipient_name: string | null; recipient_email: string | null; message: string | null; state: string; deliver_on: string | null; delivered_at: string | null; expires_on: string | null; created_at: string; pdf_url: string | null; }
interface Redemption { id: number; code: string; amount: number; kind: string; note: string | null; created_by_name: string | null; created_at: string; }
interface HistRow { amount: number; kind: string; note: string | null; created_at: string; created_by_name?: string | null; }

const THEMES: Record<string, { grad: string; fg: string }> = {
  classic: { grad: "linear-gradient(135deg,#3b5bdb,#5c7cfa)", fg: "#fff" },
  midnight: { grad: "linear-gradient(135deg,#0b1021,#1f2a52)", fg: "#fff" },
  sunset: { grad: "linear-gradient(135deg,#ff6b6b,#feca57)", fg: "#1a1a1a" },
  forest: { grad: "linear-gradient(135deg,#0f5132,#2f9e44)", fg: "#fff" },
  rose: { grad: "linear-gradient(135deg,#d6336c,#f783ac)", fg: "#fff" },
  gold: { grad: "linear-gradient(135deg,#7a5901,#c9a227)", fg: "#1a1a1a" },
};

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
let canStore = false, webhookRealtime = false;
let shell: ReturnType<typeof mountShell>;
let cardFilter = "", cardSearch = "";

(async () => {
  let session;
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has("inkress_session")) {
    const m = await import("./dev-mock"); m.installMockFetch(); session = m.mockSession();
  } else {
    try { session = await initBv(); }
    catch (err: any) { root.innerHTML = ""; root.append(fatal(err?.message)); return; }
  }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";

  shell = mountShell({
    brandIcon: "gift", brandLogo: "/logo.svg", title: "Gift Cards",
    subtitle: `${merchantName} · sell gift cards, redeem in store`, poweredBy: "Marketplace",
    tabs: [
      { id: "cards", label: "Cards", icon: "gift", render: renderCards },
      { id: "designs", label: "Designs", icon: "tag", render: renderDesigns },
      { id: "redemptions", label: "Activity", icon: "list", render: renderRedemptions },
    ],
  });
})();

const sidOf = () => sessionStorage.getItem("bv_app_session_id") || localStorage.getItem("bv_app_session_id") || "";
function cardVisualEl(d: { name: string; theme: string; accent: string; image: string | null }, amount: number, code: string) {
  const t = THEMES[d.theme] || { grad: `linear-gradient(135deg,${d.accent},${d.accent})`, fg: "#fff" };
  const style: any = { color: t.fg };
  if (d.image) { style.backgroundImage = `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url('${d.image}')`; style.backgroundSize = "cover"; style.backgroundPosition = "center"; }
  else style.background = t.grad;
  return h("div", { class: "gc-visual", style },
    h("div", { class: "gc-visual-name" }, d.name || "Gift Card"),
    h("div", { class: "gc-visual-amt" }, fmtMoney(amount, currency)),
    h("div", { class: "gc-visual-code" }, h("img", { src: qr(code, 64), width: "56", height: "56", class: "gc-visual-qr" }), h("div", null, h("div", { class: "gc-visual-codelbl" }, "Code"), h("div", { class: "gc-visual-codeval" }, code))));
}
function qr(data: string, size = 220) { return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`; }

/* -------------------------------------------------------------------- Cards */
async function renderCards(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { cards: Card[]; stats: { sold: number; outstanding: number; redeemed_value: number; awaiting: number } };
  const qs = `${webhookRealtime ? "" : "refresh=1&"}q=${encodeURIComponent(cardSearch)}${cardFilter ? `&filter=${cardFilter}` : ""}`;
  try { data = await bvApi(`/api/cards?${qs}`); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Cards sold", v: String(data.stats.sold), tone: "ok", icon: "gift" },
    { k: "Outstanding balance", v: fmtMoney(data.stats.outstanding, currency), tone: "accent", icon: "wallet" },
    { k: "Redeemed value", v: fmtMoney(data.stats.redeemed_value, currency), icon: "coins" },
    { k: "Awaiting payment", v: String(data.stats.awaiting), icon: "clock" },
  ]));

  const seg = h("div", { class: "gc-seg" }, ...([["", "All"], ["active", "Active"], ["scheduled", "Scheduled"], ["redeemed", "Redeemed"], ["awaiting", "Awaiting"]] as [string, string][]).map(([f, label]) =>
    h("button", { class: "gc-seg-btn" + (cardFilter === f ? " is-on" : ""), onClick: () => { cardFilter = f; shell.select("cards"); } }, label)));
  const search = h("input", { class: "gc-search", placeholder: "Search code / recipient…", value: cardSearch, onInput: (e: any) => { cardSearch = e.target.value; shell.select("cards"); } }) as HTMLInputElement;
  const csv = h("a", { class: "ghost sm", href: "/api/cards.csv", onClick: (e: any) => { e.preventDefault(); downloadCsv(); } }, iconEl("download", 13), "CSV");
  const balLink = h("button", { class: "ghost sm", onClick: () => { const u = `${location.origin}/balance`; navigator.clipboard?.writeText(u); flash("Balance-check link copied", "success"); } }, iconEl("copy", 13), "Balance link");
  const redeem = h("button", { class: "primary", onClick: () => openRedeem() }, iconEl("check", 15), "Redeem");

  host.append(h("div", { class: "gc-filterbar" }, seg, search));
  host.append(card({ title: "Issued cards", action: h("div", { class: "gc-toolbar" }, balLink, csv, redeem), body: data.cards.length ? dataTable<Card>({
    columns: [
      { head: "Code", cell: (c) => h("strong", { class: "gc-code" }, c.code) },
      { head: "Value", num: true, cell: (c) => fmtMoney(c.amount, c.currency) },
      { head: "Balance", num: true, cell: (c) => h("b", { class: c.balance > 0 ? "" : "bv-muted" }, fmtMoney(c.balance, c.currency)) },
      { head: "Recipient", cell: (c) => h("div", null, h("span", { class: "bv-muted" }, c.recipient_email || "—"), c.deliver_on && !c.delivered_at ? h("div", { class: "bv-muted" }, `deliver ${c.deliver_on}`) : null) },
      { head: "State", cell: (c) => statePill(c) },
    ],
    rows: data.cards,
    rowActions: (c) => h("div", { class: "gc-row-actions" },
      (c.state === "active" && c.balance > 0) ? h("button", { class: "ghost sm", onClick: () => openRedeem(c.code) }, "Redeem") : null,
      (c.state === "active" || c.state === "redeemed") ? h("button", { class: "ghost sm", onClick: () => openReload(c) }, iconEl("plus", 13), "Reload") : null,
      c.state !== "awaiting" ? h("button", { class: "ghost sm", onClick: () => openPdf(c) }, iconEl("download", 13)) : null),
  }) : emptyState({ icon: "gift", title: "No gift cards yet", text: "Create a design and share its buy link — purchases show up here." }) }));
  if (webhookRealtime) host.append(h("div", { class: "gc-note bv-muted" }, iconEl("check", 14), "Real-time: cards activate + the recipient is emailed the instant payment lands."));
}
function statePill(c: Card) {
  if (c.deliver_on && !c.delivered_at && c.state === "active") return pill("scheduled", "accent");
  return pill(c.state, c.state === "active" ? "ok" : c.state === "redeemed" ? undefined : c.state === "awaiting" ? "warn" : "bad");
}
async function openPdf(c: Card) {
  try { const r = await fetch(`/api/cards/${c.id}/pdf`, { headers: { "X-BV-Session": sidOf() } }); if (!r.ok) throw new Error("PDF failed"); const u = URL.createObjectURL(await r.blob()); window.open(u, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(u), 60000); }
  catch (err: any) { toast(err?.message || "Couldn't open PDF", "error"); }
}
function downloadCsv() { fetch("/api/cards.csv", { headers: { "X-BV-Session": sidOf() } }).then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "gift-cards.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000); }).catch(() => toast("Couldn't export", "error")); }

function openReload(c: Card) {
  const amt = h("input", { type: "number", min: "0", step: "0.01", placeholder: "Amount to add" }) as HTMLInputElement;
  const note = h("input", { placeholder: "Note (e.g. comp, refund-to-card)" }) as HTMLInputElement;
  openModal({ title: `Reload ${c.code}`, body: h("div", { class: "gc-form" }, h("p", { class: "bv-muted", style: { margin: "0" } }, `Current balance ${fmtMoney(c.balance, c.currency)}. Add value (manual adjustment).`), field("Add amount", amt), field("Note", note)),
    actions: [{ label: "Reload", primary: true, onClick: () => { void (async () => { try { await bvApi(`/api/cards/${c.id}/reload`, { method: "POST", body: JSON.stringify({ amount: Number(amt.value), note: note.value || null }) }); flash("Reloaded", "success"); shell.select("cards"); } catch (e: any) { toast(e?.message || "error", "error"); } })(); } }] });
}

function openRedeem(prefill?: string) {
  const codeInput = h("input", { value: prefill || "", placeholder: "GC-XXXX-XXXX", style: { textTransform: "uppercase" } }) as HTMLInputElement;
  const result = h("div", { class: "gc-redeem-result" });
  const scanWrap = h("div", { class: "gc-scan" });
  let card_: Card | null = null;
  let scanning = false, stream: MediaStream | null = null, raf = 0;

  const lookup = async () => {
    result.innerHTML = "";
    try {
      const r = await bvApi<{ found: boolean; card?: Card; history?: HistRow[] }>("/api/cards/lookup", { method: "POST", body: JSON.stringify({ code: codeInput.value }) });
      if (!r.found || !r.card) { result.append(h("div", { class: "gc-bad" }, "No card with that code.")); card_ = null; return; }
      card_ = r.card;
      if (card_.state === "awaiting") { result.append(h("div", { class: "gc-bad" }, "Not paid for yet.")); return; }
      if (card_.expires_on && card_.expires_on < new Date().toISOString().slice(0, 10)) { result.append(h("div", { class: "gc-bad" }, "This card has expired.")); return; }
      const amt = h("input", { type: "number", min: "0", step: "0.01", max: String(card_.balance), placeholder: `Up to ${card_.balance}`, value: String(card_.balance) }) as HTMLInputElement;
      result.append(
        h("div", { class: "gc-balance" }, h("span", { class: "bv-muted" }, "Balance"), h("b", null, fmtMoney(card_.balance, card_.currency))),
        h("label", { class: "gc-field" }, h("span", { class: "bv-label" }, "Redeem amount"), amt),
        h("button", { class: "primary", onClick: async () => {
          try { await bvApi(`/api/cards/${card_!.id}/redeem`, { method: "POST", body: JSON.stringify({ amount: Number(amt.value) }) }); flash("Redeemed", "success"); stopScan(); shell.select("cards"); document.querySelector(".bv-scrim")?.remove(); }
          catch (err: any) { toast(err?.message || "error", "error"); }
        } }, "Redeem"));
    } catch (err: any) { result.append(h("div", { class: "gc-bad" }, err?.message || "error")); }
  };

  const stopScan = () => { scanning = false; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; scanWrap.innerHTML = ""; };
  const startScan = async () => {
    if (!("BarcodeDetector" in window)) { toast("This device can't scan QR — type the code instead.", "warning"); return; }
    try {
      scanning = true; const video = h("video", { autoplay: true, playsinline: true, class: "gc-scan-video" }) as HTMLVideoElement;
      scanWrap.innerHTML = ""; scanWrap.append(video, h("button", { class: "ghost sm", onClick: () => stopScan() }, "Stop"));
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); video.srcObject = stream;
      const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!scanning) return;
        try { const codes = await detector.detect(video); if (codes[0]?.rawValue) { codeInput.value = String(codes[0].rawValue).trim().toUpperCase(); stopScan(); void lookup(); return; } } catch { /* */ }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch { toast("Couldn't open the camera.", "error"); scanning = false; }
  };

  const body = h("div", null,
    h("label", { class: "gc-field" }, h("span", { class: "bv-label" }, "Gift card code"), codeInput),
    h("div", { class: "gc-redeem-tools" }, h("button", { class: "ghost", onClick: () => { void lookup(); } }, "Look up"), h("button", { class: "ghost", onClick: () => { void startScan(); } }, iconEl("qr", 15), "Scan QR")),
    scanWrap, result);
  openModal({ title: "Redeem a gift card", body, actions: [{ label: "Close", onClick: () => { stopScan(); } }] });
  if (prefill) void lookup();
}

/* ------------------------------------------------------------------ Designs */
async function renderDesigns(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { designs: Design[]; connected: boolean; storage: boolean; webhook_realtime: boolean; themes: string[] };
  try { data = await bvApi("/api/designs"); canStore = data.storage; webhookRealtime = data.webhook_realtime; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";
  const add = h("button", { class: "primary", onClick: () => openDesign(null, data.themes) }, iconEl("plus", 15), "New design");
  if (!data.designs.length) { host.append(card({ title: "Designs", action: add, body: emptyState({ icon: "tag", title: "No gift-card designs yet", text: "Create one — pick a theme, set amounts, and share its buy link." }) })); return; }

  const grid = h("div", { class: "gc-grid" });
  for (const d of data.designs) {
    grid.append(h("div", { class: "gc-card" },
      cardVisualEl(d, d.denominations[0] || d.min_amount, "GC-XXXX-XXXX"),
      h("div", { class: "gc-card-head" }, h("strong", null, d.name), d.active ? pill("live", "ok") : pill("off")),
      h("div", { class: "gc-denoms" }, ...(d.denominations.length ? d.denominations.map((a) => pill(fmtMoney(a, d.currency))) : [h("span", { class: "bv-muted" }, "custom amount")])),
      h("div", { class: "gc-link" }, h("input", { class: "gc-link-input", readonly: true, value: d.public_url }), h("button", { class: "ghost sm", onClick: () => { navigator.clipboard?.writeText(d.public_url); flash("Buy link copied", "success"); } }, iconEl("copy", 14))),
      h("div", { class: "gc-actions" }, h("a", { class: "gc-open", href: d.public_url, target: "_blank", rel: "noopener" }, iconEl("external", 14)), h("button", { class: "ghost sm", onClick: () => openDesign(d, data.themes) }, iconEl("edit", 14)), h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/designs/${d.id}`, { method: "DELETE" }); shell.select("designs"); } }, iconEl("trash", 14)))));
  }
  host.append(card({ title: "Designs", action: add, body: grid }));
  if (!data.connected) host.append(h("div", { class: "gc-note bv-muted" }, iconEl("alert", 14), "Connecting to your Inkress account — public purchases activate momentarily."));
}

function openDesign(d: Design | null, themes: string[]) {
  const name = h("input", { value: d?.name || "Gift Card", placeholder: "Gift card name" }) as HTMLInputElement;
  const denoms = h("input", { value: (d?.denominations || [1000, 2500, 5000]).join(", "), placeholder: "1000, 2500, 5000" }) as HTMLInputElement;
  const min = h("input", { type: "number", value: String(d?.min_amount ?? 500) }) as HTMLInputElement;
  const max = h("input", { type: "number", value: String(d?.max_amount ?? 50000) }) as HTMLInputElement;
  const custom = h("input", { type: "checkbox", checked: d ? d.allow_custom : true }) as HTMLInputElement;
  const active = h("input", { type: "checkbox", checked: d ? d.active : true }) as HTMLInputElement;
  const accent = h("input", { type: "color", value: d?.accent || "#3b5bdb" }) as HTMLInputElement;
  const terms = h("input", { value: d?.terms || "", placeholder: "Terms (e.g. non-refundable, valid in-store)" }) as HTMLInputElement;
  const expiry = h("input", { type: "number", min: "0", value: d?.expiry_months != null ? String(d.expiry_months) : "", placeholder: "Never" }) as HTMLInputElement;
  let theme = d?.theme || "classic";
  let imageUrl = d?.image || null;

  const preview = h("div", { class: "gc-design-preview" });
  const renderPreview = () => { preview.innerHTML = ""; preview.append(cardVisualEl({ name: name.value, theme, accent: accent.value, image: imageUrl }, Number((denoms.value.split(",")[0] || "").trim()) || Number(min.value) || 1000, "GC-XXXX-XXXX")); };

  const themeRow = h("div", { class: "gc-themes" }, ...themes.map((t) => h("button", { class: "gc-theme" + (theme === t ? " is-on" : ""), "data-t": t, style: { background: (THEMES[t]?.grad || "#3b5bdb") }, title: t, onClick: () => { theme = t; imageUrl = null; themeRow.querySelectorAll(".gc-theme").forEach((el) => el.classList.toggle("is-on", el.getAttribute("data-t") === t)); renderPreview(); } })));

  const fileInput = h("input", { type: "file", accept: "image/*", style: { display: "none" }, onChange: async (e: any) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = async () => {
      try { const r = await bvApi<{ url: string }>("/api/upload", { method: "POST", body: JSON.stringify({ data: reader.result }) }); imageUrl = r.url; renderPreview(); flash("Image uploaded", "success"); }
      catch (err: any) { toast(err?.message || "Upload failed", "error"); }
    }; reader.readAsDataURL(file);
  } }) as HTMLInputElement;
  const uploadBtn = h("button", { class: "ghost sm", disabled: !canStore, title: canStore ? "" : "Image hosting not configured — pick a theme", onClick: () => fileInput.click() }, iconEl("download", 14), "Upload image");
  const clearImg = h("button", { class: "ghost sm", onClick: () => { imageUrl = null; renderPreview(); } }, "Use theme");

  [name, denoms, min, accent].forEach((el) => el.addEventListener("input", renderPreview));
  renderPreview();

  const body = h("div", { class: "gc-form" },
    h("div", { class: "gc-design-grid" },
      h("div", null,
        field("Name", name), field("Preset amounts (comma-separated)", denoms),
        h("div", { class: "gc-form-grid" }, field("Min custom", min), field("Max custom", max)),
        h("div", { class: "bv-label" }, "Theme"), themeRow,
        h("div", { class: "gc-form-grid" }, fieldColor("Accent (custom theme)", accent), field("Expiry (months)", expiry)),
        h("div", { class: "gc-imgbtns" }, uploadBtn, imageUrl ? clearImg : null, fileInput),
        field("Terms", terms),
        h("label", { class: "gc-check" }, custom, " Allow custom amount"),
        d ? h("label", { class: "gc-check" }, active, " Active") : null),
      h("div", null, h("div", { class: "bv-label" }, "Preview"), preview)));

  const save = async () => {
    const denominations = denoms.value.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
    const payload: any = { name: name.value, denominations, allow_custom: custom.checked, min_amount: Number(min.value), max_amount: Number(max.value), accent: accent.value, theme, image: imageUrl, terms: terms.value || null, expiry_months: expiry.value ? Number(expiry.value) : null };
    try {
      if (d) { payload.active = active.checked; await bvApi(`/api/designs/${d.id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
      else await bvApi("/api/designs", { method: "POST", body: JSON.stringify(payload) });
      flash(d ? "Saved" : "Design created", "success"); shell.select("designs");
    } catch (err: any) { toast(err?.message || "error", "error"); }
  };
  openModal({ title: d ? "Edit design" : "New gift-card design", body, actions: [{ label: d ? "Save" : "Create", primary: true, onClick: () => { void save(); } }] });
}

/* -------------------------------------------------------------- Activity */
async function renderRedemptions(host: HTMLElement) {
  let log: Redemption[];
  try { log = (await bvApi<{ redemptions: Redemption[] }>("/api/redemptions")).redemptions; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.append(card({ title: "Redemptions & reloads", body: log.length ? dataTable<Redemption>({
    columns: [
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
      { head: "Code", cell: (r) => h("strong", { class: "gc-code" }, r.code) },
      { head: "Type", cell: (r) => r.kind === "reload" ? pill("reload", "accent") : pill("redeem", "ok") },
      { head: "Amount", num: true, cell: (r) => `${r.kind === "reload" ? "+" : "-"}${fmtMoney(r.amount, currency)}` },
      { head: "By", cell: (r) => h("span", { class: "bv-muted" }, r.created_by_name || "—") },
    ], rows: log,
  }) : emptyState({ icon: "list", title: "No activity yet", text: "Redeem or reload a card from the Cards tab." }) }));
}

function field(label: string, el: HTMLElement) { return h("label", { class: "gc-field" }, h("span", { class: "bv-label" }, label), el); }
function fieldColor(label: string, el: HTMLElement) { return h("label", { class: "gc-field gc-field-color" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Gift Cards couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
