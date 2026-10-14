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
