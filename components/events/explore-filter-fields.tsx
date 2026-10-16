"use client";

import { useState } from "react";
import { Select, TextInput } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { whenOptions, type ExploreErrors, type ExploreFilters } from "@/lib/events/explore-filters";

// The When and Society filters. On phones they fold behind a Filters toggle that
// says how many are on; From and To show only for "Choose dates".
export function ExploreFilterFields({
  filters,
  errors,
  societies
}: {
  filters: ExploreFilters;
  errors: ExploreErrors;
  societies: Array<{ name: string; slug: string }>;
}) {
  const [when, setWhen] = useState(filters.when);
  const activeCount = (filters.when !== "upcoming" ? 1 : 0) + (filters.society ? 1 : 0);
  const [open, setOpen] = useState(activeCount > 0 || Object.keys(errors).length > 0);

  return (
    <div className="grid gap-4">
      <button
        aria-controls="explore-filters"
        aria-expanded={open}
        className="flex min-h-12 items-center justify-between rounded-control border border-line bg-surface px-3.5 text-sm font-semibold text-ink md:hidden"
        onClick={() => setOpen(!open)}
        type="button"
      >
        Filters
        <span className="flex items-center gap-2">
          {activeCount ? <span className="rounded-tag bg-brand-tint px-2 py-0.5 text-xs text-brand-ink">{activeCount} on</span> : null}
          <Icon className={open ? "rotate-180" : ""} name="chevronDown" />
        </span>
      </button>
      <div className={`${open ? "grid" : "hidden"} gap-4 md:grid md:grid-cols-2`} id="explore-filters">
        <Select error={errors.when} label="When" name="when" onChange={(event) => setWhen(event.target.value as typeof when)} value={when}>
          {whenOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select defaultValue={filters.society} error={errors.society} label="Society" name="society">
          <option value="">All societies</option>
          {societies.map((society) => (
            <option key={society.slug} value={society.slug}>
              {society.name}
            </option>
          ))}
        </Select>
        {when === "custom" ? (
          <>
            <TextInput defaultValue={filters.from} error={errors.from} label="From" name="from" type="date" />
            <TextInput defaultValue={filters.to} error={errors.to} label="To" name="to" type="date" />
          </>
        ) : null}
      </div>
    </div>
  );
}
