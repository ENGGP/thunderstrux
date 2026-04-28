"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/client/dates";
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

function statusBadgeClassName(status: EventListItem["status"]) {
  return status === "published"
    ? "rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200"
    : "rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200";
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

    const confirmed = window.confirm(
      `Delete "${event.title}"? This cannot be undone.`
    );

    if (!confirmed) {
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
          <h2 className="text-2xl font-semibold text-neutral-950">Events</h2>
          <p className="text-sm text-neutral-500">{state.organisation.name}</p>
        </div>
        <Link
          href={`${dashboardBasePath}/events/new`}
          className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
        >
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
                  ? "mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  : "mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
              }
            >
              {actionMessage.text}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
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
                      className="border-b border-neutral-100 last:border-0"
                    >
                      <td className="py-3 font-medium text-neutral-950">
                        {event.title}
                      </td>
                      <td className="py-3 text-neutral-700">
                        {formatDateTime(event.startTime)}
                      </td>
                      <td className="py-3 text-neutral-700">
                        {formatDateTime(event.endTime)}
                      </td>
                      <td className="py-3">
                        <span className={statusBadgeClassName(event.status)}>
                          {event.status === "published" ? "Published" : "Draft"}
                        </span>
                        {event.status === "draft" ? (
                          <p className="mt-2 max-w-44 text-xs text-neutral-500">
                            Event must be published to be visible publicly.
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <span className="text-neutral-700">
                          {formatTicketSummary(event)}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          {event.status === "published" ? (
                            <Link
                              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                              href={`/events/${event.id}`}
                            >
                              View Event
                            </Link>
                          ) : (
                            <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-400">
                              Preview unavailable
                            </span>
                          )}
                          <Link
                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                            href={`${dashboardBasePath}/events/${event.id}/edit`}
                          >
                            Edit
                          </Link>
                          {event.status === "draft" ? (
                            <button
                              className="rounded-md border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={deleteEventId === event.id}
                            onClick={() => deleteEvent(event)}
                            type="button"
                          >
                            {deleteEventId === event.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                        {event.status === "draft" && disabledReason ? (
                          <p className="mt-2 text-xs text-neutral-500">
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
    </div>
  );
}
