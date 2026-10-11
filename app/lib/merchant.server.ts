// Who is using the app, resolved once per loader/action. SERVER ONLY.
import type { SchemaPg } from "@inkress/app-kit/server";
import { requireDb, requireMerchant } from "./app-kit.server.mjs";

export interface MerchantInfo {
  id: number;
  name: string;
  currency: string;
  logo: string | null;
  /** Shown in card history ("by Tasha"); null when the host didn't say. */
  actor: string | null;
  scopes: string[];
  accessToken: string;
}

type Args = Parameters<typeof requireMerchant>[0];

export async function useMerchant(args: Args): Promise<{ db: SchemaPg; m: MerchantInfo }> {
  const mc = requireMerchant(args);
  const db = await requireDb();
  const p = (mc.merchant ?? {}) as Record<string, unknown>;
  return {
    db,
    m: {
      id: mc.merchantId,
      name: String(p.name || p.username || "Your shop"),
      currency: String(p.currency_code || "JMD"),
      logo: (p.logo as string) || (p.logo_url as string) || null,
      actor: mc.user?.name ?? null,
      scopes: mc.scopes,
      accessToken: mc.session.accessToken,
    },
  };
}
