"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// The only optional mail is the renewal reminder (T30); everything else a
// purchase or the account sends always arrives.
export function NotificationPreferencesForm({ renewalReminders: initial }: { renewalReminders: boolean }) {
  const router = useRouter();
  const [renewalReminders, setRenewalReminders] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSubmitting(true);
    try {
      await fetchJson("/api/me/notification-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renewalReminders })
      });
      setMessage("Preferences saved.");
      router.refresh();
    } catch (saveError) {
      setError(getClientErrorMessage(saveError, "Unable to save preferences."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid max-w-2xl gap-4" onSubmit={onSubmit}>
      {error ? <Notice role="alert" tone="danger">{error}</Notice> : null}
      {message ? <Notice role="status" tone="success">{message}</Notice> : null}
      <label className="flex items-start gap-3">
        <input
          checked={renewalReminders}
          className="mt-1 size-5 accent-brand"
          onChange={(event) => setRenewalReminders(event.target.checked)}
          type="checkbox"
        />
        <span className="grid">
          <span className="text-[15px] font-semibold text-ink">Membership renewal reminders</span>
          <span className="text-sm text-ink-soft">An email seven days before a membership ends, unless you already have the next one.</span>
        </span>
      </label>
      <div>
        <Button disabled={isSubmitting} type="submit" variant="secondary">
          {isSubmitting ? "Saving..." : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
