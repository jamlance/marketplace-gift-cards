// Client-recovery endpoint: POST { sessionJwt } when the session carrier was
// lost (reload with 3rd-party cookies blocked, cleared storage). Exchanges the
// fresh dashboard JWT for a server session and returns its id for the header carrier.
import type { Route } from "./+types/bv.bootstrap";
import { appKit, bootstrapFromJwt } from "~/lib/app-kit.server.mjs";

export async function action({ request }: Route.ActionArgs) {
  const { sessionJwt } = (await request.json().catch(() => ({}))) as { sessionJwt?: string };
  if (!sessionJwt) return Response.json({ error: "missing_jwt" }, { status: 400 });
  try {
    const session = await bootstrapFromJwt(appKit, sessionJwt);
    return Response.json({ sessionId: session.id });
  } catch (e) {
    return Response.json({ error: "exchange_failed", message: (e as Error).message }, { status: 401 });
  }
}
