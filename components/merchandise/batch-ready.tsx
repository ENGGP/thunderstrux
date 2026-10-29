"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type Selected = { orderId: string; expectedVersion: number; reference: string };
type Outcome = { marked: Array<{ reference: string }>; skipped: Array<{ reference: string; message: string }> };

// The row checkbox for the To prepare tab: the server table renders one in the
// table row and one on the phone card, both tied to the form below by `form`.
export function SelectPickup({ order }: { order: { id: string; version: number; reference: string } }) {
  return (
    <input
      aria-label={`Select order ${order.reference}`}
      className="size-5 accent-brand"
      data-reference={order.reference}
      form="batch-ready"
      name="order"
      type="checkbox"
      value={`${order.id}:${order.version}`}
    />
  );
}

// Select orders on the To prepare tab and mark them ready together (UI-018).
// Each order is marked on its own, with one email per buyer; any someone else
// moved first are named under the button.
export function BatchReady({ orgSlug, count }: { orgSlug: string; count: number }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; skipped?: Outcome["skipped"] } | null>(null);

  const boxes = useCallback(() => [...(form.current?.elements ?? [])].filter((element): element is HTMLInputElement => element instanceof HTMLInputElement && element.name === "order"), []);
  const read = useCallback(() => {
    const unique = new Map<string, Selected>();
    for (const box of boxes()) {
      if (!box.checked) continue;
      const [orderId, version] = box.value.split(":");
      unique.set(orderId, { orderId, expectedVersion: Number(version), reference: box.dataset.reference ?? "" });
    }
    setSelected([...unique.values()]);
  }, [boxes]);

  useEffect(() => {
    function onChange(event: Event) {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || box.name !== "order" || box.form !== form.current) return;
      // The table row and the phone card each hold a box for the same order.
      for (const twin of boxes()) if (twin.value === box.value) twin.checked = box.checked;
      read();
    }
    document.addEventListener("change", onChange);
    read();
    return () => document.removeEventListener("change", onChange);
  }, [boxes, read, count]);

  function selectAll(on: boolean) {
    for (const box of boxes()) box.checked = on;
    read();
  }

  async function confirm() {
    setBusy(true);
    setResult(null);
    try {
      const { pickups } = await fetchJson<{ pickups: Outcome }>(`/api/orgs/${orgSlug}/merchandise/pickups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: selected.map(({ orderId, expectedVersion }) => ({ orderId, expectedVersion })) })
      });
      const marked = pickups.marked.length;
      setResult({
        ok: pickups.skipped.length === 0,
        text: marked
          ? `${marked === 1 ? "1 order" : `${marked} orders`} marked ready. ${marked === 1 ? "The buyer was" : "Each buyer was"} emailed.${pickups.skipped.length ? " Not marked:" : ""}`
          : "None of these were marked:",
        skipped: pickups.skipped
      });
      selectAll(false);
      router.refresh();
    } catch (failure) {
      setResult({ ok: false, text: getClientErrorMessage(failure, "Those orders weren't marked. Nothing changed.") });
    } finally {
      setOpen(false);
      setBusy(false);
    }
  }

  const all = selected.length > 0 && selected.length === count;
  const orders = selected.length === 1 ? "1 order" : `${selected.length} orders`;
  return (
    <>
      <form
        className="grid gap-3"
        id="batch-ready"
        onSubmit={(event) => {
          event.preventDefault();
          if (selected.length) setOpen(true);
        }}
        ref={form}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
            <input checked={all} className="size-5 accent-brand" onChange={(event) => selectAll(event.target.checked)} type="checkbox" />
            Select all on this page
          </label>
          <Button disabled={selected.length === 0} type="submit">
            {selected.length ? `Mark ${orders} ready` : "Mark selected ready"}
          </Button>
        </div>
        {result ? (
          <Notice reveal role={result.ok ? "status" : "alert"} tone={result.ok ? "success" : "warning"}>
            <p>{result.text}</p>
            {result.skipped?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.map((entry) => <li key={entry.reference}>Order {entry.reference}: {entry.message}</li>)}
              </ul>
            ) : null}
          </Notice>
        ) : null}
      </form>
      {/* Outside the form, so the dialog's buttons never submit it. */}
      <ConfirmDialog
        busy={busy}
        cancelLabel="Not yet"
        confirmLabel={`Mark ${orders} ready`}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirm()}
        open={open}
        title={`Mark ${orders} ready to collect?`}
      >
        <div className="grid gap-3">
          <p>Check everything is bagged. Each buyer is emailed now that their order is ready, with your pickup details.</p>
          <p className="font-mono text-ui text-ink [overflow-wrap:anywhere]">{selected.map((order) => order.reference).join(", ")}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
