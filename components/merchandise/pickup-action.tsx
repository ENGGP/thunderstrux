"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type Order = { id: string; reference: string; buyer: string; version: number; lines: Array<{ quantity: number; nameSnapshot: string; variantSnapshot: string | null }> };

// Mark ready or Mark collected for one pickup (T28a), confirmed first. The
// result is shown by the page from the server (?done=); a step someone else
// took first is a warning here and nothing changes.
export function PickupAction({ orgSlug, order, step, stage, wide = false, after }: { orgSlug: string; order: Order; step: "ready" | "collected"; stage: string; wide?: boolean; after?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = step === "ready";

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orgs/${orgSlug}/merchandise/pickups/${order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, expectedVersion: order.version })
      });
      setOpen(false);
      router.replace(after ?? `/dashboard/merchandise/pickups?stage=${stage}&done=${order.id}`);
      router.refresh();
    } catch (failure) {
      setOpen(false);
      setError(getClientErrorMessage(failure, "That didn't work. Nothing changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`grid gap-2 ${wide ? "" : "justify-items-end"}`}>
      {/* The spoken name starts with the visible words, so voice control finds it (WCAG 2.5.3). */}
      {/* relative keeps the hidden words inside the button, so they can't widen a scrolling table. */}
      <Button className={wide ? "relative w-full" : "relative"} onClick={() => setOpen(true)} size={wide ? "lg" : "sm"} type="button">
        {ready ? "Mark ready" : "Mark collected"}<span className="sr-only"> for order {order.reference}</span>
      </Button>
      {error ? (
        <Notice reveal className="text-left" title={error.includes(" marked order ") ? "Someone got there first" : "Not done"} tone="warning">
          <p className="mt-0.5">{error} Check before handing anything over.</p>
        </Notice>
      ) : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel={ready ? "Not yet" : "Cancel"}
        confirmLabel={ready ? "Mark ready" : "Mark collected"}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirm()}
        open={open}
        title={ready ? `Mark order ${order.reference} ready to collect?` : `Hand over order ${order.reference}?`}
      >
        <div className="grid gap-3">
          {ready ? null : (
            <p className="text-ui text-ink">
              For <strong>{order.buyer}</strong>. Check the name with the person collecting.
            </p>
          )}
          <ul className="grid list-disc gap-1 pl-5 text-ui text-ink">
            {order.lines.map((line, index) => (
              <li key={index}>
                {line.quantity} × {line.nameSnapshot}
                {line.variantSnapshot ? ` · ${line.variantSnapshot}` : ""}
              </li>
            ))}
          </ul>
          <p>{ready ? `Check everything is bagged. ${order.buyer} is emailed now with your pickup details.` : "We record that you handed it over, and when."}</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
