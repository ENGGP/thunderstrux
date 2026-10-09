"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
type Context = { selected: { id: string } | null; organisations: Array<{ id: string; name: string }>; accountRole: string };
export function ContextSelector() {
  const router = useRouter();
  const [context, setContext] = useState<Context | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true;
    fetchJson<Context>("/api/me/context").then(value => { if (live) setContext(value); })
      .catch(() => { if (live) setError("Could not load your staff organisations."); });
    return () => { live = false; };
  }, []);
  async function select(value: string) {
    setBusy(true); setError(null);
    try {
      await fetchJson("/api/me/context", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value === "personal" ? { mode: "personal" } : { mode: "staff", organisationId: value }) });
      setContext(current => current ? { ...current, selected: value === "personal" ? null : { id: value } } : current);
      router.push("/dashboard"); router.refresh();
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not switch context.")); }
    finally { setBusy(false); }
  }
  return <div className="p-3">
    {context && context.organisations.length > 0 && <label className="grid gap-1 text-sm">
      Dashboard context
      <select aria-label="Dashboard context" className="rounded border p-2" disabled={busy}
        value={context.selected?.id ?? "personal"} onChange={event => select(event.target.value)}>
        <option value="personal">{context.accountRole === "member" ? "Personal" : "Choose organisation"}</option>
        {context.organisations.map(row => <option key={row.id} value={row.id}>{row.name} — Staff</option>)}
      </select>
    </label>}
    {error && <p role="alert">{error} <a className="underline" href="/mfa?callbackUrl=/dashboard">Staff MFA</a></p>}
  </div>;
}
