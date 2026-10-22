import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateRange, membershipLabel } from "@/lib/format";
import { addDays } from "@/lib/analytics/range";
import {
  formatDay,
  formatTime,
  laneSegments,
  localDay,
  localMinutes,
  placeDay,
  shortWeekday,
  type CalendarItem,
  type Segment
} from "./layout";

// Month and Week (from 768px) and Agenda (phones, and the accessible list) of
// one set of calendar items. Every entry links to the event it came from.

export type ViewProps = {
  items: CalendarItem[];
  timeZone: string;
  today: string;
  // Where an event opens: its Summary, or Attendees for check-in staff.
  eventHref: (id: string) => string;
  // Days a manager can start a new event on; null for everyone else.
  newEventHref: ((day: string) => string) | null;
};

const termHref = "/dashboard/memberships/members";
const chipBase = "relative my-px block h-6 min-w-0 truncate border-y px-2 text-[13px] leading-[22px] no-underline";
// Colours only; each caller sets which borders and corners it draws. Chips and
// day numbers are positioned so they paint above the (positioned) day cells.
const tone = (item: CalendarItem) =>
  item.kind === "clock"
    ? "border-warning-border bg-warning-bg text-xs font-semibold text-warning"
    : item.kind === "term"
      ? "border-line bg-surface-subtle text-ink-soft"
      : item.event.status === "draft"
        ? "border-dashed border-ink-muted bg-surface text-ink"
        : "border-brand-200 bg-brand-tint text-brand-ink hover:border-brand";

function itemLabel(item: CalendarItem, timeZone: string) {
  if (item.kind === "clock") return item.label;
  if (item.kind === "term") return `${membershipLabel(item.end.name)} ends: last day for ${members(item.end.members)}, ${formatDay(item.end.lastDay, true)}`;
  return `${item.event.title}${item.event.status === "draft" ? ", draft" : ""}, ${formatDateRange(item.event.startTime, item.event.endTime, timeZone)}`;
}
const members = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

function chipText(segment: Segment, timeZone: string): ReactNode {
  const { item, before, after } = segment;
  if (item.kind === "clock") return item.label;
  if (item.kind === "term") return `${membershipLabel(item.end.name)} ends`;
  const { event } = item;
  const draft = event.status === "draft" ? <b className="font-semibold">Draft </b> : null;
  const start = formatTime(event.startTime, timeZone);
  if (!item.multiDay) return <>{draft}<b className="font-semibold">{start}</b> {event.title}</>;
  const end = `${shortWeekday(item.lastDay)} ${formatTime(event.endTime, timeZone)}`;
  if (before) return <>{draft}{event.title}, {after ? "continues" : <>until <b className="font-semibold">{end}</b></>}</>;
  return after
    ? <>{draft}<b className="font-semibold">{shortWeekday(item.firstDay)} {start}</b> {event.title}, continues</>
    : <>{draft}<b className="font-semibold">{shortWeekday(item.firstDay)} {start} to {end}</b> {event.title}</>;
}

function Chip({ segment, timeZone, eventHref, style }: { segment: Segment; timeZone: string; eventHref: ViewProps["eventHref"]; style: CSSProperties }) {
  const { item, before, after } = segment;
  const className = `${chipBase} ${tone(item)} ${before ? "ml-0" : "ml-1.5 rounded-l-md border-l"} ${after ? "mr-0" : "mr-1.5 rounded-r-md border-r"}`;
  if (item.kind === "clock") return <span className={className} style={style}>{item.label}</span>;
  return (
    <Link aria-label={itemLabel(item, timeZone)} className={className} href={item.kind === "term" ? termHref : eventHref(item.event.id)} style={style}>
      {chipText(segment, timeZone)}
    </Link>
  );
}

const visibleLanes = 3;

export function MonthGrid({ days, month, ...props }: ViewProps & { days: string[]; month: string }) {
  const weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div aria-hidden="true" className="grid grid-cols-7 border-b border-line">
        {weeks[0].map((day) => <span className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-soft" key={day}>{shortWeekday(day)}</span>)}
      </div>
      {weeks.map((week) => {
        const segments = laneSegments(week, props.items);
        const hidden = week.map((_, column) => segments.filter((segment) => segment.lane >= visibleLanes && segment.start <= column && segment.end >= column).length);
        return (
          <div className="grid min-h-[150px] grid-cols-7 grid-rows-[34px_26px_26px_26px_1fr] border-b border-line last:border-b-0" key={week[0]}>
            {week.map((day, column) => {
              const outside = day.slice(0, 7) !== month;
              return (
                <div className={`group relative border-l border-line first:border-l-0 ${outside ? "bg-surface-subtle" : ""}`} key={day} style={{ gridColumn: column + 1, gridRow: "1 / -1" }}>
                  {props.newEventHref && day >= props.today ? (
                    <Link
                      aria-label={`New event on ${formatDay(day, true)}`}
                      className="absolute bottom-1.5 right-1.5 rounded-md border border-brand bg-surface px-2 text-[13px] font-semibold leading-6 text-brand opacity-0 focus:opacity-100 group-hover:opacity-100"
                      href={props.newEventHref(day)}
                    >
                      + New event
                    </Link>
                  ) : null}
                </div>
              );
            })}
            {week.map((day, column) => (
              <span className={`relative px-2.5 pt-2 text-[13px] font-semibold ${day.slice(0, 7) !== month ? "text-ink-muted" : "text-ink"}`} key={day} style={{ gridColumn: column + 1, gridRow: 1 }}>
                {day === props.today ? (
                  <span aria-label={`${formatDay(day, true)}, today`} className="-ml-1 -mt-1 inline-flex size-[26px] items-center justify-center rounded-full bg-brand text-white">{Number(day.slice(8))}</span>
                ) : day.endsWith("-01") ? formatDay(day).split(" ").slice(1).join(" ") : Number(day.slice(8))}
              </span>
            ))}
            {segments.filter((segment) => segment.lane < visibleLanes).map((segment) => (
              <Chip eventHref={props.eventHref} key={segment.item.key} segment={segment} style={{ gridColumn: `${segment.start + 1} / span ${segment.end - segment.start + 1}`, gridRow: segment.lane + 2 }} timeZone={props.timeZone} />
            ))}
            {hidden.map((count, column) =>
              count ? (
                <Link className="relative mx-1.5 self-start text-[13px] font-semibold text-brand underline-offset-4 hover:underline" href={`?view=agenda&date=${week[column]}#day-${week[column]}`} key={week[column]} style={{ gridColumn: column + 1, gridRow: 5 }}>
                  +{count} more
                </Link>
              ) : null
            )}
          </div>
        );
      })}
    </div>
  );
}

const hourPx = 48;

export function WeekGrid({ days, now, ...props }: ViewProps & { days: string[]; now: Date }) {
  const allDay = laneSegments(days, props.items.filter((item) => item.kind !== "event" || item.multiDay));
  const timed = days.map((day) => placeDay(props.items.flatMap((item) => (item.kind === "event" && !item.multiDay && item.firstDay === day ? [item.event] : [])), props.timeZone));
  // 8 am to midnight, or from the earliest start this week.
  const firstHour = Math.min(8, ...timed.flat().map((entry) => Math.floor(entry.top / 60)));
  const top = (minutes: number) => ((minutes - firstHour * 60) * hourPx) / 60;
  const nowDay = localDay(now, props.timeZone);
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-line">
        <span aria-hidden="true" />
        {days.map((day) => (
          <div className="flex flex-col items-center gap-0.5 border-l border-line px-2 py-2.5" key={day}>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{shortWeekday(day)}</span>
            <strong
              aria-label={day === props.today ? `${formatDay(day, true)}, today` : formatDay(day, true)}
              className={`inline-flex size-8 items-center justify-center text-lg font-semibold ${day === props.today ? "rounded-full bg-brand text-white" : ""}`}
            >
              {Number(day.slice(8))}
            </strong>
          </div>
        ))}
      </div>
      {allDay.length ? (
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-line py-1">
          <span className="self-center pr-2 text-right text-xs text-ink-muted" style={{ gridColumn: 1, gridRow: 1 }}>All day</span>
          {allDay.map((segment) => (
            <Chip eventHref={props.eventHref} key={segment.item.key} segment={segment} style={{ gridColumn: `${segment.start + 2} / span ${segment.end - segment.start + 1}`, gridRow: segment.lane + 1 }} timeZone={props.timeZone} />
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]" style={{ height: (24 - firstHour) * hourPx }}>
        <div aria-hidden="true" className="relative">
          {Array.from({ length: 24 - firstHour }, (_, index) => firstHour + index).filter((hour) => hour % 2 === 0).map((hour) => (
            <span className="absolute right-2 -translate-y-2 text-xs text-ink-muted" key={hour} style={{ top: top(hour * 60) }}>
              {hour === 0 ? "12 am" : hour < 12 ? `${hour} am` : hour === 12 ? "12 pm" : `${hour - 12} pm`}
            </span>
          ))}
        </div>
        {days.map((day, index) => (
          <div className="relative border-l border-line bg-[linear-gradient(var(--color-line)_1px,transparent_1px)]" key={day} style={{ backgroundSize: `100% ${hourPx}px`, backgroundPositionY: 0 }}>
            {day === nowDay ? (
              <div aria-hidden="true" className="absolute inset-x-0 z-10 border-t-2 border-danger-icon" style={{ top: top(localMinutes(now, props.timeZone)) }}>
                <i className="absolute -left-[5px] -top-1.5 size-2.5 rounded-full bg-danger-icon" />
              </div>
            ) : null}
            {timed[index].map((entry) => {
              const event = entry.event;
              const end = formatTime(event.endTime, props.timeZone);
              const endDay = localDay(event.endTime, props.timeZone);
              return (
                <Link
                  aria-label={itemLabel({ kind: "event", key: event.id, event, firstDay: day, lastDay: day, multiDay: false }, props.timeZone)}
                  className={`absolute overflow-hidden border px-2 py-1.5 text-[13px] leading-snug no-underline ${tone({ kind: "event", key: event.id, event, firstDay: day, lastDay: day, multiDay: false })} ${entry.clipped ? "rounded-t-lg" : "rounded-lg"}`}
                  href={props.eventHref(event.id)}
                  key={event.id}
                  style={{
                    top: top(entry.top),
                    height: Math.max(24, top(entry.bottom) - top(entry.top) - 2),
                    left: `calc(${(entry.column / entry.columns) * 100}% + 4px)`,
                    width: `calc(${100 / entry.columns}% - 8px)`
                  }}
                >
                  <b className="block font-semibold">{event.status === "draft" ? `Draft · ${event.title}` : event.title}</b>
                  {formatTime(event.startTime, props.timeZone)} to {end}{endDay !== day ? ` ${shortWeekday(endDay)}` : ""}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Agenda({ days, noun, ...props }: ViewProps & { days: string[]; noun: "month" | "week" }) {
  const first = days[0];
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of props.items) {
    const day = item.firstDay < first ? first : item.firstDay;
    if (day > days[days.length - 1] || item.lastDay < first) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const showToday = days.includes(props.today);
  const listed = days.filter((day) => byDay.has(day) || (showToday && day === props.today));
  const earlier = listed.filter((day) => showToday && day < props.today);
  const earlierCount = earlier.reduce((sum, day) => sum + byDay.get(day)!.filter((item) => item.kind !== "clock").length, 0);
  const section = (day: string) => (
    <section aria-labelledby={`day-${day}-h`} className="grid scroll-mt-24 gap-2" id={`day-${day}`} key={day}>
      <h2 className={`text-[15px] font-semibold ${day === props.today ? "text-brand-ink" : "text-ink-soft"}`} id={`day-${day}-h`}>
        {day === props.today ? `Today · ${formatDay(day)}` : formatDay(day)}
      </h2>
      {byDay.get(day)?.map((item) => <AgendaRow day={day} item={item} key={item.key} {...props} />) ?? <p className="text-sm text-ink-soft">Nothing scheduled.</p>}
    </section>
  );
  return (
    <div className="grid gap-5">
      {earlierCount ? (
        <details className="rounded-xl border border-line bg-surface px-3.5 py-3">
          <summary className="min-h-6 cursor-pointer font-semibold">Earlier this {noun}: {earlierCount} {earlierCount === 1 ? "entry" : "entries"}</summary>
          <div className="mt-4 grid gap-5">{earlier.map(section)}</div>
        </details>
      ) : null}
      {listed.filter((day) => !earlier.includes(day)).map(section)}
    </div>
  );
}

function AgendaRow({ day, item, timeZone, eventHref }: ViewProps & { day: string; item: CalendarItem }) {
  if (item.kind === "clock") return <span className="w-fit rounded-md border border-warning-border bg-warning-bg px-2.5 text-[13px] font-semibold leading-[26px] text-warning">{item.label}</span>;
  const row = "grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-xl border px-3.5 py-3 text-ink no-underline hover:border-brand";
  if (item.kind === "term") {
    return (
      <Link className={`${row} border-line bg-surface-subtle`} href={termHref}>
        <span className="text-sm font-semibold">All day</span>
        <span className="grid gap-0.5">
          <strong className="text-[15px] font-semibold">{membershipLabel(item.end.name)} ends</strong>
          <span className="text-sm text-ink-soft">Last day for {members(item.end.members)}</span>
        </span>
      </Link>
    );
  }
  const { event } = item;
  const endDay = localDay(event.endTime, timeZone);
  const end = formatTime(event.endTime, timeZone);
  const until = endDay === day ? end : endDay === addDays(day, 1) ? `${end} ${shortWeekday(endDay)}` : `${formatDay(endDay)}, ${end}`;
  return (
    <Link aria-label={itemLabel(item, timeZone)} className={`${row} bg-surface ${event.status === "draft" ? "border-dashed border-ink-muted" : "border-line"}`} href={eventHref(event.id)}>
      <span className="text-sm font-semibold tabular-nums">{item.firstDay === day ? formatTime(event.startTime, timeZone) : "Ongoing"}</span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="text-[15px] font-semibold text-brand-ink [overflow-wrap:anywhere]">{event.title}</strong>
        <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">{event.location} · until {until}</span>
        {event.status === "draft" ? <StatusBadge status="draft" /> : null}
      </span>
    </Link>
  );
}
