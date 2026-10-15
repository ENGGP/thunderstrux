"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientApiError, fetchWithCsrf, getClientErrorMessage } from "@/lib/client/api";
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
  version: number;
  compensationRefundMode: "manual_review" | "automatic_full";
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
  basePath,
  eventId,
  initialEvent,
  mode = "create",
  orgSlug
}: {
  basePath?: string;
  eventId?: string;
  initialEvent?: EventFormData;
  mode?: EventFormMode;
  orgSlug: string;
}) {
  const dashboardBasePath = basePath ?? `/dashboard/${orgSlug}`;
  const router = useRouter();
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeFormState[]>([
    emptyTicketType
  ]);
  const [compensationRefundMode, setCompensationRefundMode] = useState<
    "manual_review" | "automatic_full"
  >("manual_review");
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
            setCompensationRefundMode(initialEvent.compensationRefundMode);
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
        compensationRefundMode,
        // The version this form loaded; the server refuses the save if the event changed since.
        ...(mode === "edit" && initialEvent ? { version: initialEvent.version } : {}),
        ticketTypes: normaliseTicketTypes(ticketTypes)
      };
      const url = mode === "edit" && eventId ? `/api/events/${eventId}` : "/api/events";
      const method = mode === "edit" && eventId ? "PATCH" : "POST";

      const response = await fetchWithCsrf(url, {
        method,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();

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
        router.push(`${dashboardBasePath}/events`);
      }, 700);
    } catch (error) {
      const details =
        error instanceof ClientApiError ? error.payload?.error?.details : undefined;
      setErrors(
        details?.length
          ? details
          : [
              {
                message: getClientErrorMessage(
                  error,
                  mode === "edit"
                    ? "Unable to update event. Please try again."
                    : "Unable to create event. Please try again."
                )
              }
            ]
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Notice role="alert" tone="danger">
        {loadError}
      </Notice>
    );
  }

  if (!organisation) {
    return (
      <Card>
        <p className="sr-only">Loading event form</p>
        <div className="grid max-w-2xl gap-5">
          <Skeleton className="h-11" />
          <Skeleton className="h-28" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
          <Skeleton className="h-11" />
        </div>
      </Card>
    );
  }

  const formError = errors.find((error) => !error.path?.length)?.message;

  return (
    <form className="grid gap-6" onSubmit={onSubmit}>
      {formError ? (
        <Notice role="alert" tone="danger">
          {formError}
        </Notice>
      ) : null}

      {successMessage ? (
        <Notice role="status" tone="success">
          {successMessage}
        </Notice>
      ) : null}

      <Card>
        <div className="grid max-w-2xl gap-5">
          <h2 className="text-lg font-semibold text-ink">Details</h2>
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
        </div>
      </Card>

      <Card>
        <div className="grid gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Ticket types</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {mode === "edit"
                ? "Quantity is how many are still available."
                : "An event needs at least one ticket type before it can be published."}
            </p>
          </div>

          {ticketTypes.map((ticketType, index) => {
            const isLocked = hasIssuedOrSoldTickets(ticketType);

            return (
              <div
                className="grid gap-3 border-t border-line pt-4"
                key={ticketType.id ?? index}
              >
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_10rem_auto] sm:items-start">
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
                    hint="1500 is $15.00"
                    inputMode="numeric"
                    label="Price in cents"
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
                    inputMode="numeric"
                    label={mode === "edit" ? "Quantity left" : "Quantity"}
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
                  <Button
                    className="sm:mt-[26px]"
                    disabled={isLocked}
                    onClick={() =>
                      setTicketTypes((current) =>
                        current.filter((_item, itemIndex) => itemIndex !== index)
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    Remove
                  </Button>
                </div>
                {isLocked ? (
                  <p className="text-sm text-ink-soft">
                    Has sales or issued tickets, so it cannot be removed. You can
                    still change its name, price and quantity for future purchases.
                  </p>
                ) : null}
              </div>
            );
          })}

          <div>
            <Button
              onClick={() =>
                setTicketTypes((current) => [...current, { ...emptyTicketType }])
              }
              type="button"
              variant="secondary"
            >
              Add ticket type
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid max-w-2xl gap-3">
          <h2 className="text-lg font-semibold text-ink">If tickets cannot be issued</h2>
          <Select
            hint="For example, if the event sold out while the buyer was paying. Each new order keeps the policy it was made under."
            label="When a payment arrives but tickets cannot be issued"
            onChange={(event) =>
              setCompensationRefundMode(
                event.target.value as "manual_review" | "automatic_full"
              )
            }
            value={compensationRefundMode}
          >
            <option value="manual_review">Review it manually</option>
            <option value="automatic_full">Refund the buyer automatically in full</option>
          </Select>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={isSubmitting || Boolean(successMessage)} size="lg" type="submit">
          {isSubmitting
            ? mode === "edit"
              ? "Saving..."
              : "Creating..."
            : mode === "edit"
              ? "Save changes"
              : "Create event"}
        </Button>
        <Link
          className={buttonClasses({ variant: "tertiary" })}
          href={mode === "edit" && eventId ? `${dashboardBasePath}/events/${eventId}` : `${dashboardBasePath}/events`}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
