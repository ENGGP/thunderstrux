"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContextChoices } from "@/lib/auth/context";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

const roleLabels = {
  owner: "Owner",
  admin: "Admin",
  event_manager: "Events",
  finance_manager: "Finance",
  check_in_staff: "Check-in"
};

// The choices come from the server with the page, so the selector never shows
// a society the caller cannot manage. Selecting one only records a preference:
// every page and API re-checks live authority.
export function ContextSelector({ contexts }: { contexts: ContextChoices }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = contexts.selectedId ?? "personal";

  if (contexts.organisations.length === 0) {
    return null;
  }

  async function select(target: HTMLSelectElement) {
    const value = target.value;
    setBusy(true);
    setError(null);

    try {
      await fetchJson("/api/me/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          value === "personal"
            ? { mode: "personal" }
            : { mode: "staff", organisationId: value }
        )
      });
      router.push("/dashboard");
      router.refresh();
    } catch (failure) {
      target.value = current;
      setError(getClientErrorMessage(failure, "Could not switch context."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5 text-sm">
      <label className="grid gap-1.5 font-medium">
        Dashboard context
        {/* Keyed so the control follows the server value after a refresh. */}
        <select
          aria-label="Dashboard context"
          className="h-10 w-full rounded-control border border-line-strong bg-surface px-2 font-normal text-ink"
          defaultValue={current}
          disabled={busy}
          key={current}
          onChange={(event) => select(event.target)}
        >
          <option value="personal">
            {contexts.accountRole === "member" ? "Personal" : "Choose organisation"}
          </option>
          {contexts.organisations.map((organisation) => (
            <option key={organisation.id} value={organisation.id}>
              {organisation.name} · {roleLabels[organisation.staffRole]}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert">
          {error}{" "}
          <a className="underline" href="/mfa?callbackUrl=/dashboard">
            Staff MFA
          </a>
        </p>
      ) : null}
    </div>
  );
}
