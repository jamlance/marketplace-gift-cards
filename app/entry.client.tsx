import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { installBvFetch } from "@inkress/app-kit/client";

// Attach X-BV-Session to same-origin fetches so RR7 data/action requests
// authenticate even when 3rd-party cookies are blocked.
installBvFetch();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
