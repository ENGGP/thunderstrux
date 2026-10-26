"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Asks for an email and sends a link to it: the checkout email step and Find
// your tickets. The answer never says whether the address has anything. At
// checkout it also asks for a name, which door staff search by.
export function GuestEmailForm({ endpoint, submitLabel, callbackUrl }: { endpoint: "/api/guest/email/request" | "/api/guest/recover"; submitLabel: string; callbackUrl?: string }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkout = endpoint === "/api/guest/email/request";

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await fetchJson(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkout ? { email, callbackUrl, firstName, lastName } : { email }) });
      setSentTo(email.trim());
    } catch (failure) {
      setError(getClientErrorMessage(failure, "We couldn't send the link. Try again in a few minutes."));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="grid gap-3">
        <h2 className="font-display text-2xl font-semibold text-ink">Check your email</h2>
        <p className="text-ink [overflow-wrap:anywhere]" role="status">
          {checkout ? <>We&apos;ve sent a link to <strong>{sentTo}</strong>. Open it on this device to carry on with your order.</> : <>If {sentTo} has guest purchases, we&apos;ve sent a link for each one.</>}
        </p>
        <p className="text-sm text-ink-soft">
          {checkout ? "It works once and stops working after 30 minutes. Your tickets aren't held yet." : "Each link opens one order and stops working after 24 hours."} Nothing arrived? Check spam or junk.
        </p>
        <button className="inline-flex min-h-11 w-fit items-center font-semibold text-brand underline underline-offset-4" onClick={() => setSentTo("")} type="button">Use a different email</button>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={send}>
      {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
      {checkout ? (
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <TextInput autoComplete="given-name" label="First name" maxLength={80} onChange={(event) => setFirstName(event.target.value)} required value={firstName} />
          <TextInput autoComplete="family-name" hint="Door staff find your tickets by name." label="Last name" maxLength={80} onChange={(event) => setLastName(event.target.value)} required value={lastName} />
        </div>
      ) : null}
      <TextInput autoComplete="email" hint={checkout ? "We'll email a link to confirm it's yours. Your tickets and receipt go here too." : undefined} label="Email" maxLength={320} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
      <Button disabled={busy} size="lg" type="submit">{busy ? "Sending…" : submitLabel}</Button>
      <p className="text-sm text-ink-soft">
        Have an account? <Link className="font-semibold text-brand underline underline-offset-4" href={checkout && callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}>{checkout ? "Sign in instead" : "Sign in"}</Link>{checkout ? "." : " to see My tickets."}
      </p>
    </form>
  );
}
