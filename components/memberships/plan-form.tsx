"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { MoneyInput, Select, TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney, formatMoneyInput, parseMoneyInput } from "@/lib/format";
import type { StaffPlan } from "@/lib/memberships/plans";
import { calculatePlatformFee, isBelowStripeMinimum, paidPriceMinimum } from "@/lib/stripe/fees";
import { zoneCity } from "@/lib/zoned-time";

type Entitlement = StaffPlan["entitlements"][number];
type Preset = "semester1" | "semester2" | "year" | "custom";

const presets: Array<{ id: Preset; label: string }> = [
  { id: "semester1", label: "Semester 1" },
  { id: "semester2", label: "Semester 2" },
  { id: "year", label: "Full year" },
  { id: "custom", label: "Custom dates" }
];
const unlocks: Array<{ id: Entitlement; label: string; hint: string }> = [
  { id: "member_prices", label: "Member prices on tickets", hint: "You set a member price on each ticket type." },
  { id: "members_only_events", label: "Members-only events", hint: "Members can find and book events set to Members only." }
];

// The approved defaults: semesters split the calendar year; every date stays editable.
function presetDays(preset: Exclude<Preset, "custom">, year: string) {
  if (preset === "semester1") return { firstDay: `${year}-01-01`, lastDay: `${year}-06-30` };
  if (preset === "semester2") return { firstDay: `${year}-07-01`, lastDay: `${year}-12-31` };
  return { firstDay: `${year}-01-01`, lastDay: `${year}-12-31` };
}
function presetName(preset: Exclude<Preset, "custom">, year: string) {
  return preset === "year" ? `${year} membership` : `${preset === "semester1" ? "Semester 1" : "Semester 2"} ${year}`;
}
// A new plan starts on the soonest preset term that hasn't begun yet, so the
// form never opens on a term that is mostly over. `today` is YYYY-MM-DD in the society's zone.
export function defaultTerm(years: string[], today: string): { preset: Exclude<Preset, "custom">; year: string } {
  const terms = years.flatMap((year) => (["year", "semester1", "semester2"] as const).map((preset) => ({ preset, year, firstDay: presetDays(preset, year).firstDay })));
  const next = terms.filter((term) => term.firstDay >= today).sort((a, b) => a.firstDay.localeCompare(b.firstDay))[0];
  return next ? { preset: next.preset, year: next.year } : { preset: "year", year: years[0] };
}
function detectPreset(firstDay: string, lastDay: string): { preset: Preset; year: string } {
  const year = firstDay.slice(0, 4);
  const match = (["semester1", "semester2", "year"] as const).find((preset) => {
    const days = presetDays(preset, year);
    return days.firstDay === firstDay && days.lastDay === lastDay;
  });
  return { preset: match ?? "custom", year };
}

export function PlanForm({
  orgSlug,
  timeZone,
  years,
  today,
  plan,
  locked = false,
  archived = false
}: {
  orgSlug: string;
  timeZone: string;
  years: string[];
  // The society's date today; only a new plan uses it.
  today?: string;
  // Left out for a new plan.
  plan?: StaffPlan;
  // Sold: only the description changes.
  locked?: boolean;
  archived?: boolean;
}) {
  const router = useRouter();
  const fresh = defaultTerm(years, today ?? "");
  const start: { preset: Preset; year: string } = plan ? detectPreset(plan.firstDay, plan.lastDay) : fresh;
  const initialDays = plan ? { firstDay: plan.firstDay, lastDay: plan.lastDay } : presetDays(fresh.preset, fresh.year);
  const initial = {
    preset: start.preset,
    year: start.year,
    ...initialDays,
    name: plan?.name ?? presetName(fresh.preset, fresh.year),
    description: plan?.description ?? "",
    price: plan ? formatMoneyInput(plan.priceAmount) : "",
    entitlements: plan?.entitlements ?? (["member_prices", "members_only_events"] as Entitlement[])
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== saved;
  const fixed = locked || archived;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(values: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...values }));
    setMessage("");
  }
  // A preset fills both days, and the name too while it is still the suggested one.
  function choose(preset: Preset, year = form.year) {
    if (preset === "custom") return update({ preset, year });
    const suggested = form.preset !== "custom" && form.name === presetName(form.preset, form.year);
    update({ preset, year, ...presetDays(preset, year), ...(suggested || !form.name.trim() ? { name: presetName(preset, year) } : {}) });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const priceAmount = parseMoneyInput(form.price);
    if (priceAmount === null) {
      setErrors({ priceAmount: "Enter an amount like 25.00. Use 0 for a free membership." });
      return;
    }
    if (isBelowStripeMinimum(priceAmount)) {
      setErrors({ priceAmount: paidPriceMinimum });
      return;
    }
    setBusy(true);
    setErrors({});
    setError("");
    setConflict(false);
    const body = {
      name: form.name,
      description: form.description,
      priceAmount,
      firstDay: form.firstDay,
      lastDay: form.lastDay,
      entitlements: form.entitlements
    };
    try {
      const response = await fetchJson<{ plan: { id: string } }>(
        plan ? `/api/orgs/${orgSlug}/memberships/${plan.id}` : `/api/orgs/${orgSlug}/memberships`,
        {
          method: plan ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plan ? { ...body, expectedVersion: plan.version } : body)
        }
      );
      setSaved(JSON.stringify(form));
      if (plan) {
        setMessage("Plan saved.");
        router.refresh();
      } else {
        router.push(`/dashboard/memberships/${response.plan.id}`);
      }
    } catch (failure) {
      const details = failure instanceof ClientApiError ? (failure.payload?.error?.details ?? []) : [];
      setErrors(Object.fromEntries(details.filter((detail) => detail.path?.length).map((detail) => [detail.path![0], detail.message])));
      setConflict(failure instanceof ClientApiError && failure.status === 409 && /changed since you opened it/.test(failure.payload?.error?.message ?? ""));
      setError(getClientErrorMessage(failure, "Unable to save the plan."));
    } finally {
      setBusy(false);
    }
  }

  const cents = parseMoneyInput(form.price);
  return (
    <form className="grid gap-5" noValidate onSubmit={save}>
      <Card>
        <fieldset className="grid gap-4" disabled={fixed}>
          <legend className="mb-4 font-display text-xl font-semibold text-ink">Term</legend>
          {fixed ? null : (
            <div className="grid gap-4">
              <div className="grid gap-2" role="radiogroup" aria-label="Length">
                <p aria-hidden="true" className="text-sm font-semibold text-ink">Length</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <label
                      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3.5 text-[15px] ${
                        form.preset === preset.id ? "border-brand bg-brand-tint font-semibold text-brand-ink" : "border-line-strong text-ink"
                      }`}
                      key={preset.id}
                    >
                      <input checked={form.preset === preset.id} className="accent-brand" name="preset" onChange={() => choose(preset.id)} type="radio" />
                      {preset.label}
                    </label>
                  ))}
                </div>
              </div>
              {form.preset === "custom" ? null : (
                <div className="max-w-48">
                  <Select label="Year" onChange={(event) => choose(form.preset, event.target.value)} value={form.year}>
                    {years.map((year) => (
                      <option key={year}>{year}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2" id="firstDay">
            <DateField
              error={errors.firstDay}
              label="First day"
              onChange={(day) => update({ firstDay: day, preset: "custom" })}
              required
              value={form.firstDay}
            />
            <DateField
              error={errors.lastDay}
              id="lastDay"
              label="Last day"
              onChange={(day) => update({ lastDay: day, preset: "custom" })}
              required
              value={form.lastDay}
            />
          </div>
          <p className="text-sm text-ink-muted">
            Runs from the start of the first day to the end of the last day, {zoneCity(timeZone)}.
          </p>
        </fieldset>
      </Card>

      <Card>
        <div className="grid gap-4">
          <h2 className="font-display text-xl font-semibold text-ink">Details</h2>
          <TextInput
            disabled={fixed}
            error={errors.name}
            hint="Shown on the society page, receipts and My memberships."
            label="Name"
            maxLength={120}
            onChange={(event) => update({ name: event.target.value })}
            required
            value={form.name}
          />
          <TextArea
            disabled={archived}
            error={errors.description}
            label="Description"
            maxLength={2000}
            onChange={(event) => update({ description: event.target.value })}
            value={form.description}
          />
        </div>
      </Card>

      <Card>
        <div className="grid gap-3" id="priceAmount">
          <h2 className="font-display text-xl font-semibold text-ink">Price and fees</h2>
          <div className="max-w-60">
            <MoneyInput
              disabled={fixed}
              error={errors.priceAmount}
              hint="Enter 0 for a free membership."
              onChange={(price) => update({ price })}
              value={form.price}
            />
          </div>
          {cents !== null && cents > 0 ? (
            <p className="text-sm text-ink-soft">
              For one {formatMoney(cents)} membership: the buyer pays {formatMoney(cents)}; Thunderstrux keeps{" "}
              {formatMoney(calculatePlatformFee(cents))}; your society receives {formatMoney(cents - calculatePlatformFee(cents))}. The fee includes
              card processing.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <fieldset className="grid gap-4" disabled={fixed}>
          <legend className="mb-4 font-display text-xl font-semibold text-ink">What it unlocks</legend>
          {unlocks.map((unlock) => (
            <label className="flex items-start gap-3" key={unlock.id}>
              <input
                checked={form.entitlements.includes(unlock.id)}
                className="mt-1 size-5 accent-brand"
                onChange={(event) =>
                  update({
                    entitlements: event.target.checked
                      ? [...form.entitlements, unlock.id]
                      : form.entitlements.filter((entitlement) => entitlement !== unlock.id)
                  })
                }
                type="checkbox"
              />
              <span className="grid">
                <span className="text-[15px] font-semibold text-ink">{unlock.label}</span>
                <span className="text-sm text-ink-muted">{unlock.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      {conflict ? (
        <Notice role="alert" title="This plan changed since you opened it" tone="warning">
          <p className="mt-0.5">Your edits are still in the form. Reload to see the latest version, then make your changes again.</p>
          <Button className="mt-2" onClick={() => window.location.reload()} type="button" variant="secondary">
            Reload plan
          </Button>
        </Notice>
      ) : error ? (
        <Notice role="alert" title="Not saved" tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}
      {message ? (
        <Notice role="status" tone="success">
          <p>{message}</p>
        </Notice>
      ) : null}

      {archived ? null : (
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} size="lg" type="submit">
            {plan ? (locked ? "Save description" : "Save changes") : "Save draft"}
          </Button>
          <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href="/dashboard/memberships">
            {plan ? "Back to plans" : "Cancel"}
          </Link>
        </div>
      )}
    </form>
  );
}
