"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";
import { toZonedInput, zoneAbbreviation, zoneCity, zoneLabel, zonedCandidates } from "@/lib/zoned-time";

type ErrorDetail = { path?: string[]; message: string };
type TimeField = "startTime" | "endTime" | "salesCloseAt";
type Visibility = "public" | "unlisted" | "members_only";
type RefundMode = "manual_review" | "automatic_full";

type FormState = {
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  salesCloseAt: string;
  capacity: string;
  visibility: Visibility;
  compensationRefundMode: RefundMode;
  heroAssetId: string | null;
};

type TicketTypeFormState = {
  id?: string;
  name: string;
  price: string;
  quantity: string;
  // Remaining stock when the form loaded; the server keeps sales made since.
  loadedQuantity?: number;
  ordersCount?: number;
  ticketsCount?: number;
  sold?: number;
  held?: number;
};

type EventFormData = {
  id: string;
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  salesCloseAt: string;
  capacity: number | null;
  visibility: Visibility;
  heroAssetId: string | null;
  status: "draft" | "published";
  version: number;
  compensationRefundMode: RefundMode;
  occupancy: number;
  ticketTypes: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    ordersCount: number;
    ticketsCount: number;
    sold: number;
    held: number;
  }>;
};

const emptyTicketType: TicketTypeFormState = { name: "", price: "", quantity: "" };
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageBytes = 5 * 1024 * 1024;
const timeLabels: Record<TimeField, string> = {
  startTime: "Starts",
  endTime: "Ends",
  salesCloseAt: "Ticket sales close"
};

function initialState(event: EventFormData | undefined, timeZone: string) {
  const local = (value: string) => toZonedInput(new Date(value), timeZone);
  const form: FormState = event
    ? {
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: local(event.startTime),
        endTime: local(event.endTime),
        salesCloseAt: local(event.salesCloseAt),
        capacity: event.capacity === null ? "" : String(event.capacity),
        visibility: event.visibility,
        compensationRefundMode: event.compensationRefundMode,
        heroAssetId: event.heroAssetId
      }
    : {
        title: "",
        description: "",
        location: "",
        startTime: "",
        endTime: "",
        salesCloseAt: "",
        capacity: "",
        visibility: "public",
        compensationRefundMode: "manual_review",
        heroAssetId: null
      };
  // In a daylight-saving overlap, keep whichever of the two instants was saved.
  const choices = Object.fromEntries(
    (["startTime", "endTime", "salesCloseAt"] as const).map((field) => [
      field,
      event
        ? Math.max(0, zonedCandidates(form[field], timeZone).findIndex((date) => date.getTime() === new Date(event[field]).getTime()))
        : 0
    ])
  ) as Record<TimeField, number>;
  const ticketTypes: TicketTypeFormState[] = event?.ticketTypes.length
    ? event.ticketTypes.map((ticketType) => ({
        id: ticketType.id,
        name: ticketType.name,
        price: formatMoneyInput(ticketType.price),
        quantity: String(ticketType.quantity),
        loadedQuantity: ticketType.quantity,
        ordersCount: ticketType.ordersCount,
        ticketsCount: ticketType.ticketsCount,
        sold: ticketType.sold,
        held: ticketType.held
      }))
    : [{ ...emptyTicketType }];

  return {
    form,
    choices,
    ticketTypes,
    // A close time equal to the start is the default and moves with it.
    closeFollowsStart: !event || event.salesCloseAt === event.startTime
  };
}

function errorFor(errors: ErrorDetail[], ...path: string[]) {
  return errors.find((error) => path.every((part, index) => error.path?.[index] === part))?.message;
}

function hasSales(ticketType: TicketTypeFormState) {
  return (ticketType.ordersCount ?? 0) > 0 || (ticketType.ticketsCount ?? 0) > 0;
}

export function CreateEventForm({
  aside,
  eventId,
  initialEvent,
  mode = "create",
  organisationId,
  orgSlug,
  timeZone
}: {
  // The readiness panel on the Edit page.
  aside?: ReactNode;
  eventId?: string;
  initialEvent?: EventFormData;
  mode?: "create" | "edit";
  organisationId: string;
  orgSlug: string;
  timeZone: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState(() => initialState(initialEvent, timeZone));
  const [errors, setErrors] = useState<ErrorDetail[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; title: string; text: string; reload?: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const { form, choices, ticketTypes, closeFollowsStart } = state;
  const salesCloseValue = closeFollowsStart ? form.startTime : form.salesCloseAt;

  // A save refreshes the page with the new version: show what was saved.
  useEffect(() => {
    if (initialEvent) setState(initialState(initialEvent, timeZone));
  }, [initialEvent, timeZone]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(update: Partial<typeof state>) {
    setState((current) => ({ ...current, ...update }));
    setDirty(true);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    change({ form: { ...form, [key]: value } });
  }

  function setTicketType(index: number, update: Partial<TicketTypeFormState>) {
    change({ ticketTypes: ticketTypes.map((item, itemIndex) => (itemIndex === index ? { ...item, ...update } : item)) });
  }

  function resolveTime(field: TimeField) {
    const value = field === "salesCloseAt" ? salesCloseValue : form[field];
    const candidates = zonedCandidates(value, timeZone);
    return { value, candidates, date: candidates[Math.min(choices[field], candidates.length - 1)] as Date | undefined };
  }

  async function chooseImage(file?: File) {
    if (!file) return;
    if (!imageTypes.includes(file.type)) return setUpload({ busy: false, error: "Use a JPG, PNG or WebP image." });
    if (file.size > maxImageBytes) return setUpload({ busy: false, error: "That image is larger than 5 MB. Choose a smaller one." });

    setUpload({ busy: true });
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetchJson<{ asset: { id: string } }>(`/api/orgs/${orgSlug}/assets?kind=event`, { method: "POST", body });
      setField("heroAssetId", response.asset.id);
      setUpload({ busy: false });
    } catch (error) {
      setUpload({ busy: false, error: getClientErrorMessage(error, "The image could not be uploaded. Try again.") });
    }
  }

  function validate() {
    const found: ErrorDetail[] = [];
    const add = (path: string[], message: string) => found.push({ path, message });

    if (!form.title.trim()) add(["title"], "Add a title.");
    if (!form.description.trim()) add(["description"], "Add a description.");
    if (!form.location.trim()) add(["location"], "Add a location.");

    const times = Object.fromEntries(
      (["startTime", "endTime", "salesCloseAt"] as const).map((field) => {
        const { value, candidates, date } = resolveTime(field);
        if (!value) add([field], "Choose a date and time.");
        else if (candidates.length === 0)
          add([field], `That time doesn't exist in ${zoneCity(timeZone)}: clocks go forward an hour. Choose another time.`);
        return [field, date];
      })
    ) as Record<TimeField, Date | undefined>;

    if (times.startTime && times.endTime && times.endTime <= times.startTime) add(["endTime"], "The event must end after it starts.");
    if (times.endTime && times.salesCloseAt && times.salesCloseAt > times.endTime) add(["salesCloseAt"], "Ticket sales must close before the event ends.");

    const capacity = form.capacity.trim();
    if (capacity && !/^\d+$/.test(capacity)) add(["capacity"], "Enter a whole number, or leave it blank for no limit.");
    else if (capacity && Number(capacity) < Math.max(1, initialEvent?.occupancy ?? 0))
      add(["capacity"], initialEvent?.occupancy ? `Capacity can't be below the ${initialEvent.occupancy} tickets already issued or held.` : "Capacity must be at least 1.");

    ticketTypes.forEach((ticketType, index) => {
      const at = (field: string) => ["ticketTypes", String(index), field];
      if (!ticketType.id && !ticketType.name.trim() && !ticketType.price.trim() && !ticketType.quantity.trim()) return;
      if (!ticketType.name.trim()) add(at("name"), "Add a ticket name.");
      if (parseMoneyInput(ticketType.price) === null) add(at("price"), "Enter a price in dollars, like 15.00. Use 0 for free.");
      const quantity = ticketType.quantity.trim();
      if (!/^\d+$/.test(quantity)) add(at("quantity"), "Enter a whole number.");
      else if (!ticketType.id && Number(quantity) === 0) add(at("quantity"), "Quantity must be at least 1.");
      else if (Number(quantity) < (ticketType.held ?? 0)) add(at("quantity"), `Keep at least ${ticketType.held} left: they are held in checkouts now.`);
    });

    return { found, times };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { found, times } = validate();
    setNotice(null);
    setErrors(found);

    if (found.length > 0) {
      setNotice({ tone: "danger", title: "Some details need fixing", text: `Nothing was saved. Fix the ${found.length === 1 ? "field" : `${found.length} fields`} marked below.` });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        organisationId,
        title: form.title,
        description: form.description,
        location: form.location,
        startTime: times.startTime?.toISOString(),
        endTime: times.endTime?.toISOString(),
        salesCloseAt: times.salesCloseAt?.toISOString(),
        capacity: form.capacity.trim() ? Number(form.capacity) : null,
        visibility: form.visibility,
        heroAssetId: form.heroAssetId,
        compensationRefundMode: form.compensationRefundMode,
        // The version this form loaded; the server refuses the save if the event changed since.
        ...(mode === "edit" && initialEvent ? { version: initialEvent.version } : {}),
        ticketTypes: ticketTypes
          .filter((ticketType) => ticketType.id || ticketType.name.trim() || ticketType.price.trim() || ticketType.quantity.trim())
          .map((ticketType) => ({
            ...(ticketType.id ? { id: ticketType.id, expectedQuantity: ticketType.loadedQuantity } : {}),
            name: ticketType.name,
            price: parseMoneyInput(ticketType.price),
            quantity: Number(ticketType.quantity)
          }))
      };
      const response = await fetchJson<{ event: { id: string } }>(mode === "edit" && eventId ? `/api/events/${eventId}` : "/api/events", {
        method: mode === "edit" && eventId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      setDirty(false);
      if (mode === "create") {
        router.push(`/dashboard/events/${response.event.id}`);
        return;
      }
      setNotice({
        tone: "success",
        title: "Event saved",
        text: initialEvent?.status === "published" ? "The public page shows your changes now." : "It stays a draft until you publish it."
      });
      router.refresh();
    } catch (error) {
      const details = error instanceof ClientApiError ? error.payload?.error?.details ?? [] : [];
      const message = getClientErrorMessage(error, "The event could not be saved. Please try again.");

      if (error instanceof ClientApiError && error.status === 409) {
        setNotice(
          message.startsWith("Ticket stock changed")
            ? { tone: "warning", title: "Ticket stock changed while you were editing", text: "Tickets sold since you opened this page, so a quantity you typed may be out of date. Reload to see the latest numbers.", reload: "Reload latest numbers" }
            : { tone: "danger", title: "This event changed since you opened it", text: "Your edits are still below and have not been saved. Reload to see the latest version, then make your changes again.", reload: "Reload latest version" }
        );
      } else if (details.some((detail) => detail.path?.length)) {
        setErrors(details);
        setNotice({ tone: "danger", title: "Some details need fixing", text: `Nothing was saved. Fix the ${details.length === 1 ? "field" : `${details.length} fields`} marked below.` });
      } else {
        setNotice({ tone: "danger", title: "Not saved", text: message });
      }
    } finally {
      setSaving(false);
    }
  }

  function timeInput(field: TimeField, hint?: string) {
    const { value, candidates } = resolveTime(field);
    const time = value.slice(11);

    return (
      <div className="grid gap-2">
        <TextInput
          error={errorFor(errors, field)}
          hint={hint}
          id={field}
          label={timeLabels[field]}
          onChange={(event) =>
            field === "salesCloseAt"
              ? change({ form: { ...form, salesCloseAt: event.target.value }, closeFollowsStart: false })
              : setField(field, event.target.value)
          }
          type="datetime-local"
          value={value}
        />
        {candidates.length === 2 ? (
          <fieldset className="grid gap-1.5 rounded-control border border-line p-3 text-[15px]">
            <legend className="px-1 text-sm font-semibold text-ink">{timeLabels[field]}: {time} happens twice that day</legend>
            {candidates.map((candidate, index) => (
              <label className="flex min-h-11 items-center gap-2" key={candidate.toISOString()}>
                <input
                  checked={choices[field] === index}
                  className="size-4 accent-brand"
                  name={`${field}-overlap`}
                  onChange={() => change({ choices: { ...choices, [field]: index } })}
                  type="radio"
                />
                The {index === 0 ? "first" : "second"} {time} ({zoneAbbreviation(timeZone, candidate)})
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
    );
  }

  const referenceDate = resolveTime("startTime").date ?? new Date();
  const occupancy = initialEvent?.occupancy ?? 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form aria-label="Event details" className="grid gap-6" noValidate onSubmit={onSubmit}>
        {notice ? (
          <Notice
            action={
              notice.reload ? (
                <Button onClick={() => window.location.reload()} size="sm" type="button" variant="secondary">
                  {notice.reload}
                </Button>
              ) : null
            }
            role={notice.tone === "success" ? "status" : "alert"}
            title={notice.title}
            tone={notice.tone}
          >
            {notice.text}
          </Notice>
        ) : null}

        <Card>
          <div className="grid max-w-2xl gap-5">
            <h2 className="text-lg font-semibold text-ink">Details</h2>
            <TextInput error={errorFor(errors, "title")} id="title" label="Title" onChange={(event) => setField("title", event.target.value)} value={form.title} />
            <TextArea error={errorFor(errors, "description")} id="description" label="Description" onChange={(event) => setField("description", event.target.value)} value={form.description} />
            <TextInput error={errorFor(errors, "location")} id="location" label="Location" onChange={(event) => setField("location", event.target.value)} value={form.location} />
            <div className="grid gap-2">
              <span className="text-sm font-semibold text-ink" id="hero-label">
                Event image <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <div className="flex flex-wrap items-start gap-4">
                {upload.busy ? (
                  <div className="flex aspect-video w-full max-w-72 items-center justify-center rounded-control border border-line bg-surface-subtle text-sm text-ink-soft" role="status">
                    Uploading…
                  </div>
                ) : form.heroAssetId ? (
                  <img alt="Event image preview" className="aspect-video w-full max-w-72 rounded-control border border-line object-cover" src={`/api/orgs/${orgSlug}/assets/${form.heroAssetId}`} />
                ) : null}
                <div className="grid min-w-0 flex-1 basis-56 gap-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      accept={imageTypes.join(",")}
                      // The visible button opens it; hidden so it is not a second, unlabelled control.
                      className="hidden"
                      onChange={(event) => {
                        void chooseImage(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      ref={fileInput}
                      type="file"
                    />
                    <Button aria-describedby="hero-label" disabled={upload.busy} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
                      {form.heroAssetId ? "Replace image" : "Upload image"}
                    </Button>
                    {form.heroAssetId ? (
                      <Button aria-describedby="hero-label" disabled={upload.busy} onClick={() => setField("heroAssetId", null)} type="button" variant="tertiary">
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-sm text-ink-muted">JPG, PNG or WebP up to 5 MB and 4096 pixels. Shown at 16:9 on the event page and event cards.</p>
                  {upload.error ?? errorFor(errors, "heroAssetId") ? (
                    <p className="text-sm text-danger" role="alert">
                      {upload.error ?? errorFor(errors, "heroAssetId")}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="grid max-w-2xl gap-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">Schedule</h2>
              <p className="mt-1 text-sm text-ink-soft">Times are in {zoneLabel(timeZone, referenceDate)}, the society&apos;s time zone.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {timeInput("startTime")}
              {timeInput("endTime")}
            </div>
            {timeInput("salesCloseAt", "Defaults to the start time. Must be before the event ends.")}
          </div>
        </Card>

        <Card>
          <div className="grid gap-4" id="ticketTypes">
            <div>
              <h2 className="text-lg font-semibold text-ink">Tickets</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {mode === "edit" ? "Quantity is how many are still available. " : ""}A price of $0.00 is shown as Free.
              </p>
            </div>
            {errorFor(errors, "ticketTypes") && !errors.find((error) => error.path?.[0] === "ticketTypes" && error.path.length > 1) ? (
              <p className="text-sm text-danger">{errorFor(errors, "ticketTypes")}</p>
            ) : null}

            {ticketTypes.map((ticketType, index) => {
              const locked = hasSales(ticketType);
              const name = ticketType.name.trim() || `Ticket ${index + 1}`;

              return (
                <fieldset className="grid gap-3 border-t border-line pt-4" key={ticketType.id ?? index}>
                  <legend className="sr-only">Ticket {index + 1}</legend>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-start">
                    <TextInput error={errorFor(errors, "ticketTypes", String(index), "name")} label="Name" onChange={(event) => setTicketType(index, { name: event.target.value })} value={ticketType.name} />
                    <MoneyInput error={errorFor(errors, "ticketTypes", String(index), "price")} onChange={(price) => setTicketType(index, { price })} value={ticketType.price} />
                    <TextInput
                      error={errorFor(errors, "ticketTypes", String(index), "quantity")}
                      inputMode="numeric"
                      label={mode === "edit" ? "Quantity left" : "Quantity"}
                      onChange={(event) => setTicketType(index, { quantity: event.target.value })}
                      value={ticketType.quantity}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-ink-soft">
                      {ticketType.id
                        ? (ticketType.sold ?? 0) + (ticketType.held ?? 0) > 0
                          ? `${ticketType.sold ?? 0} sold · ${ticketType.held ?? 0} held in checkout`
                          : "No sales yet"
                        : "New ticket type"}
                      {locked ? ". Has sales, so it cannot be removed." : ""}
                    </p>
                    {locked ? null : (
                      <Button
                        aria-label={`Remove ticket type ${name}`}
                        onClick={() => change({ ticketTypes: ticketTypes.filter((_item, itemIndex) => itemIndex !== index) })}
                        size="sm"
                        type="button"
                        variant="tertiary"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </fieldset>
              );
            })}

            <div>
              <Button onClick={() => change({ ticketTypes: [...ticketTypes, { ...emptyTicketType }] })} type="button" variant="secondary">
                Add ticket type
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <div className="grid max-w-2xl gap-5">
            <h2 className="text-lg font-semibold text-ink">Access</h2>
            <fieldset className="grid gap-2" id="visibility">
              <legend className="mb-1 text-sm font-semibold text-ink">Who can find this event</legend>
              {(
                [
                  ["public", "Public", "Listed on Explore events and the society page."],
                  ["unlisted", "Link only", "Not listed. Anyone with the link can view and buy."]
                ] as const
              ).map(([value, label, hint]) => (
                <label className="flex min-h-11 items-start gap-3 rounded-control border border-line p-3" key={value}>
                  <input checked={form.visibility === value} className="mt-1 size-4 accent-brand" name="visibility" onChange={() => setField("visibility", value)} type="radio" />
                  <span className="grid">
                    <span className="font-semibold text-ink">{label}</span>
                    <span className="text-sm text-ink-soft">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <TextInput
              error={errorFor(errors, "capacity")}
              hint={`A ceiling across all ticket types. Leave blank for no limit.${occupancy > 0 ? ` It cannot be set below the ${occupancy} tickets already issued or held.` : ""}`}
              id="capacity"
              inputMode="numeric"
              label="Event capacity (optional)"
              onChange={(event) => setField("capacity", event.target.value)}
              value={form.capacity}
            />
          </div>
        </Card>

        <Card>
          <div className="grid max-w-2xl gap-3">
            <h2 className="text-lg font-semibold text-ink">If tickets cannot be issued</h2>
            <Select
              hint="For example, if the event sold out while the buyer was paying. Each new order keeps the policy it was made under."
              label="When a payment arrives but tickets cannot be issued"
              onChange={(event) => setField("compensationRefundMode", event.target.value as RefundMode)}
              value={form.compensationRefundMode}
            >
              <option value="manual_review">Review it manually</option>
              <option value="automatic_full">Refund the buyer automatically in full</option>
            </Select>
          </div>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface/95 px-4 py-3 sm:mx-0 sm:rounded-card sm:border">
          {dirty ? (
            <span className="mr-auto text-sm text-ink-soft" role="status">
              You have unsaved changes.
            </span>
          ) : null}
          <Link className={buttonClasses({ variant: "tertiary" })} href={mode === "edit" && eventId ? `/dashboard/events/${eventId}` : "/dashboard/events"}>
            Cancel
          </Link>
          <Button disabled={saving || upload.busy} size="lg" type="submit">
            {saving ? "Saving..." : mode === "edit" ? "Save changes" : "Create event"}
          </Button>
        </div>
      </form>
      {aside ? <aside aria-labelledby="ready-heading" className="lg:sticky lg:top-6">{aside}</aside> : null}
    </div>
  );
}

// Dollars with a fixed "$" prefix; the value is parsed to cents on save.
function MoneyInput({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
  const id = useId();

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-semibold text-ink" htmlFor={id}>
        Price
      </label>
      <div className="flex h-11 items-center rounded-control border border-line-strong bg-surface has-[[aria-invalid]]:border-danger">
        <span aria-hidden="true" className="pl-3 text-ink-soft">
          $
        </span>
        <input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className="h-full w-full min-w-0 bg-transparent px-2 text-base text-ink"
          id={id}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          value={value}
        />
      </div>
      {error ? (
        <p className="text-sm text-danger" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
