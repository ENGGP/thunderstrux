"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ContextChoices } from "@/lib/auth/context";
import { getClientErrorMessage } from "@/lib/client/api";
import { switchContext } from "@/lib/client/context";

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
export function ContextSelector({
  contexts,
  tone = "light"
}: {
  contexts: ContextChoices;
  tone?: "light" | "dark";
}) {
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
      await switchContext(value);
      router.push("/dashboard");
      router.refresh();
    } catch (failure) {
      target.value = current;
      setError(getClientErrorMessage(failure, "Could not switch context."));
    } finally {
      setBusy(false);
    }
  }

  const currentRole = contexts.organisations.find((organisation) => organisation.id === current)?.staffRole;

  return (
    <div className={`grid gap-1.5 text-sm ${tone === "dark" ? "text-white" : "text-ink"}`}>
      <label className={`grid gap-1.5 text-xs font-semibold ${tone === "dark" ? "text-white/75" : "text-ink-soft"}`}>
        Workspace
        {/* Keyed so the control follows the server value after a refresh. */}
        <select
          aria-label="Workspace"
          className="h-11 w-full rounded-control border border-line-strong bg-surface px-2 text-sm font-medium text-ink"
          defaultValue={current}
          disabled={busy}
          key={current}
          onChange={(event) => select(event.target)}
        >
          <option value="personal">
            {contexts.accountRole === "member" ? "Personal" : "Choose a society"}
          </option>
          {contexts.organisations.map((organisation) => (
            <option key={organisation.id} value={organisation.id}>
              {organisation.name}
            </option>
          ))}
        </select>
      </label>
      {/* The role sits outside the select so the society name isn't cut off in the sidebar. */}
      {currentRole ? <p className={`text-xs ${tone === "dark" ? "text-white/75" : "text-ink-soft"}`}>Your role: {roleLabels[currentRole]}</p> : null}
      {error ? (
        <p role="alert">
          {error}
          {/* Offer the authenticator only when that is what stopped the switch. */}
          {/authenticator|MFA/i.test(error) ? (
            <>
              {" "}
              <a className="font-semibold underline" href="/mfa?callbackUrl=/dashboard">
                Verify staff authenticator
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

// The personal overview's shortcut for staff: one tap into a society, because a
// new sign-in always starts personal (the workspace is a per-sign-in preference).
// Check-in staff land on their door; everyone else on the society overview.
export function SocietyShortcuts({ contexts }: { contexts: ContextChoices }) {
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  if (contexts.organisations.length === 0) return null;

  async function open(id: string) {
    setOpening(id);
    setFailed(null);
    try {
      await switchContext(id);
      router.push("/dashboard");
      router.refresh();
    } catch (failure) {
      setFailed({ id, text: getClientErrorMessage(failure, "Could not open that society. Try again.") });
      setOpening(null);
    }
  }

  return (
    <section aria-labelledby="society-shortcuts" className="grid gap-3 rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-semibold text-ink" id="society-shortcuts">Societies you help run</h2>
      <ul className="grid">
        {contexts.organisations.map((organisation) => (
          <li className="grid gap-2 border-t border-line py-3 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={organisation.id}>
            <span className="grid min-w-0">
              <span className="font-semibold text-ink [overflow-wrap:anywhere]">{organisation.name}</span>
              <span className="text-sm text-ink-soft">
                Your role: {roleLabels[organisation.staffRole]}
                {organisation.staffRole === "check_in_staff" ? " · today's door" : ""}
              </span>
            </span>
            <Button busy={opening === organisation.id} busyLabel="Opening…" disabled={opening !== null} onClick={() => void open(organisation.id)} type="button" variant="secondary">
              Open<span className="sr-only"> {organisation.name}</span>
            </Button>
            {failed?.id === organisation.id ? (
              <p className="text-sm text-danger sm:col-span-2" role="alert">
                {failed.text}
                {/authenticator|MFA/i.test(failed.text) ? (
                  <>
                    {" "}
                    <a className="font-semibold underline" href="/mfa?callbackUrl=/dashboard">Verify staff authenticator</a>
                  </>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
