// The card as customers see it: the merchant's design, the amount, the code.
import { formatMoney } from "@inkress/app-kit/ui";
import { themeOf } from "~/lib/card-design.mjs";

export interface CardArtDesign {
  name: string;
  theme: string;
  accent: string;
  image: string | null;
}

export function CardArt({ design, shopName, amount, currency, code = "GC-•••• ••••", small = false }: { design: CardArtDesign | null; shopName: string; amount: number; currency: string; code?: string; small?: boolean }) {
  const t = themeOf(design);
  const background = design?.image ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url("${design.image}")` : t.grad;
  return (
    <div className={small ? "gc-card sm" : "gc-card"} style={{ background, backgroundSize: "cover", backgroundPosition: "center", color: t.fg }} role="img" aria-label={`${design?.name ?? "Gift card"}, ${formatMoney(amount, currency, { cents: false })}`}>
      <div className="top">
        <span>{shopName}</span>
        <span>{design?.name ?? "Gift card"}</span>
      </div>
      <div>
        <div className="amt">{formatMoney(amount, currency, { cents: false })}</div>
        <div className="code">{code}</div>
      </div>
    </div>
  );
}
