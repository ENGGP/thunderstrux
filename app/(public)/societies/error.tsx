"use client";
import { Button } from "@/components/ui/button";
export default function SocietyError({ reset }: { reset: () => void }) {
  return (
    <main className="society-surface space-y-4 p-8">
      <h1 className="text-xl font-semibold">Unable to load societies</h1>
      <p>Please try again.</p>
      <Button variant="society" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
