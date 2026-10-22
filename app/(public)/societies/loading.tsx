import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingSocieties() {
  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-10 md:px-8 md:py-14">
        <p className="sr-only">Loading societies</p>
        <div className="grid gap-3">
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-11 w-full max-w-xl" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton className="h-28 rounded-card" key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}
