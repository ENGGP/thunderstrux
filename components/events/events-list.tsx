"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  fetchOrganisationBySlug,
  type Organisation
} from "@/lib/client/orgs";
import { fetchJson } from "@/lib/client/api";

type EventListItem = {
  id: string;
  organisationId: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  location: string;
  status: "draft" | "published";
  ticketTypes?: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; organisation: Organisation; events: EventListItem[] };

function formatTicketSummary(event: EventListItem) {
  const ticketCount = event.ticketTypes?.length ?? 0;

  if (ticketCount === 0) {
    return "No tickets available";
  }

  return `${ticketCount} ticket ${ticketCount === 1 ? "type" : "types"}`;
}

function totalTicketQuantity(event: EventListItem) {
  return (event.ticketTypes ?? []).reduce(
    (total, ticketType) => total + ticketType.quantity,
    0
  );
}

function publishDisabledReason(event: EventListItem) {
  if ((event.ticketTypes?.length ?? 0) === 0) {
    return "Add at least one ticket type before publishing.";
  }

  if (totalTicketQuantity(event) <= 0) {
    return "Total ticket quantity must be greater than zero.";
  }

  return null;
}

export function EventsList({
  basePath,
  orgSlug
}: {
  basePath?: string;
  orgSlug: string;
}) {
  const dashboardBasePath = basePath ?? `/dashboard/${orgSlug}`;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [actionMessage, setActionMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<EventListItem | null>(null);
  const [statusEventId, setStatusEventId] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadEvents() {
      try {
        const organisation = await fetchOrganisationBySlug(orgSlug);
        const eventsData = await fetchJson<{ events: EventListItem[] }>(
          `/api/events?orgId=${organisation.id}`
        );

        if (isActive) {
          setState({
            status: "loaded",
            organisation,
            events: eventsData.events
          });
        }
      } catch (error) {
        if (isActive) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load events"
          });
        }
      }
    }

    loadEvents();

    return () => {
      isActive = false;
    };
  }, [orgSlug]);

  async function deleteEvent(event: EventListItem) {
    if (state.status !== "loaded") {
      return;
    }

    setActionMessage(null);
    setDeleteEventId(event.id);

    try {
      await fetchJson<{ deleted: boolean }>(`/api/events/${event.id}`, {
        method: "DELETE"
      });

      setState({
        ...state,
        events: state.events.filter((item) => item.id !== event.id)
      });
    } catch (error) {
      setActionMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to delete event. Please try again."
      });
    } finally {
      setDeleteEventId(null);
      setConfirmingDelete(null);
    }
  }

  async function togglePublishStatus(event: EventListItem) {
    if (state.status !== "loaded") {
      return;
    }

    const disabledReason =
      event.status === "draft" ? publishDisabledReason(event) : null;

    if (disabledReason) {
      setActionMessage({ tone: "error", text: disabledReason });
      return;
    }

    setActionMessage(null);
    setStatusEventId(event.id);

    try {
      const data = await fetchJson<{ event: EventListItem }>(
        `/api/events/${event.id}/publish`,
        {
          method: "PATCH"
        }
      );

      setState({
        ...state,
        events: state.events.map((item) =>
          item.id === event.id ? data.event : item
        )
      });
      setActionMessage({
        tone: "success",
        text:
          data.event.status === "published"
            ? "Event published and visible publicly."
            : "Event unpublished and hidden from the public page."
      });
    } catch (error) {
      setActionMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to update event status. Please try again."
      });
    } finally {
      setStatusEventId(null);
    }
  }

  if (state.status === "loading") {
    return <Card>Loading events...</Card>;
  }

  if (state.status === "error") {
    return <Card>{state.message}</Card>;
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Events</h1>
          <p className="text-sm text-ink-muted">{state.organisation.name}</p>
        </div>
        <Link className={buttonClasses()} href={`${dashboardBasePath}/events/new`}>
          New event
        </Link>
      </div>

      {state.events.length === 0 ? (
        <Card>No events have been created yet.</Card>
      ) : (
        <Card>
          {actionMessage ? (
            <div
              className={
                actionMessage.tone === "error"
                  ? "mb-4 rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
                  : "mb-4 rounded-control border border-success bg-success-bg px-3 py-2 text-sm text-success"
              }
            >
              {actionMessage.text}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="py-3 font-medium">Title</th>
                  <th className="py-3 font-medium">Start time</th>
                  <th className="py-3 font-medium">End time</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 font-medium">Tickets</th>
                  <th className="py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.events.map((event) => {
                  const disabledReason = publishDisabledReason(event);

                  return (
                    <tr
                      key={event.id}
                      className="border-b border-line last:border-0"
                    >
                      <td className="py-3 font-medium text-ink">
                        {event.title}
                      </td>
                      <td className="py-3 text-ink-soft">
                        {formatDateTime(event.startTime, { fallback: "Invalid date" })}
                      </td>
                      <td className="py-3 text-ink-soft">
                        {formatDateTime(event.endTime, { fallback: "Invalid date" })}
                      </td>
                      <td className="py-3">
                        <StatusBadge status={event.status} />
                        {event.status === "draft" ? (
                          <p className="mt-2 max-w-44 text-xs text-ink-muted">
                            Event must be published to be visible publicly.
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <span className="text-ink-soft">
                          {formatTicketSummary(event)}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className="rounded-control border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle"
                            href={`${dashboardBasePath}/events/${event.id}`}
                          >
                            View Event
                          </Link>
                          <Link
                            className="rounded-control border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-subtle"
                            href={`${dashboardBasePath}/events/${event.id}/edit`}
                          >
                            Edit
                          </Link>
                          {event.status === "draft" ? (
                            <button
                              className="rounded-control border border-success px-3 py-1.5 text-sm font-medium text-success hover:bg-success-bg disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={
                                statusEventId === event.id ||
                                Boolean(disabledReason)
                              }
                              onClick={() => togglePublishStatus(event)}
                              title={disabledReason ?? undefined}
                              type="button"
                            >
                              {statusEventId === event.id ? "Publishing..." : "Publish"}
                            </button>
                          ) : (
                            <button
                              className="rounded-control border border-warning px-3 py-1.5 text-sm font-medium text-warning hover:bg-warning-bg disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={statusEventId === event.id}
                              onClick={() => togglePublishStatus(event)}
                              type="button"
                            >
                              {statusEventId === event.id
                                ? "Unpublishing..."
                                : "Unpublish"}
                            </button>
                          )}
                          <button
                            className="rounded-control border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={deleteEventId === event.id}
                            onClick={() => setConfirmingDelete(event)}
                            type="button"
                          >
                            {deleteEventId === event.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                        {event.status === "draft" && disabledReason ? (
                          <p className="mt-2 text-xs text-ink-muted">
                            {disabledReason}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ConfirmDialog
        busy={deleteEventId !== null}
        confirmLabel="Delete event"
        destructive
        onCancel={() => setConfirmingDelete(null)}
        onConfirm={() => confirmingDelete && deleteEvent(confirmingDelete)}
        open={confirmingDelete !== null}
        title={`Delete "${confirmingDelete?.title ?? "this event"}"?`}
      >
        This cannot be undone. Events with orders or issued tickets cannot be
        deleted and will report an error instead.
      </ConfirmDialog>
    </div>
  );
}
