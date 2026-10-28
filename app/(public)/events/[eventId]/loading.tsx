import { Skeleton } from "@/components/ui/skeleton";

export default function PublicEventLoading() {
  return (
    <main id="main" tabIndex={-1} className="min-h-[calc(100svh-60px)] bg-paper md:min-h-[calc(100svh-72px)]">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-10 md:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <p className="sr-only">Loading event</p>
        <div className="grid gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="mt-4 h-32" />
        </div>
        <Skeleton className="h-72 rounded-card" />
      </div>
    </main>
  );
}
