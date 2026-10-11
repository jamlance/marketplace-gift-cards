// One place that turns a card's status into words and a tone, so every screen says the same thing.
import { StatusPill, Tone, formatDate } from "@inkress/app-kit/ui";
import type { Card, CardStatus } from "~/lib/gift";

const LABEL: Record<CardStatus, string> = { active: "Active", expiring: "Expiring", expired: "Expired", used: "Used up", awaiting: "Not paid yet", off: "Turned off", scheduled: "Scheduled" };
const TONE: Record<CardStatus, Tone> = { active: Tone.Ok, expiring: Tone.Warn, expired: Tone.Bad, used: Tone.Neutral, awaiting: Tone.Neutral, off: Tone.Neutral, scheduled: Tone.Info };

export function CardStatusPill({ status, card }: { status: CardStatus; card?: Pick<Card, "expiresOn" | "deliverOn"> }) {
  let label = LABEL[status];
  if (status === "expiring" && card?.expiresOn) label = `Expires ${formatDate(card.expiresOn)}`;
  if (status === "scheduled" && card?.deliverOn) label = `Sends ${formatDate(card.deliverOn)}`;
  return <StatusPill tone={TONE[status]}>{label}</StatusPill>;
}
