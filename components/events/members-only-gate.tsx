import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { MembersOnlyGate as Gate } from "@/lib/events/public-events";
import { formatDate } from "@/lib/format";

// What someone without access sees on a members-only event's link (design
// round B1): the society and why, never anything about the event itself.
export function MembersOnlyGate({ gate, eventHref }: { gate: Gate; eventHref: string }) {
  const { society } = gate;
  const memberships = `/societies/${society.slug}/memberships`;
  const back = encodeURIComponent(eventHref);
  const message = {
    signed_out: `This event is for ${society.name} members. Sign in to check your membership.`,
    unverified: `This event is for ${society.name} members. Verify your email to check your membership.`,
    no_membership: `This event is for ${society.name} members, and you don't have an active membership. Joining for free doesn't count.`,
    not_included: `This event is for ${society.name} members. Your current membership doesn't include members-only events.`,
    upcoming: `This event is for ${society.name} members. Your membership starts ${gate.startsAt ? formatDate(gate.startsAt, gate.timeZone) : "soon"}. You can see this event from then.`
  }[gate.reason];
  const first =
    gate.reason === "signed_out"
      ? { href: `/login?callbackUrl=${back}`, label: "Sign in" }
      : gate.reason === "unverified"
        ? { href: `/verify-email?callbackUrl=${back}`, label: "Verify email" }
        : { href: memberships, label: "See memberships" };
  const second = first.href === memberships ? { href: "/events", label: "Explore events" } : { href: memberships, label: "See memberships" };

  return (
    <div className="mx-auto grid max-w-xl px-4 py-10 md:px-8 md:py-16">
      <section className="grid gap-4 rounded-card border border-line bg-surface p-5 md:p-6">
        <Link className="flex w-fit items-center gap-3 font-semibold text-ink underline-offset-4 hover:underline" href={`/societies/${society.slug}`}>
          {society.logoAssetId ? (
            <img alt="" className="size-8 rounded-control border border-line bg-surface object-contain" height={32} src={`/api/public/assets/${society.logoAssetId}`} width={32} />
          ) : (
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-control border border-line bg-surface font-display font-semibold text-brand-ink">
              {society.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="[overflow-wrap:anywhere]">{society.name}</span>
        </Link>
        <Icon className="text-brand" name="lock" size={24} />
        <h1 className="font-display text-3xl font-semibold text-ink">Members-only event</h1>
        <p className="text-ink [overflow-wrap:anywhere]">{message}</p>
        <div className="grid gap-3 sm:flex sm:flex-wrap">
          <Link className={buttonClasses({ size: "lg" })} href={first.href}>{first.label}</Link>
          <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={second.href}>{second.label}</Link>
        </div>
      </section>
    </div>
  );
}
