// Create or edit a design, with a live preview. Settings-style sections and a save bar.
import { useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import {
  AffixField,
  Box,
  Button,
  ButtonKind,
  ButtonLink,
  FileDrop,
  FormSection,
  PageHeader,
  Switch,
  TextAreaField,
  TextField,
  formatMoney,
} from "@inkress/app-kit/ui";
import { useMerchant } from "~/lib/merchant.server";
import { getDesign, parseDesign, saveDesign } from "~/lib/gift.server";
import { CARD_THEMES, THEME_KEYS } from "~/lib/card-design.mjs";
import { CardArt } from "~/components/card-art";
import type { Route } from "./+types/_app.designs.$id";

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.id === "new" ? "New design" : "Edit design"} · Gift Cards` }];

export async function loader(args: Route.LoaderArgs) {
  const { db, m } = await useMerchant(args);
  const isNew = args.params.id === "new";
  const design = isNew ? null : await getDesign(db, Number(args.params.id), m.id);
  if (!isNew && !design) throw new Response("That design doesn't exist.", { status: 404 });
  return { shopName: m.name, currency: m.currency, design };
}

export async function action(args: Route.ActionArgs) {
  const { db, m } = await useMerchant(args);
  const parsed = parseDesign(await args.request.formData(), THEME_KEYS);
  if ("error" in parsed) return { errors: parsed.error };
  await saveDesign(db, m.id, args.params.id === "new" ? null : Number(args.params.id), parsed, { name: m.name, logo: m.logo, currency: m.currency });
  return redirect("/designs");
}

export default function DesignEdit({ loaderData }: Route.ComponentProps) {
  const { design, shopName, currency } = loaderData;
  const errors = useActionData<typeof action>()?.errors ?? {};
  const nav = useNavigation();
  const [name, setName] = useState(design?.name ?? "Gift card");
  const [theme, setTheme] = useState(design?.theme ?? "classic");
  const [image, setImage] = useState<string | null>(design?.image ?? null);
  const [amounts, setAmounts] = useState((design?.amounts ?? [2500, 5000, 10000]).join(", "));
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const first = Number(amounts.split(/[,\s]+/).find((s) => Number(s) > 0) ?? 5000);

  const onFile = (file: File) => {
    setUpload({ busy: true, error: null });
    const reader = new FileReader();
    reader.onload = async () => {
      const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: reader.result }) });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (j.url) setImage(j.url);
      setUpload({ busy: false, error: j.url ? null : j.error ?? "That didn't upload. Try again." });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <PageHeader back={{ to: "/designs", label: "Designs" }} title={design ? `Edit ${design.name}` : "New design"} summary="Customers see this on your gift card page and in their email." />
      <div className="ui-two">
        <Form method="post" id="design">
          <FormSection title="Look" description="A colour, or your own picture.">
            <TextField label="Name customers see" name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} error={errors.name} />
            <div className="ui-field">
              <span className="ui-label">Colour</span>
              <div className="gc-themes" role="radiogroup" aria-label="Colour">
                {THEME_KEYS.map((k) => (
                  <label key={k} style={{ background: CARD_THEMES[k]!.grad }} title={CARD_THEMES[k]!.label}>
                    <input type="radio" name="theme" value={k} checked={theme === k} onChange={() => setTheme(k)} aria-label={CARD_THEMES[k]!.label} />
                  </label>
                ))}
              </div>
            </div>
            <div className="ui-field">
              <span className="ui-label">Picture (optional)</span>
              <FileDrop accept="image/png,image/jpeg,image/webp,image/gif" maxBytes={5 * 1024 * 1024} currentUrl={image} hint="JPG, PNG or WEBP, up to 5 MB. Shown behind the amount." busy={upload.busy} error={upload.error} onFile={onFile} onRemove={() => setImage(null)} />
              <input type="hidden" name="image" value={image ?? ""} />
            </div>
          </FormSection>
          <FormSection title="Amounts" description="Fixed amounts, any amount, or both.">
            <TextField label="Fixed amounts" name="amounts" value={amounts} onChange={(e) => setAmounts(e.target.value)} hint="Separate with commas, e.g. 2500, 5000, 10000." error={errors.amounts} inputMode="decimal" />
            <Switch name="allow_custom" defaultChecked={design?.allowCustom ?? true} label="Let customers choose any amount" />
            <div className="ui-field-row">
              <AffixField label="Least" name="min_amount" prefix={currency} type="number" defaultValue={design?.minAmount ?? 500} min={1} />
              <AffixField label="Most" name="max_amount" prefix={currency} type="number" defaultValue={design?.maxAmount ?? 50000} min={1} error={errors.max_amount} />
            </div>
          </FormSection>
          <FormSection title="Rules" description="Printed small on the card and the page.">
            <AffixField label="Cards last" name="expiry_months" suffix="months" type="number" min={0} max={120} defaultValue={design?.expiryMonths ?? 12} hint="0 means cards never expire." />
            <TextAreaField label="Terms (optional)" name="terms" rows={3} maxLength={400} defaultValue={design?.terms ?? ""} placeholder="Not exchangeable for cash. Use in store or online." />
            <Switch name="active" defaultChecked={design?.active ?? true} label="On sale" description="Turn off to stop selling this design. Cards already sold keep working." onChange={(e) => { const h = document.getElementById("active-off") as HTMLInputElement | null; if (h) h.disabled = e.currentTarget.checked; }} />
            <input id="active-off" type="hidden" name="active" value="off" disabled={design?.active ?? true} />
          </FormSection>
          <div className="ui-form-actions" style={{ paddingBottom: 24 }}>
            <ButtonLink to="/designs">Cancel</ButtonLink>
            <Button kind={ButtonKind.Primary} type="submit" busy={nav.state === "submitting"}>{design ? "Save design" : "Create design"}</Button>
          </div>
        </Form>
        <div style={{ position: "sticky", top: 16 }}>
          <Box title="Preview">
            <div className="gc-preview">
              <CardArt design={{ name, theme, accent: CARD_THEMES[theme]?.accent ?? "#2563eb", image }} shopName={shopName} amount={first} currency={currency} />
              <p>Starts at {formatMoney(first, currency, { cents: false })}.</p>
            </div>
          </Box>
        </div>
      </div>
    </>
  );
}
