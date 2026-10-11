// How a card looks (merchant-chosen), shared by the app, the public pages, the email and the PDF.
// Plain ESM so server.mjs (scheduler) and the React routes can both import it.
// Theme keys are stored on existing designs; keep them. These are the merchant's card art, not the app chrome.

/** @typedef {{ label: string, grad: string, accent: string, fg: string }} CardTheme */

/** @type {Record<string, CardTheme>} */
export const CARD_THEMES = {
  classic: { label: "Ocean", grad: "linear-gradient(135deg,#1e3a8a,#2563eb)", accent: "#2563eb", fg: "#ffffff" },
  midnight: { label: "Midnight", grad: "linear-gradient(135deg,#0b1021,#1f2a52)", accent: "#4f5fd6", fg: "#ffffff" },
  forest: { label: "Palm", grad: "linear-gradient(135deg,#0f3d36,#1f7a68)", accent: "#1f7a68", fg: "#ffffff" },
  sunset: { label: "Sunset", grad: "linear-gradient(135deg,#9f1239,#e11d48)", accent: "#e11d48", fg: "#ffffff" },
  rose: { label: "Hibiscus", grad: "linear-gradient(135deg,#86198f,#c026d3)", accent: "#c026d3", fg: "#ffffff" },
  gold: { label: "Gold", grad: "linear-gradient(135deg,#5b4407,#a17a12)", accent: "#a17a12", fg: "#ffffff" },
};

export const THEME_KEYS = Object.keys(CARD_THEMES);

/** @param {{ theme?: string|null, accent?: string|null } | null | undefined} d */
export function themeOf(d) {
  const t = d?.theme && CARD_THEMES[d.theme];
  if (t) return t;
  const a = d?.accent && /^#[0-9a-f]{6}$/i.test(d.accent) ? d.accent : "#2563eb";
  return { label: "Custom", grad: `linear-gradient(135deg,${a},${a})`, accent: a, fg: "#ffffff" };
}

/** @param {string} s */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const PREFIX = { JMD: "J$", USD: "US$", TTD: "TT$", BBD: "Bds$", XCD: "EC$", KYD: "CI$", GYD: "G$" };

/** "J$5,000" (cents only when there are cents). Same symbols as app-kit's formatMoney. @param {number} n @param {string} currency */
export function money(n, currency) {
  const body = new Intl.NumberFormat("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  const p = PREFIX[String(currency).toUpperCase()];
  return `${n < 0 ? "-" : ""}${p ?? `${currency} `}${body}`;
}

/** Card art as inline-styled HTML (email-safe). */
export function cardHtml({ amount, currency, code, design, shopName }) {
  const t = themeOf(design);
  const bg = design?.image
    ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url('${esc(design.image)}');background-size:cover;background-position:center`
    : `background:${t.grad}`;
  return `<div style="${bg};color:${t.fg};border-radius:16px;padding:22px;text-align:left;font-family:Inter,system-ui,sans-serif">
    <div style="display:flex;justify-content:space-between;font-weight:600;font-size:14px"><span>${esc(shopName || "")}</span><span style="opacity:.85">${esc(design?.name || "Gift card")}</span></div>
    <div style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin:40px 0 6px">${esc(money(Number(amount), currency))}</div>
    <div style="font-family:ui-monospace,Menlo,monospace;font-size:17px;letter-spacing:.08em">${esc(code)}</div>
  </div>`;
}

/** The email a recipient gets. Plain, calm, the code is the point. */
export function cardEmailHtml({ shopName, card, design, balanceUrl }) {
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:460px;margin:0 auto;color:#1c1917;padding:8px">
    <h2 style="margin:8px 0 6px;font-size:22px">A gift card from ${esc(shopName)}</h2>
    <p style="color:#57534e;margin:0 0 18px">${card.recipient_name ? `Hi ${esc(card.recipient_name)}, here` : "Here"}'s ${esc(money(Number(card.amount), card.currency))} to spend at ${esc(shopName)}.</p>
    ${card.message ? `<p style="background:#f5f5f4;border-radius:10px;padding:12px 14px;color:#44403c;margin:0 0 18px">"${esc(card.message)}"</p>` : ""}
    ${cardHtml({ amount: card.amount, currency: card.currency, code: card.code, design, shopName })}
    <p style="color:#57534e;font-size:14px;margin:18px 0 6px">Show the code at checkout, in store or online.${card.expires_on ? ` It works until ${esc(String(card.expires_on).slice(0, 10))}.` : ""}</p>
    ${balanceUrl ? `<p style="font-size:14px;margin:0"><a href="${esc(balanceUrl)}" style="color:#2563eb">Check your balance</a></p>` : ""}
    ${design?.terms ? `<p style="color:#a8a29e;font-size:12px;margin-top:18px">${esc(design.terms)}</p>` : ""}
  </div>`;
}
