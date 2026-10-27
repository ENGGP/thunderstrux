"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type MouseEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney } from "@/lib/format";

type ActionEvent = {
  id: string;
  title: string;
  status: "draft" | "published";
  version: number;
  saleState: "open" | "closed";
  reopenBlocker: string | null;
  publishBlocker: string | null;
  unpublishBlocker: string | null;
  deleteBlocker: string | null;
  cancelBlocker: string | null;
  cancelledAt: Date | null;
};

type CancelResult = { status: "cancelled" | "already_cancelled"; refundsQueued: number; freeCancelled: number; skipped: unknown[]; releasedEarly: { amount: number; orders: number } };

const menuWidth = 288;
const menuItem =
  "flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-control px-3 py-2 text-left text-ui font-medium hover:bg-brand-tint disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent";

// Publish, Edit and a "More" menu for one event. The blocker texts come from
// the server read so a disabled action says why; the API still enforces every
// rule. After a change the server page refreshes, so badges and counts follow.
export function EventActions({
  event,
  size = "sm",
  inHeader = false,
  cancel = null
}: {
  event: ActionEvent;
  size?: "sm" | "md";
  // Cancel event (EVT-004), offered to staff who may also refund; needsCode
  // asks for an authenticator code unless staff MFA is off.
  cancel?: { needsCode: boolean } | null;
  // The event's own header: "Edit event", the public link outside the menu,
  // and back to the list after a delete.
  inHeader?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"unpublish" | "delete" | "cancel" | null>(null);
  const [cancelForm, setCancelForm] = useState({ reason: "", confirmation: "", mfaCode: "" });
  const [cancelError, setCancelError] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const blockerId = `${id}-blocker`;

  // The menu is a popover in the top layer, so a scrolling table cannot clip
  // it; place it under the button, or above it near the bottom of the screen.
  function placeMenu(click: MouseEvent<HTMLButtonElement>) {
    const box = click.currentTarget.getBoundingClientRect();
    const style = menu.current?.style;

    if (!style) return;
    style.left = `${Math.max(8, Math.min(box.right - menuWidth, window.innerWidth - menuWidth - 8))}px`;
    style.top = box.bottom + 220 > window.innerHeight ? "auto" : `${box.bottom + 4}px`;
    style.bottom = style.top === "auto" ? `${window.innerHeight - box.top + 4}px` : "auto";
    // Grow out of the button, whichever side the menu opens on.
    style.transformOrigin = style.top === "auto" ? "bottom right" : "top right";
    // From the keyboard (Enter or Space give a click with detail 0) the menu opens instantly.
    style.animationName = click.detail === 0 ? "none" : "";
  }

  function choose(action: "unpublish" | "delete" | "cancel") {
    menu.current?.hidePopover();
    setConfirming(action);
  }

  async function run(action: "publish" | "unpublish" | "delete" | "close" | "reopen") {
    menu.current?.hidePopover();
    setBusy(true);
    setMessage(null);

    // An explicit target and the version this page loaded, so a retry or stale page cannot flip it.
    const patch = (body: object) => ({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, version: event.version })
    });

    try {
      await fetchJson(
        action === "delete"
          ? `/api/events/${event.id}`
          : action === "close" || action === "reopen"
            ? `/api/events/${event.id}/sales`
            : `/api/events/${event.id}/publish`,
        action === "delete"
          ? { method: "DELETE" }
          : action === "close" || action === "reopen"
            ? patch({ saleState: action === "close" ? "closed" : "open" })
            : patch({ targetStatus: action === "publish" ? "published" : "draft" })
      );
      setMessage({
        ok: true,
        text:
          action === "publish"
            ? "Published. It is now on the public page."
            : action === "unpublish"
              ? "Unpublished. It is hidden from the public page."
              : action === "close"
                ? "Sales closed. The event stays published."
                : action === "reopen"
                  ? "Sales reopened."
                  : "Event deleted."
      });
      if (action === "delete" && inHeader) router.push("/dashboard/events");
      router.refresh();
    } catch (error) {
      setMessage({
        ok: false,
        text: getClientErrorMessage(error, "Could not update the event. Please try again.")
      });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function cancelEvent() {
    setBusy(true);
    setCancelError("");
    try {
      const result = await fetchJson<CancelResult>(`/api/events/${event.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: cancelForm.reason, confirmation: cancelForm.confirmation, ...(cancel?.needsCode ? { mfaCode: cancelForm.mfaCode } : {}) })
      });
      setConfirming(null);
      setMessage({
        ok: true,
        text: `Event cancelled. ${result.refundsQueued} ${result.refundsQueued === 1 ? "refund" : "refunds"} started and ${result.freeCancelled} free ${result.freeCancelled === 1 ? "registration" : "registrations"} cancelled.${result.skipped.length ? ` ${result.skipped.length} ${result.skipped.length === 1 ? "order needs" : "orders need"} you in Orders.` : ""}${result.releasedEarly.amount > 0 ? ` ${formatMoney(result.releasedEarly.amount)} of these sales had already been released to your bank, so Stripe takes those refunds back from that bank account.` : ""}`
      });
      router.refresh();
    } catch (error) {
      setCancelError(getClientErrorMessage(error, "Could not cancel the event. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const publicLink =
    event.status === "published" ? (
      <Link
        className={inHeader ? "inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-brand underline underline-offset-4" : `${menuItem} text-ink`}
        href={`/events/${event.id}`}
      >
        View public page
      </Link>
    ) : null;
  const status = message ? (
    <p
      className={`max-w-64 text-sm font-medium ${message.ok ? "text-success" : "text-danger"}`}
      role={message.ok ? "status" : "alert"}
    >
      {message.text}
    </p>
  ) : null;

  // A cancelled event changes no more; its public page stays for ticket holders.
  if (event.cancelledAt) {
    return (
      <div className="grid w-fit gap-1.5">
        {inHeader ? publicLink : null}
        {status}
      </div>
    );
  }

  return (
    <div className="grid w-fit gap-1.5">
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        {inHeader ? publicLink : null}
        {event.status === "draft" ? (
          <Button
            aria-describedby={event.publishBlocker ? blockerId : undefined}
            disabled={busy || Boolean(event.publishBlocker)}
            onClick={() => run("publish")}
            size={size}
            type="button"
          >
            {busy ? "Publishing..." : "Publish"}
          </Button>
        ) : null}
        <Link
          className={buttonClasses({ variant: "secondary", size })}
          href={`/dashboard/events/${event.id}/edit`}
        >
          {inHeader ? "Edit event" : "Edit"}
        </Link>
        <Button
          aria-label={`More actions for ${event.title}`}
          onClick={placeMenu}
          popoverTarget={`${id}-menu`}
          size={size}
          type="button"
          variant="secondary"
        >
          More
        </Button>
      </div>
      {event.publishBlocker ? (
        <p className="max-w-64 text-sm text-warning" id={blockerId}>
          {event.publishBlocker}
        </p>
      ) : null}
      {status}

      <div
        className="m-0 animate-pop-in rounded-card border border-line bg-surface p-2 shadow-float"
        id={`${id}-menu`}
        popover="auto"
        ref={menu}
        style={{ width: menuWidth }}
      >
        {inHeader ? null : publicLink}
        {event.status === "published" ? (
          event.saleState === "open" ? (
            <button className={`${menuItem} text-ink`} disabled={busy} onClick={() => run("close")} type="button">
              Close sales
              <span className="text-caption font-normal text-ink-soft">Stops new orders. The event stays published.</span>
            </button>
          ) : (
            <button
              className={`${menuItem} text-ink`}
              disabled={busy || Boolean(event.reopenBlocker)}
              onClick={() => run("reopen")}
              type="button"
            >
              Reopen sales
              {event.reopenBlocker ? (
                <span className="text-caption font-normal text-ink-soft">{event.reopenBlocker}</span>
              ) : null}
            </button>
          )
        ) : null}
        {event.status === "published" ? (
          <button
            className={`${menuItem} text-ink`}
            disabled={Boolean(event.unpublishBlocker)}
            onClick={() => choose("unpublish")}
            type="button"
          >
            Unpublish
            {event.unpublishBlocker ? (
              <span className="text-caption font-normal text-ink-soft">{event.unpublishBlocker}</span>
            ) : null}
          </button>
        ) : null}
        {event.status === "published" && cancel ? (
          <button
            className={`${menuItem} text-danger`}
            disabled={Boolean(event.cancelBlocker)}
            onClick={() => choose("cancel")}
            type="button"
          >
            Cancel event
            <span className="text-caption font-normal text-ink-soft">{event.cancelBlocker ?? "Refunds every order and emails every ticket holder."}</span>
          </button>
        ) : null}
        <button
          className={`${menuItem} text-danger`}
          disabled={Boolean(event.deleteBlocker)}
          onClick={() => choose("delete")}
          type="button"
        >
          Delete event
          {event.deleteBlocker ? (
            <span className="text-caption font-normal text-ink-soft">{event.deleteBlocker}</span>
          ) : null}
        </button>
      </div>

      <ConfirmDialog
        busy={busy}
        confirmLabel="Unpublish"
        onCancel={() => setConfirming(null)}
        onConfirm={() => run("unpublish")}
        open={confirming === "unpublish"}
        title={`Unpublish "${event.title}"?`}
      >
        It leaves the public page and stops selling tickets. You can publish it
        again at any time.
      </ConfirmDialog>
      <ConfirmDialog
        busy={busy}
        confirmLabel="Delete event"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => run("delete")}
        open={confirming === "delete"}
        title={`Delete "${event.title}"?`}
      >
        This cannot be undone. Events with orders or issued tickets cannot be
        deleted and will report an error instead.
      </ConfirmDialog>
      {cancel ? (
        <ConfirmDialog
          busy={busy}
          cancelLabel="Keep event"
          confirmLabel="Cancel event"
          destructive
          onCancel={() => setConfirming(null)}
          onConfirm={cancelEvent}
          open={confirming === "cancel"}
          title={`Cancel "${event.title}"?`}
        >
          <div className="grid gap-3">
            {cancelError ? <Notice role="alert" tone="danger">{cancelError}</Notice> : null}
            <ul className="grid list-disc gap-1 pl-5">
              <li>Ticket sales stop for good and the event leaves Explore. Its page stays up and says it&apos;s cancelled.</li>
              <li>Every paid order is refunded in full, Thunderstrux fee included, from the society&apos;s Stripe balance. Refunds go out over the next few minutes.</li>
              <li>Free registrations are cancelled.</li>
              <li>Every ticket holder is emailed your message.</li>
              <li>Disputed orders are left for you to settle in Orders.</li>
              <li>This can&apos;t be undone.</li>
            </ul>
            <TextArea hint="Emailed to every ticket holder and kept in History. 8 to 500 characters." label="Message to ticket holders" maxLength={500} onChange={(change) => setCancelForm({ ...cancelForm, reason: change.target.value })} rows={3} value={cancelForm.reason} />
            <TextInput autoComplete="off" label={`Type ${event.title} to confirm`} onChange={(change) => setCancelForm({ ...cancelForm, confirmation: change.target.value })} value={cancelForm.confirmation} />
            {cancel.needsCode ? (
              <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(change) => setCancelForm({ ...cancelForm, mfaCode: change.target.value })} value={cancelForm.mfaCode} />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
