import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { TabLabel, tabBarClasses, tabClasses } from "@/components/ui/link-tabs";
import { formatDate } from "@/lib/format";

// The society's cover, logo, name, the viewer's Joined and membership badges,
// and the section tabs, shared by its Overview, Memberships and Merchandise pages.
// Only Overview shows the cover, so a tab's own content starts near the top.
// A tab shows only when the society has published content of that kind.
export function SocietyHeader({
  organisation,
  current,
  hasMemberships,
  hasMerchandise = false,
  joined,
  memberUntil
}: {
  organisation: { name: string; slug: string; timeZone: string; coverAssetId: string | null; logoAssetId: string | null };
  current: "overview" | "memberships" | "merchandise";
  hasMemberships: boolean;
  hasMerchandise?: boolean;
  joined: boolean;
  memberUntil: Date | null;
}) {
  const base = `/societies/${organisation.slug}`;
  return (
    <>
      <header>
        {/* The same header on every tab, so the tabs never move when you switch. */}
        {organisation.coverAssetId ? (
          <img alt="" className="mt-6 aspect-[3/1] w-full rounded-feature object-cover md:aspect-[5/1]" src={`/api/public/assets/${organisation.coverAssetId}`} />
        ) : (
          // A quiet branded pattern, not an empty box that reads as a broken image.
          <div aria-hidden="true" className="mt-6 h-24 rounded-feature bg-brand-tint bg-[repeating-linear-gradient(135deg,transparent_0_15px,color-mix(in_srgb,var(--ts-brand)_9%,transparent)_15px_16px)] md:h-32" />
        )}
        <div className={`flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4 -mt-9 px-2 md:px-6`}>
          {organisation.logoAssetId ? (
            <img
              alt={`${organisation.name} logo`}
              className="h-[72px] w-[72px] rounded-card border border-line bg-surface object-contain"
              height={72}
              src={`/api/public/assets/${organisation.logoAssetId}`}
              width={72}
            />
          ) : (
            <div aria-hidden="true" className="flex h-[72px] w-[72px] items-center justify-center rounded-card border border-line bg-surface font-display text-3xl font-semibold text-brand-ink">
              {organisation.name.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1 sm:pt-10">
            <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-5xl">{organisation.name}</h1>
            {/* Kept even when empty, so joining adds a badge without moving the page. */}
            <div className="mt-2.5 flex min-h-6 flex-wrap gap-2">
              {joined ? <StatusBadge status="joined" /> : null}
              {memberUntil ? (
                <StatusBadge label={`Member until ${formatDate(new Date(memberUntil.getTime() - 1), organisation.timeZone)}`} status="active" />
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <nav aria-label="Society sections" className={`mt-8 ${tabBarClasses}`}>
        <Link aria-current={current === "overview" ? "page" : undefined} className={tabClasses(current === "overview")} href={base}>
          <TabLabel>Overview</TabLabel>
        </Link>
        {hasMemberships || current === "memberships" ? (
          <Link aria-current={current === "memberships" ? "page" : undefined} className={tabClasses(current === "memberships")} href={`${base}/memberships`}>
            <TabLabel>Memberships</TabLabel>
          </Link>
        ) : null}
        {hasMerchandise || current === "merchandise" ? (
          <Link aria-current={current === "merchandise" ? "page" : undefined} className={tabClasses(current === "merchandise")} href={`${base}/merchandise`}>
            <TabLabel>Merchandise</TabLabel>
          </Link>
        ) : null}
      </nav>
    </>
  );
}
