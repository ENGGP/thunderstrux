// Grey blocks that hold a layout while its data streams in. They are hidden
// from assistive technology; the stand-ins below carry one text label instead.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-control bg-surface-subtle motion-safe:animate-pulse ${className}`}
    />
  );
}

// Stand-in for a grid of event cards, built like EventCard (16:9 area from sm,
// date rail, four lines) in the same columns, so the cards replace it in place.
export function CardGridSkeleton({ label, count = 6 }: { label: string; count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <p className="sr-only">{label}</p>
      {Array.from({ length: count }, (_, index) => (
        <div aria-hidden="true" className="grid content-start gap-4 overflow-hidden rounded-card border border-line bg-surface p-5" key={index}>
          <Skeleton className="-mx-5 -mt-5 hidden aspect-video w-[calc(100%+2.5rem)] max-w-none rounded-none sm:block" />
          <div className="flex gap-4">
            <Skeleton className="h-16 w-14 shrink-0" />
            <div className="grid flex-1 content-start gap-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="mt-1 h-4 w-1/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Stand-in for a list or table: a title line, a meta line and a badge per row.
export function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="grid gap-5 rounded-card border border-line bg-surface p-5 sm:p-6">
      <p className="sr-only">{label}</p>
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex items-center gap-4" key={index}>
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}
