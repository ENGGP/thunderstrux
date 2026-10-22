"use client";
import { Button } from "@/components/ui/button";
export default function SocietyError({ reset }: { reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto grid max-w-page gap-4 px-4 py-10 md:px-8">
      <h1 className="text-2xl font-semibold text-ink">Unable to load societies</h1>
      <p className="text-ink-soft">Please try again.</p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
