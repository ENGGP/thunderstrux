"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// The same limit as lib/organisations/enquiries.ts, which checks it again.
const messageLimit = 1200;

// "Contact {society}": the message goes to the society by email and it replies
// to the address given here. The result shows under the button.
export function EnquiryForm({
  society,
  societySlug,
  eventId,
  defaultName,
  defaultEmail
}: {
  society: string;
  societySlug: string;
  eventId?: string;
  defaultName: string;
  defaultEmail: string;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [orderReference, setOrderReference] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await fetchJson(`/api/orgs/${encodeURIComponent(societySlug)}/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, ...(eventId ? { eventId } : {}), ...(orderReference.trim() ? { orderReference } : {}) })
      });
      setResult({ ok: true, text: `Sent. ${society} will reply to ${email.trim()}.` });
      setMessage("");
    } catch (failure) {
      setResult({ ok: false, text: getClientErrorMessage(failure, "We couldn't send your message. Try again in a few minutes.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={send}>
      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <TextInput autoComplete="name" label="Your name" maxLength={80} onChange={(event) => setName(event.target.value)} required value={name} />
        <TextInput autoComplete="email" hint="They reply here." label="Your email" maxLength={320} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
      </div>
      <TextInput
        hint="Optional. The six letters and numbers on your receipt."
        label="Order reference"
        maxLength={12}
        onChange={(event) => setOrderReference(event.target.value)}
        value={orderReference}
      />
      <TextArea
        hint={`${message.length}/${messageLimit}`}
        label="Message"
        maxLength={messageLimit}
        minLength={10}
        onChange={(event) => setMessage(event.target.value)}
        required
        rows={6}
        value={message}
      />
      <Button busy={busy} busyLabel="Sending…" className="w-fit" type="submit">
        Send message
      </Button>
      {result ? (
        <Notice reveal role={result.ok ? "status" : "alert"} tone={result.ok ? "success" : "warning"}>
          <span className="[overflow-wrap:anywhere]">{result.text}</span>
        </Notice>
      ) : null}
    </form>
  );
}
