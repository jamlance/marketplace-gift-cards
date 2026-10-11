import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteError } from "react-router";
import { useReauthHandler } from "@inkress/app-kit/client";
import { EmptyState, Button, ButtonKind } from "@inkress/app-kit/ui";
import uiStyles from "@inkress/app-kit/ui.css?url";
import styles from "./styles.css?url";
import type { Route } from "./+types/root";

export const links: Route.LinksFunction = () => [
  { rel: "preload", href: uiStyles, as: "style" },
  { rel: "stylesheet", href: uiStyles },
  { rel: "stylesheet", href: styles },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const reconnecting = useReauthHandler();
  const error = useRouteError();
  if (reconnecting) {
    return (
      <main className="ui-main-in">
        <EmptyState icon="refresh" title="Reconnecting to your dashboard…" />
      </main>
    );
  }
  if (isRouteErrorResponse(error) && error.status === 401) {
    return (
      <main className="ui-main-in">
        <EmptyState icon="lock" title="Open Gift Cards from your Inkress dashboard">
          This page runs inside your dashboard, under Browse apps.
        </EmptyState>
      </main>
    );
  }
  const message = isRouteErrorResponse(error) ? (typeof error.data === "string" ? error.data : error.statusText) : "Something went wrong on our side.";
  return (
    <main className="ui-main-in">
      <EmptyState
        icon="alert"
        title={isRouteErrorResponse(error) && error.status === 404 ? "That page doesn't exist" : "This page didn't load"}
        actions={<Button kind={ButtonKind.Primary} onClick={() => window.location.reload()}>Reload</Button>}
      >
        {message}
      </EmptyState>
    </main>
  );
}
