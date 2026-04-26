"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/input";
import { ClientApiError } from "@/lib/client/api";
import {
  fetchOrganisationBySlug,
  type Organisation
} from "@/lib/client/orgs";

type ErrorDetail = {
  path?: string[];
  message: string;
};

type FormState = {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  location: string;
};

type TicketTypeFormState = {
  id?: string;
  name: string;
  price: string;
  quantity: string;
  ordersCount?: number;
  ticketsCount?: number;
};

const initialFormState: FormState = {
  title: "",
  description: "",
  startTime: "",
  endTime: "",
  location: ""
};

const emptyTicketType: TicketTypeFormState = {
  name: "",
  price: "",
  quantity: ""
};

type EventFormMode = "create" | "edit";

type EventFormData = FormState & {
  id: string;
  organisationId: string;
  status: "draft" | "published";
  ticketTypes: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    ordersCount?: number;
    ticketsCount?: number;
  }>;
};

function hasIssuedOrSoldTickets(ticketType: TicketTypeFormState) {
  return (ticketType.ordersCount ?? 0) > 0 || (ticketType.ticketsCount ?? 0) > 0;
}

function fieldError(details: ErrorDetail[], field: keyof FormState) {
  return details.find((detail) => detail.path?.includes(field))?.message;
}

function validateForm(form: FormState): ErrorDetail[] {
  const errors: ErrorDetail[] = [];

  if (!form.title.trim()) {
    errors.push({ path: ["title"], message: "Title is required" });
  }

  if (form.startTime && form.endTime) {
    const startTime = new Date(form.startTime);
    const endTime = new Date(form.endTime);

    if (startTime >= endTime) {
      errors.push({
        path: ["endTime"],
        message: "End time must be after start time"
      });
    }
  }

  return errors;
}

function validateTicketTypes(
  ticketTypes: TicketTypeFormState[],
  mode: EventFormMode
): ErrorDetail[] {
  const errors: ErrorDetail[] = [];

  ticketTypes.forEach((ticketType, index) => {
    const hasAnyValue =
      ticketType.name.trim() || ticketType.price.trim() || ticketType.quantity.trim();

    if (!hasAnyValue) {
      return;
    }

    if (!ticketType.name.trim()) {
      errors.push({
        path: ["ticketTypes", String(index), "name"],
        message: "Ticket name is required"
      });
    }

    const price = Number(ticketType.price);
    const quantity = Number(ticketType.quantity);

    if (!Number.isInteger(price) || price < 0) {
      errors.push({
        path: ["ticketTypes", String(index), "price"],
        message: "Price must be an integer cents value"
      });
    }

    if (!Number.isInteger(quantity) || quantity < 0) {
      errors.push({
        path: ["ticketTypes", String(index), "quantity"],
        message: "Quantity cannot be negative"
      });
    }

    if (mode === "create" && quantity === 0) {
      errors.push({
        path: ["ticketTypes", String(index), "quantity"],
        message: "Quantity must be greater than zero"
      });
    }
  });

  return errors;
}

function ticketTypeFieldError(
  details: ErrorDetail[],
  index: number,
  field: keyof TicketTypeFormState
) {
  return details.find(
    (detail) =>
      detail.path?.[0] === "ticketTypes" &&
      detail.path?.[1] === String(index) &&
      detail.path?.[2] === field
  )?.message;
}

function normaliseTicketTypes(ticketTypes: TicketTypeFormState[]) {
  return ticketTypes
    .filter(
      (ticketType) =>
        ticketType.name.trim() ||
        ticketType.price.trim() ||
        ticketType.quantity.trim()
    )
    .map((ticketType) => ({
      ...(ticketType.id ? { id: ticketType.id } : {}),
      name: ticketType.name,
      price: Number(ticketType.price),
      quantity: Number(ticketType.quantity)
    }));
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

export function CreateEventForm({
  eventId,
  initialEvent,
  mode = "create",
  orgSlug
}: {
  eventId?: string;
  initialEvent?: EventFormData;
  mode?: EventFormMode;
  orgSlug: string;
}) {
  const router = useRouter();
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeFormState[]>([
    emptyTicketType
  ]);
  const [errors, setErrors] = useState<ErrorDetail[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadOrganisation() {
      try {
        const organisation = await fetchOrganisationBySlug(orgSlug);

        if (mode === "edit" && initialEvent) {
          if (initialEvent.organisationId !== organisation.id) {
            throw new Error("Event does not belong to this organisation.");
          }

          if (isActive) {
            setForm({
              title: initialEvent.title,
              description: initialEvent.description,
              startTime: toDateTimeLocal(initialEvent.startTime),
              endTime: toDateTimeLocal(initialEvent.endTime),
              location: initialEvent.location
            });
            setTicketTypes(
              initialEvent.ticketTypes.length > 0
                ? initialEvent.ticketTypes.map((ticketType) => ({
                    id: ticketType.id,
                    name: ticketType.name,
                    price: String(ticketType.price),
                    quantity: String(ticketType.quantity),
                    ordersCount: ticketType.ordersCount,
                    ticketsCount: ticketType.ticketsCount
                  }))
                : [{ ...emptyTicketType }]
            );
          }
        }

        if (isActive) {
          setOrganisation(organisation);
        }
      } catch (error) {
        if (isActive) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load event."
          );
        }
      }
    }

    loadOrganisation();

    return () => {
      isActive = false;
    };
  }, [initialEvent, mode, orgSlug]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organisation) {
      return;
    }

    setIsSubmitting(true);
    setErrors([]);
    setSuccessMessage(null);

    const formData = { ...form, ticketTypes };
    console.log("FORM SUBMIT DATA:", formData);

    const clientErrors = [
      ...validateForm(form),
      ...validateTicketTypes(ticketTypes, mode)
    ];

    if (clientErrors.length > 0) {
      setErrors(clientErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      const payload = {
        organisationId: organisation.id,
        title: form.title,
        description: form.description,
        startTime: form.startTime,
        endTime: form.endTime,
        location: form.location,
        ticketTypes: normaliseTicketTypes(ticketTypes)
      };
      const url = mode === "edit" && eventId ? `/api/events/${eventId}` : "/api/events";
      const method = mode === "edit" && eventId ? "PATCH" : "POST";

      console.log("PATCH PAYLOAD:", payload);

      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(errorText);

        let payload: unknown = null;
        try {
          payload = JSON.parse(errorText);
        } catch {
          payload = null;
        }

        throw new ClientApiError(
          "Request failed. Please try again.",
          response.status,
          payload && typeof payload === "object" ? payload : null
        );
      }

      await response.json();

      setSuccessMessage(
        mode === "edit" ? "Event updated. Redirecting..." : "Event created. Redirecting..."
      );
      router.refresh();
      setTimeout(() => {
        router.push(`/dashboard/${orgSlug}/events`);
      }, 700);
    } catch (error) {
      const details =
        error instanceof ClientApiError ? error.payload?.error?.details : undefined;
      setErrors(
        details?.length
          ? details
          : [
              {
                message:
                  mode === "edit"
                    ? "Unable to update event"
                    : "Unable to create event"
              }
            ]
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return <Card>{loadError}</Card>;
  }

  if (!organisation) {
    return <Card>Loading organisation...</Card>;
  }

  return (
    <Card>
      <form className="grid max-w-2xl gap-5" onSubmit={onSubmit}>
        <div>
          <h2 className="text-2xl font-semibold text-neutral-950">
            {mode === "edit" ? "Edit event" : "New event"}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">{organisation.name}</p>
        </div>

        {errors.some((error) => !error.path?.length) ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.find((error) => !error.path?.length)?.message}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {successMessage}
          </div>
        ) : null}

        <TextInput
          label="Title"
          value={form.title}
          error={fieldError(errors, "title")}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
        <TextArea
          label="Description"
          value={form.description}
          error={fieldError(errors, "description")}
          onChange={(event) =>
            setForm({ ...form, description: event.target.value })
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Start time"
            type="datetime-local"
            value={form.startTime}
            error={fieldError(errors, "startTime")}
            onChange={(event) =>
              setForm({ ...form, startTime: event.target.value })
            }
          />
          <TextInput
            label="End time"
            type="datetime-local"
            value={form.endTime}
            error={fieldError(errors, "endTime")}
            onChange={(event) => setForm({ ...form, endTime: event.target.value })}
          />
        </div>
        <TextInput
          label="Location"
          value={form.location}
          error={fieldError(errors, "location")}
          onChange={(event) => setForm({ ...form, location: event.target.value })}
        />
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-neutral-950">
                Ticket types
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                Add, edit, or remove ticket types for this event.
              </p>
            </div>
            <button
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
              onClick={() =>
                setTicketTypes((current) => [...current, { ...emptyTicketType }])
              }
              type="button"
            >
              Add ticket type
            </button>
          </div>

          {ticketTypes.map((ticketType, index) => {
            const isLocked = hasIssuedOrSoldTickets(ticketType);

            return (
              <div
                className="grid gap-3 rounded-md border border-neutral-200 p-4"
                key={ticketType.id ?? index}
              >
                <div className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-start">
                  <TextInput
                    label="Name"
                    value={ticketType.name}
                    error={ticketTypeFieldError(errors, index, "name")}
                    onChange={(event) =>
                      setTicketTypes((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, name: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                  <TextInput
                    label="Price"
                    type="number"
                    value={ticketType.price}
                    error={ticketTypeFieldError(errors, index, "price")}
                    onChange={(event) =>
                      setTicketTypes((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, price: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                  <TextInput
                    label="Quantity"
                    type="number"
                    value={ticketType.quantity}
                    error={ticketTypeFieldError(errors, index, "quantity")}
                    onChange={(event) =>
                      setTicketTypes((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, quantity: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                  <button
                    className="h-10 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-6"
                    disabled={isLocked}
                    onClick={() =>
                      setTicketTypes((current) =>
                        current.filter((_item, itemIndex) => itemIndex !== index)
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
                {isLocked ? (
                  <p className="text-sm text-neutral-500">
                    This ticket type has existing orders or issued tickets, so
                    it cannot be removed. You can still update its name, price,
                    and quantity for future purchases.
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
        <div>
          <Button disabled={isSubmitting || Boolean(successMessage)} type="submit">
            {isSubmitting
              ? mode === "edit"
                ? "Saving..."
                : "Creating..."
              : mode === "edit"
                ? "Save event"
                : "Create event"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
