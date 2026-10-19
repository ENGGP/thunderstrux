"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { newKey } from "@/lib/client/checkout";

// Refund a paid order or cancel a free one (T28b, orders:refund). Each needs a
// reason and, when staff MFA is on, an authenticator code; a refund also needs
// the order's short reference typed back.
export function MerchandiseMoneyActions({
  orgSlug,
  orderId,
  buyer,
  action,
  amount,
  reference,
  needsCode
}: {
  orgSlug: string;
  orderId: string;
  buyer: string;
  action: "refund" | "cancel";
  amount: string;
  reference: string;
  needsCode: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: "", confirmation: "", mfaCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refund = action === "refund";

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orgs/${orgSlug}/merchandise/orders/${orderId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: form.reason, ...(refund ? { confirmation: form.confirmation } : {}), ...(needsCode ? { mfaCode: form.mfaCode } : {}) })
      });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setOpen(false);
      setError(getClientErrorMessage(failure, refund ? "Nothing was refunded and the order is unchanged." : "Nothing changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <Button disabled={busy} onClick={() => setOpen(true)} type="button" variant="danger">
          {refund ? "Refund whole order" : "Cancel free order"}
        </Button>
      </div>
      {error ? (
        <Notice role="alert" title={refund ? "Couldn't refund" : "Couldn't cancel"} tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel="Keep order"
        confirmLabel={refund ? `Refund ${amount}` : "Cancel order"}
        destructive
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
        open={open}
        title={refund ? `Refund ${amount} to ${buyer}?` : `Cancel ${buyer}'s free order?`}
      >
        <ul className="grid list-disc gap-1 pl-5">
          {refund ? (
            <>
              <li>Stripe returns {amount} to the card {buyer} paid with. Banks usually take 5 to 10 business days.</li>
              <li>If it hasn&apos;t been collected, the pickup is cancelled and {buyer} can&apos;t collect it.</li>
              <li>It doesn&apos;t record a return. If items come back, record the return separately.</li>
              <li>{buyer} is emailed once Stripe confirms the refund.</li>
            </>
          ) : (
            <>
              <li>The pickup is cancelled and {buyer} is emailed.</li>
              <li>Nothing was charged, so there&apos;s nothing to refund.</li>
              <li>Stock isn&apos;t put back automatically. Record a return if the item comes back.</li>
            </>
          )}
        </ul>
        <div className="mt-3 grid gap-3">
          <TextArea
            hint="Kept in the order history. 8 to 500 characters."
            label="Reason"
            maxLength={500}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
            rows={3}
            value={form.reason}
          />
          {refund ? <TextInput label={`Type ${reference} to confirm`} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} value={form.confirmation} /> : null}
          {needsCode ? (
            <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setForm({ ...form, mfaCode: event.target.value })} value={form.mfaCode} />
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}

type ReturnLine = { id: string; label: string; bought: number; returned: number; remaining: number | null };

// Record items handed back (T28b, merchandise:fulfil): never a refund. One key
// per return being recorded, so a double click or lost answer records it once.
export function RecordReturn({ orgSlug, orderId, reference, lines }: { orgSlug: string; orderId: string; reference: string; lines: ReturnLine[] }) {
  const router = useRouter();
  const open = lines.filter((line) => line.bought > line.returned);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ lineId: open[0]?.id ?? "", quantity: "1", reason: "", restock: "no" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const line = open.find((item) => item.id === form.lineId) ?? open[0];
  if (!line) return null;

  async function confirm() {
    setBusy(true);
    setError("");
    const operationKey = key ?? newKey();
    setKey(operationKey);
    try {
      await fetchJson(`/api/orgs/${orgSlug}/merchandise/orders/${orderId}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id, quantity: Number(form.quantity), restock: form.restock === "yes", reason: form.reason, operationKey })
      });
      setShow(false);
      setKey(null);
      setForm({ ...form, quantity: "1", reason: "", restock: "no" });
      router.refresh();
    } catch (failure) {
      setShow(false);
      setKey(null);
      setError(getClientErrorMessage(failure, "The return wasn't recorded."));
    } finally {
      setBusy(false);
    }
  }

  const quantity = Number(form.quantity) || 1;
  return (
    <div className="grid gap-3">
      <div>
        <Button onClick={() => setShow(true)} type="button" variant="secondary">
          Record a return
        </Button>
      </div>
      {error ? (
        <Notice role="alert" title="Return not recorded" tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}
      <ConfirmDialog busy={busy} confirmLabel="Record return" onCancel={() => setShow(false)} onConfirm={confirm} open={show} title={`Record a return for order ${reference}`}>
        <p>For items someone handed back. This doesn&apos;t refund anything.</p>
        <div className="mt-3 grid gap-3">
          <Select label="Item" onChange={(event) => setForm({ ...form, lineId: event.target.value })} value={line.id}>
            {open.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ({item.bought} bought, {item.returned} returned)
              </option>
            ))}
          </Select>
          <TextInput className="w-28" inputMode="numeric" label="How many came back" max={line.bought - line.returned} min={1} onChange={(event) => setForm({ ...form, quantity: event.target.value })} type="number" value={form.quantity} />
          <TextArea label="Reason" maxLength={500} onChange={(event) => setForm({ ...form, reason: event.target.value })} rows={2} value={form.reason} />
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-semibold text-ink">Stock</legend>
            {(["yes", "no"] as const).map((value) => (
              <label className="flex items-start gap-2.5 text-[15px] text-ink" key={value}>
                <input checked={form.restock === value} className="mt-1 size-5 accent-brand" name="restock" onChange={() => setForm({ ...form, restock: value })} type="radio" value={value} />
                {value === "yes"
                  ? `Put it back in stock${line.remaining === null ? "" : ` (${line.label} goes from ${line.remaining} to ${line.remaining + quantity} left)`}`
                  : "Don't restock, it can't be sold again"}
              </label>
            ))}
          </fieldset>
        </div>
      </ConfirmDialog>
    </div>
  );
}
