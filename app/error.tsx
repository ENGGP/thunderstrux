"use client";

import { Button } from "@/components/ui/button";

// Deliberately says nothing about the cause: error details stay in server logs.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto grid max-w-read gap-4 px-4 py-20 sm:px-6">
      <h1 className="text-3xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-ink-soft" role="alert">
        The page could not be loaded. Nothing you entered was submitted. Try
        again, and if it keeps happening come back in a few minutes.
      </p>
      <div>
        <Button onClick={reset} type="button">
          Try again
        </Button>
      </div>
    </main>
  );
}
