import Link from "next/link";

type SocietyCardProps = {
  name: string;
  slug: string;
  description: string;
  logoAssetId: string | null;
  nextEvent: { title: string } | null;
  // h2 on /societies, where cards sit under the page title; h3 under a section heading such as the home page's.
  headingLevel?: "h2" | "h3";
};

export function SocietyCard({
  name,
  slug,
  description,
  logoAssetId,
  nextEvent,
  headingLevel: Heading = "h2"
}: SocietyCardProps) {
  return (
    <article className="relative flex gap-4 rounded-card border border-line bg-surface p-5 hover:shadow-card">
      {logoAssetId ? (
        <img
          alt=""
          className="h-14 w-14 shrink-0 rounded-control border border-line object-contain"
          decoding="async"
          height={56}
          loading="lazy"
          src={`/api/public/assets/${logoAssetId}`}
          width={56}
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-control bg-brand-tint font-display text-xl font-semibold text-brand-ink"
        >
          {name.trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div className="grid min-w-0 content-start gap-1">
        {/* DM Sans, as every card title is (DESIGN.md, Two-Voice Rule); h2s default to the display face. */}
        <Heading className="font-sans text-lg font-semibold text-ink [overflow-wrap:anywhere]">
          <Link className="after:absolute after:inset-0" href={`/societies/${slug}`}>
            {name}
          </Link>
        </Heading>
        {description ? <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{description}</p> : null}
        {nextEvent ? (
          <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">
            Coming up: {nextEvent.title}
          </p>
        ) : description ? null : (
          <p className="text-sm text-ink-muted">No upcoming events yet</p>
        )}
      </div>
    </article>
  );
}
