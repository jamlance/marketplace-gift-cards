// Every merchant page: the dashboard session, the app's own tabs, and the one primary action.
import { Outlet } from "react-router";
import { BvProvider } from "@inkress/app-kit/client";
import { AppFrame, AppNav, ButtonLink, ButtonKind, ButtonSize } from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import type { Route } from "./+types/_app";

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const r = await db.one<{ n: string }>(`SELECT count(*) n FROM cards WHERE merchant_id=$1`, [m.id]);
  return { sessionId: args.context.bootstrap?.sessionId ?? null, mode: args.context.appKit.config.mode, cardCount: Number(r?.n ?? 0) };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <BvProvider sessionId={loaderData.sessionId} mode={loaderData.mode}>
      <AppFrame
        nav={
          <AppNav
            items={[
              { to: "/", label: "Overview", end: true },
              { to: "/cards", label: "Gift cards", count: loaderData.cardCount },
              { to: "/redemptions", label: "Redemptions" },
              { to: "/designs", label: "Designs" },
              { to: "/settings", label: "Settings" },
            ]}
            actions={<ButtonLink to="/cards/new" kind={ButtonKind.Primary} size={ButtonSize.Small} icon="plus">Issue gift card</ButtonLink>}
          />
        }
      >
        <Outlet />
      </AppFrame>
    </BvProvider>
  );
}
