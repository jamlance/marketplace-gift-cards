# Gift Cards

Inkress-embedded app: merchants sell gift cards online, issue store credit, take cards at the till, and see balances. Customers buy on a public page and check their balance with their code.

Rebuilt on `@inkress/app-kit` and its `ui` component layer (INK-1092, design board INK-1071). Runs inside the merchant dashboard's app frame; the dashboard shows the app's name, the app starts with its own tabs.

## Pages

| Path | Who | What |
|---|---|---|
| `/` | merchant | Setup checklist until done, stat tiles, weekly sales, what needs attention |
| `/cards` | merchant | Status tabs, search, source/design filters, cursor pages, bulk resend / extend / turn off, CSV |
| `/cards/:id` | merchant | Balance, history, use balance, add money, change expiry, resend/remind, turn off/on, notes, PDF |
| `/cards/new` | merchant | Issue a card without payment (store credit, giveaway, goodwill) |
| `/redemptions` | merchant | Take a card at the till by code; every use and top-up |
| `/designs`, `/designs/:id` | merchant | Card look, amounts, expiry, terms, on sale or hidden; buy-page link |
| `/settings` | merchant | Buy-page and balance links, connection status, export |
| `/gift/:designId` | public | Buy a card; creates an Inkress order and sends the buyer to pay |
| `/balance` | public | Check a card's balance by code |
| `/webhooks/inkress/:merchantId` | Inkress | Paid order → card turns on and is emailed (or held until its send date) |

## Data

Postgres schema `gift_cards` in the shared `bookerva_apps` database (`APP_NAME=gift_cards`). The original app's tables are kept as they were; the rebuild only adds columns (`source`, `reason`, `deactivated_at`, `reminded_at`) and a `merchant_settings` table. Card history is the `redemptions` table, one row per event (`kind`). DDL: `app/lib/schema.server.mjs`.

## Run

```bash
pnpm install
cp .env.example .env   # fill in; APP_NAME must stay gift_cards
node --env-file=.env server.mjs
```

Open it with a dashboard session: the app needs the `inkress_session` JWT the dashboard puts on the frame URL (valid 60 seconds). Locally, leave `INKRESS_WEBHOOK_SECRET` and AWS keys out so nothing registers a webhook at localhost or sends real email.

## Deploy

Coolify app `marketplace-gift-cards` (`no84o0w88s4ok0c8swwks8c8`, bserve), branch `main`, `/Dockerfile`, port 3000, https://gift-cards.apps.inkress.com. Talks to dev Inkress (`INKRESS_API_BASE=https://api-dev.inkress.com/api/v1`, `MODE=sandbox`). `FRAME_ANCESTORS` must list the dashboards that open it.

`@inkress/app-kit` is pinned to a commit in `package.json`; bump it deliberately.
