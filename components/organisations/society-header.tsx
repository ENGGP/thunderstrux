import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { tabBarClasses, tabClasses } from "@/components/ui/link-tabs";
import { formatDate } from "@/lib/format";

// The society's cover, logo, name, the viewer's Joined and membership badges,
// and the section tabs, shared by its Overview, Memberships and Merchandise pages.
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
        {organisation.coverAssetId ? (
          <img alt="" className="aspect-video w-full rounded-b-feature object-cover md:aspect-[3/1]" src={`/api/public/assets/${organisation.coverAssetId}`} />
        ) : (
          <div aria-hidden="true" className="h-32 rounded-b-feature bg-brand-tint md:h-48" />
        )}
        <div className="-mt-9 flex flex-col items-start gap-3 px-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4 md:px-6">
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
            <p className="text-sm text-ink-muted">Society</p>
            <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere] md:text-5xl">{organisation.name}</h1>
            {joined || memberUntil ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {joined ? <StatusBadge status="joined" /> : null}
                {memberUntil ? (
                  <StatusBadge label={`Member until ${formatDate(new Date(memberUntil.getTime() - 1), organisation.timeZone)}`} status="active" />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav aria-label="Society sections" className={`mt-8 ${tabBarClasses}`}>
        <Link aria-current={current === "overview" ? "page" : undefined} className={tabClasses(current === "overview")} href={base}>
          Overview
        </Link>
        <Link className={tabClasses(false)} href={`${base}#events`}>
          Events
        </Link>
        {hasMemberships || current === "memberships" ? (
          <Link aria-current={current === "memberships" ? "page" : undefined} className={tabClasses(current === "memberships")} href={`${base}/memberships`}>
            Memberships
          </Link>
        ) : null}
        {hasMerchandise || current === "merchandise" ? (
          <Link aria-current={current === "merchandise" ? "page" : undefined} className={tabClasses(current === "merchandise")} href={`${base}/merchandise`}>
            Merchandise
          </Link>
        ) : null}
      </nav>
    </>
  );
}
