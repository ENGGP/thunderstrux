"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
function useRetry(reset: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return [pending, () => startTransition(() => {
    router.refresh();
    reset();
  })] as const;
}

// Covers every society page (profile, shop, basket), so it names none of them.
export default function SocietyError({ reset }: { reset: () => void }) {
  const [pending, retryPage] = useRetry(reset);
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full grid max-w-page gap-4 px-4 py-10 md:px-8">
      <h1 className="text-2xl font-semibold text-ink">We couldn&apos;t load this page</h1>
      <p className="text-ink-soft" role="alert">Try again, and if it keeps happening come back in a few minutes.</p>
      <div>
        <Button busy={pending} busyLabel="Trying again…" onClick={retryPage} type="button">Try again</Button>
      </div>
    </main>
  );
}
