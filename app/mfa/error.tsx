"use client";

import { Button, buttonClasses } from "@/components/ui/button";

export default function MfaError({ reset }: { reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full grid max-w-read gap-4 px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Staff verification is temporarily unavailable</h1>
      <p className="text-ink-soft">
        The verification service could not be loaded. Try again after the service has recovered.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <a className={buttonClasses({ variant: "secondary" })} href="/dashboard">
          Return to dashboard
        </a>
      </div>
    </main>
  );
}
