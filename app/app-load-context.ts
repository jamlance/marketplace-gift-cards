// Make `args.context` in every loader/action the kit's resolved context.
// Type-only import (erased) — no server code reaches the client from here.
import type { AppKitRequestContext } from "@inkress/app-kit/server";

declare module "react-router" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AppLoadContext extends AppKitRequestContext {}
}

export {};
