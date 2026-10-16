"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type MouseEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

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
};

const menuWidth = 288;
const menuItem =
  "flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-control px-3 py-2 text-left text-[15px] font-medium hover:bg-brand-tint disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent";

// Publish, Edit and a "More" menu for one event. The blocker texts come from
// the server read so a disabled action says why; the API still enforces every
// rule. After a change the server page refreshes, so badges and counts follow.
export function EventActions({
  event,
  size = "sm",
  inHeader = false
}: {
  event: ActionEvent;
  size?: "sm" | "md";
  // The event's own header: "Edit event", the public link outside the menu,
  // and back to the list after a delete.
  inHeader?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"unpublish" | "delete" | null>(null);
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
  }

  function choose(action: "unpublish" | "delete") {
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

  const publicLink =
    event.status === "published" ? (
      <Link
        className={inHeader ? "inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-brand underline underline-offset-4" : `${menuItem} text-ink`}
        href={`/events/${event.id}`}
      >
        View public page
      </Link>
    ) : null;

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
      {message ? (
        <p
          className={`max-w-64 text-sm font-medium ${message.ok ? "text-success" : "text-danger"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}

      <div
        className="m-0 rounded-card border border-line bg-surface p-2 shadow-float"
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
              <span className="text-[13px] font-normal text-ink-soft">Stops new orders. The event stays published.</span>
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
                <span className="text-[13px] font-normal text-ink-soft">{event.reopenBlocker}</span>
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
              <span className="text-[13px] font-normal text-ink-soft">{event.unpublishBlocker}</span>
            ) : null}
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
            <span className="text-[13px] font-normal text-ink-soft">{event.deleteBlocker}</span>
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
    </div>
  );
}
