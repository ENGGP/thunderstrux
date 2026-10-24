import Link from "next/link";

type SocietyCardProps = {
  name: string;
  slug: string;
  description: string;
  logoAssetId: string | null;
  nextEvent: { title: string } | null;
};

export function SocietyCard({
  name,
  slug,
  description,
  logoAssetId,
  nextEvent
}: SocietyCardProps) {
  return (
    <article className="relative flex gap-4 rounded-card border border-line bg-surface p-5 transition-shadow duration-150 hover:shadow-card">
      {logoAssetId ? (
        <img
          alt=""
          className="h-14 w-14 shrink-0 rounded-control border border-line object-contain"
          height={56}
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
        <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">
          <Link className="after:absolute after:inset-0" href={`/societies/${slug}`}>
            {name}
          </Link>
        </h2>
        {description ? <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{description}</p> : null}
        {nextEvent ? (
          <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">
            Coming up: {nextEvent.title}
          </p>
        ) : null}
      </div>
    </article>
  );
}
