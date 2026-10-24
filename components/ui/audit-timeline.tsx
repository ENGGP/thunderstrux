import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export type TimelineEntry = { id: string; title: string; time: Date; meta?: string | null; details?: string[] };

// One history list: what happened, who or what did it, when, and safe facts.
// It is a single <section> so a page has exactly one place its history lives.
export function AuditTimeline({
  heading,
  entries,
  note,
  empty,
  footer,
  timeZone
}: {
  heading: string;
  entries: TimelineEntry[];
  note?: ReactNode;
  empty: string;
  footer?: ReactNode;
  timeZone?: string;
}) {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      {note ? <p className="mt-2 text-sm text-ink-soft">{note}</p> : null}
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">{empty}</p>
      ) : (
        <ol className="mt-3 divide-y divide-line">
          {entries.map((entry) => (
            <li className="break-words py-3" key={entry.id}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div>
                  <p className="text-ui font-semibold text-ink">{entry.title}</p>
                  {entry.meta ? <p className="text-sm text-ink-soft">{entry.meta}</p> : null}
                </div>
                <time className="text-sm text-ink-soft" dateTime={entry.time.toISOString()}>{formatDateTime(entry.time, timeZone ? { timeZone } : {})}</time>
              </div>
              {entry.details?.map((detail) => <p className="mt-1 text-sm text-ink-soft" key={detail}>{detail}</p>)}
            </li>
          ))}
        </ol>
      )}
      {footer}
    </Card>
  );
}
