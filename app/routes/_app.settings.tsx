// Settings: the links customers use, and whether payments, email and pictures are working.
import { Box, CopyField, ExternalButton, FormSection, PageHeader, StatusPill, Tone, ButtonLink, ButtonKind } from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { blob, email, ensureWebhook, publicBaseUrl } from "~/lib/app-kit.server.mjs";
import { listDesigns } from "~/lib/gift.server";
import type { Route } from "./+types/_app.settings";

export const meta: Route.MetaFunction = () => [{ title: "Settings · Gift Cards" }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const [designs, realtime] = await Promise.all([listDesigns(db, m.id), ensureWebhook(m.id, m.accessToken).catch(() => false)]);
  return {
    base: publicBaseUrl,
    designs: designs.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name })),
    realtime,
    emailReady: email.configured(),
    picturesReady: blob.configured(),
  };
}

function Ready({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return on ? <StatusPill tone={Tone.Ok}>{yes}</StatusPill> : <StatusPill tone={Tone.Warn}>{no}</StatusPill>;
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { base, designs, realtime, emailReady, picturesReady } = loaderData;
  return (
    <>
      <PageHeader title="Settings" summary="The links customers use, and how Gift Cards connects to your shop." />
      <Box>
        <FormSection title="Your gift card page" description="Share it on WhatsApp, Instagram or your website. Customers pick an amount and pay through Inkress.">
          {designs.length && base ? (
            designs.map((d) => (
              <div className="ui-field" key={d.id}>
                <span className="ui-label">{d.name}</span>
                <CopyField value={`${base}/gift/${d.id}`} />
              </div>
            ))
          ) : (
            <p className="ui-t2" style={{ margin: 0 }}>Create a design first. <ButtonLink to="/designs/new" kind={ButtonKind.Primary} size="sm">Create a design</ButtonLink></p>
          )}
        </FormSection>
        <FormSection title="Balance check" description="Customers type their code to see what's left. It can't be used to spend.">
          {base ? <CopyField value={`${base}/balance`} /> : <p className="ui-t3">Not available.</p>}
        </FormSection>
        <FormSection title="Connections" description="What makes cards turn on and arrive by themselves.">
          <div className="ui-row"><div className="ui-grow">Payments turn cards on straight away<small>Inkress tells Gift Cards the moment a card is paid.</small></div><Ready on={realtime} yes="Working" no="Checked when you open the app" /></div>
          <div className="ui-row"><div className="ui-grow">Cards are emailed to the people they're for<small>Including cards scheduled for a later date.</small></div><Ready on={emailReady} yes="Working" no="Not set up" /></div>
          <div className="ui-row"><div className="ui-grow">Your own pictures on cards</div><Ready on={picturesReady} yes="Working" no="Not set up" /></div>
        </FormSection>
        <FormSection title="Export" description="Every card with its balance, for your accountant or a spreadsheet.">
          <ExternalButton href="/cards.csv" icon="dl" download>Download CSV</ExternalButton>
        </FormSection>
      </Box>
    </>
  );
}
