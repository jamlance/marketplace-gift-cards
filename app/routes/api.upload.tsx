// Card image upload (S3). The browser sends a data URL; the server checks type and size.
import { decodeDataUrl, isAllowedImage } from "@inkress/app-kit/server/services";
import { useMerchant } from "~/lib/merchant.server";
import { blob } from "~/lib/app-kit.server.mjs";
import type { Route } from "./+types/api.upload";

const MAX_BYTES = 5 * 1024 * 1024;

export async function action(args: Route.ActionArgs) {
  const { m } = await useMerchant(args);
  if (!blob.configured()) return Response.json({ error: "Image hosting isn't set up. Pick a colour instead." }, { status: 503 });
  const body = (await args.request.json().catch(() => null)) as { data?: string } | null;
  const decoded = body?.data ? decodeDataUrl(body.data) : null;
  if (!decoded || !isAllowedImage(decoded.contentType)) return Response.json({ error: "Use a JPG, PNG, WEBP or GIF." }, { status: 400 });
  if (decoded.body.length > MAX_BYTES) return Response.json({ error: "The image must be under 5 MB." }, { status: 400 });
  const { url } = await blob.put({ prefix: `gift-cards/${m.id}`, body: decoded.body, contentType: decoded.contentType });
  return Response.json({ url });
}
