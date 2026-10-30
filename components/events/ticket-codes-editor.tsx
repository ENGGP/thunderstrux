"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { MoneyInput, Select, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatDate, parseMoneyInput } from "@/lib/format";
import { nextDay, startOfZonedDay, toZonedInput } from "@/lib/zoned-time";

export type EditorTicketCode = {
  id: string;
  code: string;
  // What it gives, worded on the server ("20% off every ticket", "unlocks Crew").
  gives: string;
  used: number;
  maxUses: number | null;
  endsAt: string | null;
  disabledAt: string | null;
};

type FieldErrors = Record<string, string>;

const linkClass = "text-sm font-semibold text-brand underline underline-offset-4";

// Unambiguous letters and digits, so a code read aloud or off a poster is typed right.
function suggestCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte % alphabet.length]).join("");
}

function fieldErrors(failure: unknown): FieldErrors {
  const details = failure instanceof ClientApiError ? failure.payload?.error?.details ?? [] : [];
  return Object.fromEntries(details.filter((detail) => detail.path?.length).map((detail) => [String(detail.path?.[0]), detail.message]));
}

// A code's last usable day, in the society's zone, as `endsAt` (the next day's start).
const endsAtFor = (day: string, timeZone: string) => (day ? startOfZonedDay(nextDay(day), timeZone)?.toISOString() ?? null : null);
const lastDayOf = (endsAt: string, timeZone: string) => toZonedInput(new Date(new Date(endsAt).getTime() - 60_000), timeZone).slice(0, 10);

function codeState(code: EditorTicketCode) {
  if (code.disabledAt) return "Off";
  if (code.endsAt && new Date(code.endsAt) <= new Date()) return "Ended";
  if (code.maxUses !== null && code.used >= code.maxUses) return "Used up";
  return "On";
}

// Discount, access and comp codes for one event (lib/events/ticket-codes.ts).
// A code's terms never change once made; its limit, last day and on/off can.
export function TicketCodesEditor({
  eventId,
  timeZone,
  ticketTypes,
  codes
}: {
  eventId: string;
  timeZone: string;
  ticketTypes: Array<{ id: string; name: string; hidden: boolean }>;
  codes: EditorTicketCode[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ code: "", ticketTypeId: "", discount: "percent", value: "", maxUses: "", lastDay: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; maxUses: string; lastDay: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const hiddenChosen = ticketTypes.find((type) => type.id === form.ticketTypeId)?.hidden ?? false;

  async function send(key: string, url: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(key);
    setErrors({});
    setMessage(null);
    try {
      await fetchJson(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      router.refresh();
      return true;
    } catch (failure) {
      setErrors(fieldErrors(failure));
      setMessage(getClientErrorMessage(failure, "The code couldn't be saved. Try again."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = form.discount === "percent" ? Number(form.value) : form.discount === "amount" ? parseMoneyInput(form.value) : null;
    if (form.discount !== "none" && (value === null || !Number.isFinite(value))) {
      setErrors({ [form.discount === "percent" ? "percentOff" : "amountOff"]: form.discount === "percent" ? "Enter a whole percent, 1 to 100." : "Enter an amount like 5.00." });
      return;
    }
    const added = await send("add", `/api/events/${eventId}/codes`, "POST", {
      code: form.code,
      ticketTypeId: form.ticketTypeId || null,
      percentOff: form.discount === "percent" ? value : null,
      amountOff: form.discount === "amount" ? value : null,
      maxUses: form.maxUses.trim() ? Number(form.maxUses) : null,
      endsAt: endsAtFor(form.lastDay, timeZone)
    });
    if (added) setForm({ code: "", ticketTypeId: "", discount: "percent", value: "", maxUses: "", lastDay: "" });
  }

  async function copyLink(code: string) {
    await navigator.clipboard?.writeText(`${window.location.origin}/events/${eventId}?code=${encodeURIComponent(code)}`);
    setCopied(code);
  }

  return (
    <Card>
      <div className="grid max-w-2xl gap-5">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-ink" id="codes">Codes</h2>
          <p className="text-sm text-ink-soft">
            A discount code takes money off. An access code shows a hidden ticket type to whoever has it, such as committee,
            performers or a sponsor&apos;s guests; make it 100% off for free comp tickets. Buyers enter a code in the ticket box, or
            open a link with it. Limits count tickets, and a refunded or cancelled ticket gives its use back.
          </p>
        </div>

        {codes.length ? (
          <ul className="grid gap-3">
            {codes.map((code) => {
              const state = codeState(code);
              return (
                <li className="grid gap-2 rounded-control border border-line p-3" key={code.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono font-semibold text-ink">{code.code}</span>
                    <span className={`text-sm font-semibold ${state === "On" ? "text-success" : "text-ink-soft"}`}>{state}</span>
                  </div>
                  <p className="text-sm text-ink-soft">
                    {code.gives[0].toUpperCase() + code.gives.slice(1)} · {code.maxUses === null ? `${code.used} ${code.used === 1 ? "ticket" : "tickets"} used` : `${code.used} of ${code.maxUses} tickets used`}
                    {code.endsAt ? ` · last day ${formatDate(new Date(new Date(code.endsAt).getTime() - 60_000), timeZone)}` : ""}
                  </p>
                  {editing?.id === code.id ? (
                    <form
                      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const saved = await send(code.id, `/api/events/${eventId}/codes/${code.id}`, "PATCH", {
                          maxUses: editing.maxUses.trim() ? Number(editing.maxUses) : null,
                          endsAt: endsAtFor(editing.lastDay, timeZone)
                        });
                        if (saved) setEditing(null);
                      }}
                    >
                      <TextInput error={errors.maxUses} hint="Blank for no limit" inputMode="numeric" label="Limit (tickets)" min={1} onChange={(event) => setEditing({ ...editing, maxUses: event.target.value })} type="number" value={editing.maxUses} />
                      <DateField error={errors.endsAt} hint="Blank to keep it going" label="Last day" onChange={(lastDay) => setEditing({ ...editing, lastDay })} value={editing.lastDay} />
                      <div className="flex gap-2 sm:mb-6">
                        <Button busy={busy === code.id} busyLabel="Saving…" size="sm" type="submit">Save</Button>
                        <Button onClick={() => setEditing(null)} size="sm" type="button" variant="tertiary">Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <button className={linkClass} onClick={() => copyLink(code.code)} type="button">{copied === code.code ? "Link copied" : "Copy link"}</button>
                      <button
                        className={linkClass}
                        onClick={() => setEditing({ id: code.id, maxUses: code.maxUses === null ? "" : String(code.maxUses), lastDay: code.endsAt ? lastDayOf(code.endsAt, timeZone) : "" })}
                        type="button"
                      >
                        Change limit or last day
                      </button>
                      <button className={linkClass} disabled={busy === code.id} onClick={() => send(code.id, `/api/events/${eventId}/codes/${code.id}`, "PATCH", { disabled: !code.disabledAt })} type="button">
                        {code.disabledAt ? "Turn on" : "Turn off"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        <form className="grid gap-4 border-t border-line pt-4" onSubmit={add}>
          <h3 className="font-semibold text-ink">Add a code</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              autoCapitalize="characters"
              autoComplete="off"
              error={errors.code}
              hint="3 to 30 letters, numbers or dashes. Use a hard-to-guess code for free tickets."
              label="Code"
              maxLength={30}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              value={form.code}
            />
            <Select error={errors.ticketTypeId} label="For" onChange={(event) => setForm({ ...form, ticketTypeId: event.target.value })} value={form.ticketTypeId}>
              <option value="">Every ticket anyone can see</option>
              {ticketTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.hidden ? `${type.name} (hidden: the code unlocks it)` : type.name}</option>
              ))}
            </Select>
            <Select label="Discount" onChange={(event) => setForm({ ...form, discount: event.target.value, value: "" })} value={form.discount}>
              <option value="percent">Percent off</option>
              <option value="amount">Dollars off</option>
              {hiddenChosen ? <option value="none">None: it only unlocks the ticket</option> : null}
            </Select>
            {form.discount === "percent" ? (
              <TextInput error={errors.percentOff} hint="100% off makes it free (a comp)" inputMode="numeric" label="Percent off" max={100} min={1} onChange={(event) => setForm({ ...form, value: event.target.value })} type="number" value={form.value} />
            ) : form.discount === "amount" ? (
              <MoneyInput error={errors.amountOff} label="Dollars off each ticket" onChange={(value) => setForm({ ...form, value })} value={form.value} />
            ) : (
              <div />
            )}
            <TextInput error={errors.maxUses} hint="Tickets, not orders. Blank for no limit." inputMode="numeric" label="Limit (optional)" min={1} onChange={(event) => setForm({ ...form, maxUses: event.target.value })} type="number" value={form.maxUses} />
            <DateField error={errors.endsAt} hint="The code works until the end of this day" label="Last day (optional)" onChange={(lastDay) => setForm({ ...form, lastDay })} value={form.lastDay} />
          </div>
          {message && !Object.keys(errors).length ? (
            <Notice reveal role="alert" tone="danger"><p>{message}</p></Notice>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button busy={busy === "add"} busyLabel="Adding…" disabled={!form.code.trim()} type="submit">Add code</Button>
            <Button onClick={() => setForm({ ...form, code: suggestCode() })} type="button" variant="secondary">Suggest a code</Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
