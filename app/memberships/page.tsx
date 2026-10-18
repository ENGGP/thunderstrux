import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { formatDate, formatMoney, formatTerm, renewLabel } from "@/lib/format";
import { myMemberships, myMembershipViews, type MyMembershipView } from "@/lib/memberships/offers";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "My memberships" };

const viewLabels: Record<MyMembershipView, string> = { active: "Active", upcoming: "Upcoming", expired: "Expired", revoked: "Revoked" };
const unlockWords = { member_prices: "Member prices on tickets", members_only_events: "Members-only events" } as const;
const emptyCopy: Record<MyMembershipView, { title: string; body: string }> = {
  active: { title: "No memberships yet", body: "Societies sell memberships on their page. Joining a society for free doesn't count as one." },
  upcoming: { title: "Nothing upcoming", body: "Memberships you've bought that haven't started show here." },
  expired: { title: "No expired memberships", body: "Memberships show here after their last day." },
  revoked: { title: "Nothing here", body: "Memberships that ended early, by a refund or by the society, show here." }
};

// PER-03 (T24a, design round B1): the member's memberships in every society,
// by state, with Renew when the society has put its next term on sale.
export default async function MyMembershipsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/login?callbackUrl=/memberships");
    throw error;
  }
  if (user.accountRole === "organisation") redirect("/dashboard");
  const requested = (await searchParams).view;
  const view: MyMembershipView = myMembershipViews.includes(requested as MyMembershipView) ? (requested as MyMembershipView) : "active";
  const { memberships, counts } = await myMemberships(user.id, view);

  return (
    <PersonalShell>
      <div className="grid gap-1">
        <h1 className="text-3xl font-semibold text-ink">My memberships</h1>
        <p className="text-ink-soft">Memberships you&apos;ve bought or been given free. Joining a society for free is shown in Societies instead.</p>
      </div>
      <LinkTabs
        label="Membership views"
        tabs={myMembershipViews.map((item) => ({ href: item === "active" ? "/memberships" : `/memberships?view=${item}`, label: viewLabels[item], active: item === view, count: counts[item] }))}
      />
      {view === "active" || view === "upcoming" ? (
        <Notice title="Memberships don't renew automatically">
          <p className="mt-0.5">When a society puts its next term on sale, a Renew button appears on that membership.</p>
        </Notice>
      ) : null}
      {memberships.length === 0 ? (
        <EmptyState
          action={view === "active" ? <Link className={buttonClasses({ variant: "secondary" })} href="/organisations">Explore societies</Link> : undefined}
          icon="badge"
          title={emptyCopy[view].title}
        >
          {emptyCopy[view].body}
        </EmptyState>
      ) : (
        <ul className="grid gap-4">
          {memberships.map((membership) => {
            const zone = membership.society.timeZone;
            return (
              <li className="grid gap-4 rounded-card border border-line bg-surface p-5 sm:grid-cols-[48px_minmax(0,1fr)_auto] sm:items-start" key={membership.id}>
                {membership.society.logoAssetId ? (
                  <img alt="" className="hidden size-12 rounded-control border border-line bg-surface object-contain sm:block" height={48} src={`/api/public/assets/${membership.society.logoAssetId}`} width={48} />
                ) : (
                  <span aria-hidden="true" className="hidden size-12 items-center justify-center rounded-control border border-line font-display text-xl font-semibold text-brand-ink sm:flex">
                    {membership.society.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="grid min-w-0 gap-1.5">
                  <Link className="text-sm font-semibold text-ink-soft underline-offset-4 hover:underline [overflow-wrap:anywhere]" href={`/societies/${membership.society.slug}`}>
                    {membership.society.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="font-display text-xl font-semibold text-ink [overflow-wrap:anywhere]">{membership.plan}</h2>
                    <StatusBadge status={membership.state} />
                  </div>
                  <p className="text-ink">
                    {formatTerm(membership.startsAt, membership.endsAt, zone)}, {zoneCity(zone)}
                  </p>
                  {membership.revokedAt ? (
                    <p className="text-ink [overflow-wrap:anywhere]">
                      Ended early on {formatDate(membership.revokedAt, zone)}
                      {membership.endedBy === "refund"
                        ? " because the payment was refunded."
                        : membership.endedBy === "cancellation"
                          ? ` when ${membership.society.name} cancelled it: “${membership.revocationReason}”`
                          : ` by ${membership.society.name}: “${membership.revocationReason}”`}
                    </p>
                  ) : membership.state === "upcoming" ? (
                    <p className="text-ink">Benefits begin {formatDate(membership.startsAt, zone)}.</p>
                  ) : null}
                  {membership.entitlements.length ? <p className="text-sm text-ink-soft">{membership.entitlements.map((key) => unlockWords[key]).join(" · ")}</p> : null}
                  <p className="text-sm text-ink-soft">{membership.paidAmount ? `Paid ${formatMoney(membership.paidAmount)}` : "Free"}</p>
                </div>
                {membership.renewal ? (
                  <div className="grid gap-1.5 sm:justify-items-end">
                    <Link
                      aria-label={`Renew ${membership.society.name} membership: ${membership.renewal.name}`}
                      className={buttonClasses()}
                      href={`/societies/${membership.society.slug}/memberships/${membership.renewal.id}/checkout`}
                    >
                      {renewLabel(membership.renewal.name)}
                    </Link>
                    <span className="text-sm text-ink-soft">
                      {membership.renewal.priceAmount ? formatMoney(membership.renewal.priceAmount) : "Free"} · starts {formatDate(membership.renewal.startsAt, zone)}
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-ink-soft">Dates are in each society&apos;s own time zone. A membership ends at the end of its last day.</p>
    </PersonalShell>
  );
}
