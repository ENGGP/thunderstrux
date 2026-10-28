import { Skeleton } from "@/components/ui/skeleton";

// A society's pages share one header (cover, logo, name, tabs), so their loading
// state has that shape rather than the society list's, and is a screen tall so
// the footer never flashes up first.
export default function SocietyLoading() {
  return (
    <main id="main" tabIndex={-1} className="min-h-[calc(100svh-60px)] bg-paper pb-14 md:min-h-[calc(100svh-72px)]">
      <div className="mx-auto max-w-page px-4 md:px-8">
        <p className="sr-only">Loading society</p>
        <Skeleton className="mt-6 h-24 rounded-feature md:h-32" />
        <div className="-mt-9 flex items-end gap-4 px-2 md:px-6">
          <Skeleton className="h-[72px] w-[72px] rounded-card" />
          <Skeleton className="mb-2 h-10 w-64 max-w-full" />
        </div>
        <Skeleton className="mt-8 h-11 w-80 max-w-full" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      </div>
    </main>
  );
}
