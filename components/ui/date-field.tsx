"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { Field, Select, control } from "@/components/ui/input";
import { formatDayInput, localTodayInBrowser, monthWeeks, parseDayInput, shiftDay, shiftMonth } from "@/lib/date-input";

// The house date picker: a text field people can type into ("22 Oct 2026",
// "22/10/2026") beside a button that opens a Monday-first month in the
// design system's style, instead of each browser's own popup. A `name`
// submits the day as YYYY-MM-DD, so it works in plain GET forms.

type DateFieldProps = {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (day: string) => void;
  required?: boolean;
  min?: string;
  max?: string;
};

const monthTitle = (day: string) => new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const longDay = (day: string) => new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DateField({ label, hint, error, id, name, value: controlled, defaultValue = "", onChange, required, min, max }: DateFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  const [text, setText] = useState(formatDayInput(value));
  const [unreadable, setUnreadable] = useState(false);
  // How it was opened: the calendar animates in only for a pointer, never from the keyboard.
  const [open, setOpen] = useState<false | "pointer" | "keyboard">(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setText(formatDayInput(value));
    setUnreadable(false);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const commit = (day: string) => {
    if (controlled === undefined) setOwn(day);
    onChange?.(day);
    setText(formatDayInput(day));
    setUnreadable(false);
  };
  const read = () => {
    const day = parseDayInput(text);
    if (day === null) setUnreadable(true);
    else if (day !== value) commit(day);
    else setText(formatDayInput(day));
  };
  const shown = error ?? (unreadable ? "Enter a date like 22 Oct 2026." : undefined);

  return (
    <Field error={shown} hint={hint} id={fieldId} label={label}>
      {(describedBy) => (
        <div className="relative" ref={wrapper}>
          <div className="flex">
            <input
              aria-describedby={describedBy}
              aria-invalid={shown ? true : undefined}
              autoComplete="off"
              className={`h-11 min-w-[8.5rem] ${control.replace("rounded-control", "rounded-l-control")}`}
              id={fieldId}
              inputMode="text"
              onBlur={read}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && event.altKey) setOpen("keyboard");
                if (event.key !== "Enter") return;
                // Read the typed day first; a GET form then submits with it.
                event.preventDefault();
                read();
                const form = event.currentTarget.form;
                if (name && form) setTimeout(() => form.requestSubmit(), 0);
              }}
              placeholder="DD Mon YYYY"
              required={required}
              value={text}
            />
            <button
              aria-expanded={Boolean(open)}
              aria-haspopup="dialog"
              aria-label={`Choose ${label.toLowerCase()} from a calendar`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-r-control border border-l-0 border-line-strong bg-surface text-brand hover:bg-brand-tint"
              // Enter and Space fire a click with detail 0.
              onClick={(event) => setOpen(open ? false : event.detail === 0 ? "keyboard" : "pointer")}
              ref={toggle}
              type="button"
            >
              <Icon name="calendar" size={18} />
            </button>
          </div>
          {name ? <input name={name} type="hidden" value={value} /> : null}
          {open ? (
            <MonthPicker
              animate={open === "pointer"}
              label={label}
              max={max}
              min={min}
              onClose={() => {
                setOpen(false);
                toggle.current?.focus();
              }}
              onPick={(day) => {
                commit(day);
                setOpen(false);
                toggle.current?.focus();
              }}
              value={value}
            />
          ) : null}
        </div>
      )}
    </Field>
  );
}

// Below 640px the month is a sheet pinned to the bottom of the screen, so a
// field in a right-hand column never opens it off the edge.
function MonthPicker({ animate, label, value, min, max, onPick, onClose }: { animate: boolean; label: string; value: string; min?: string; max?: string; onPick: (day: string) => void; onClose: () => void }) {
  const today = localTodayInBrowser();
  const [focused, setFocused] = useState(value || today);
  const grid = useRef<HTMLTableElement>(null);
  const titleId = useId();
  const outOfRange = (day: string) => Boolean((min && day < min) || (max && day > max));

  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => shiftDay(focused, -1),
      ArrowRight: () => shiftDay(focused, 1),
      ArrowUp: () => shiftDay(focused, -7),
      ArrowDown: () => shiftDay(focused, 7),
      Home: () => shiftDay(focused, -((new Date(`${focused}T12:00:00Z`).getUTCDay() + 6) % 7)),
      End: () => shiftDay(focused, 6 - ((new Date(`${focused}T12:00:00Z`).getUTCDay() + 6) % 7)),
      PageUp: () => shiftMonth(focused, event.shiftKey ? -12 : -1),
      PageDown: () => shiftMonth(focused, event.shiftKey ? 12 : 1)
    };
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (moves[event.key]) {
      event.preventDefault();
      setFocused(moves[event.key]());
    }
  };
  const step = "flex size-10 items-center justify-center rounded-control text-ink hover:bg-brand-tint hover:text-brand-ink";

  return (
    <div
      aria-labelledby={titleId}
      className={`fixed inset-x-4 bottom-4 z-30 rounded-card border border-line bg-surface p-3 shadow-[0_12px_32px_rgba(36,20,64,0.16)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[19.5rem] sm:origin-top-left ${animate ? "animate-sheet-in sm:animate-pop-in" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      role="dialog"
    >
      <div className="flex items-center justify-between gap-2">
        <button aria-label="Previous month" className={step} onClick={() => setFocused(shiftMonth(focused, -1))} type="button">
          <Icon name="chevronLeft" size={18} />
        </button>
        <h2 aria-live="polite" className="font-display text-base font-semibold text-ink" id={titleId}>
          <span className="sr-only">{label}: </span>
          {monthTitle(focused)}
        </h2>
        <button aria-label="Next month" className={step} onClick={() => setFocused(shiftMonth(focused, 1))} type="button">
          <Icon name="chevronRight" size={18} />
        </button>
      </div>
      <table className="mt-2 w-full border-collapse text-center" ref={grid} role="grid">
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted" key={day} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(focused).map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const inMonth = day.slice(0, 7) === focused.slice(0, 7);
                const selected = day === value;
                const disabled = outOfRange(day);
                return (
                  <td className="p-0.5" key={day}>
                    <button
                      aria-current={day === today ? "date" : undefined}
                      aria-label={longDay(day)}
                      aria-pressed={selected}
                      className={`size-10 rounded-full text-sm font-semibold tabular-nums disabled:cursor-not-allowed disabled:text-line-strong ${
                        selected
                          ? "bg-brand text-white"
                          : day === today
                            ? "text-brand-ink ring-2 ring-inset ring-brand hover:bg-brand-tint"
                            : inMonth
                              ? "text-ink hover:bg-brand-tint hover:text-brand-ink"
                              : "text-ink-muted hover:bg-surface-subtle"
                      }`}
                      data-day={day}
                      disabled={disabled}
                      onClick={() => onPick(day)}
                      onKeyDown={move}
                      tabIndex={day === focused ? 0 : -1}
                      type="button"
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        <button className="min-h-10 px-2 text-sm font-semibold text-brand underline-offset-4 hover:underline" disabled={outOfRange(today)} onClick={() => onPick(today)} type="button">
          Today
        </button>
        <button className="min-h-10 px-2 text-sm font-semibold text-ink-soft underline-offset-4 hover:underline" onClick={onClose} type="button">
          Close
        </button>
      </div>
    </div>
  );
}

// A local date and time for forms that need both (the event builder): the
// house date picker and a time list in 15-minute steps. The value is
// "YYYY-MM-DDTHH:MM", or "" until both parts are chosen.
export function DateTimeField({ label, hint, error, id, value, onChange }: { label: string; hint?: string; error?: string; id?: string; value: string; onChange: (value: string) => void }) {
  // Either half chosen alone waits here until the other is chosen.
  const [pending, setPending] = useState({ day: "", time: "" });
  const day = value.slice(0, 10) || pending.day;
  const time = value.slice(11, 16) || pending.time;
  const times = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);
  if (time && !times.includes(time)) times.push(time);
  times.sort();
  const clock = (hhmm: string) => new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`2000-01-01T${hhmm}:00Z`));

  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-2">
        <DateField
          error={error}
          hint={hint}
          id={id}
          label="Date"
          onChange={(next) => {
            setPending({ day: next, time });
            onChange(next && time ? `${next}T${time}` : "");
          }}
          value={day}
        />
        <Select
          label="Time"
          onChange={(event) => {
            setPending({ day, time: event.target.value });
            onChange(day && event.target.value ? `${day}T${event.target.value}` : "");
          }}
          value={time}
        >
          <option value="">Choose</option>
          {times.map((option) => (
            <option key={option} value={option}>
              {clock(option)}
            </option>
          ))}
        </Select>
      </div>
    </fieldset>
  );
}
