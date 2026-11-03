import Link from "next/link";
import type { ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import { formatDateTime } from "@/lib/format";
import type { ActivityRow, Attention } from "@/lib/platform/records";

// T54 (boards H4 to H6): one record layout for users, societies and orders.

export function AdminTime({ value, timeZone }: { value: Date | null | undefined; timeZone?: string }) {
  if (!value) return <span className="text-ink-muted">—</span>;
  // The UTC time on hover matches log lines.
  return <time dateTime={value.toISOString()} title={value.toISOString()}>{formatDateTime(value, { timeZone })}</time>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap gap-1.5 text-[13px] text-ink-muted">
      {items.map((item, index) => (
        <span className="flex gap-1.5" key={item.label}>
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          {item.href ? <Link className="text-ink-soft underline-offset-4 hover:underline" href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function RecordHeader({ type, title, ids, badges, facts, actions }: { type: string; title: string; ids?: ReactNode; badges?: ReactNode; facts?: ReactNode[]; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3.5">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">{type}</span>
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-[22px] font-semibold leading-tight">{title}</h1>{ids}</div>
        {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        {facts?.length ? <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">{facts.map((fact, index) => <span key={index}>{fact}</span>)}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function AttentionStrip({ items }: { items: Attention[] }) {
  if (items.length === 0) return null;
  const order = { danger: 0, warning: 1, info: 2 };
  return (
    <div className="grid gap-2">
      {[...items].sort((a, b) => order[a.tone] - order[b.tone]).map((item) => (
        <Notice key={item.title} title={item.title} tone={item.tone}>{item.body}</Notice>
      ))}
    </div>
  );
}

export function Panel({ title, note, action, children, id }: { title: string; note?: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-label={title} className="rounded-[10px] border border-line bg-surface" id={id}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[#efedf3] px-4 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note ? <span className="text-[12.5px] text-ink-muted">{note}</span> : null}
        {action}
      </div>
      {children}
    </section>
  );
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,170px)_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3.5 text-[13.5px]">
      {rows.map(([term, value]) => (
        <div className="contents" key={term}>
          <dt className="text-ink-muted">{term}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere] [&>*]:mr-1.5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const tableClass = "w-full border-collapse text-[13.5px] [&_td]:border-b [&_td]:border-[#efedf3] [&_td]:px-3 [&_td]:py-2.5 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[#faf9fb] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ink-muted [&_tr:last-child_td]:border-b-0";
export const rowLink = "font-semibold text-ink underline decoration-line-strong underline-offset-[3px] hover:text-brand hover:decoration-current";

// Operator actions stand out (filled); everything else is a quiet outline.
export function ActivityList({ rows, timeZone, empty = "Nothing recorded yet." }: { rows: ActivityRow[]; timeZone?: string; empty?: string }) {
  if (rows.length === 0) return <p className="px-4 py-3.5 text-ink-muted">{empty}</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li className="grid grid-cols-[112px_minmax(0,1fr)_auto] items-baseline gap-x-3.5 gap-y-1 border-t border-[#efedf3] px-4 py-2.5 first:border-t-0" key={`${row.source}-${row.id}`}>
          <span className={`inline-flex h-5 items-center justify-self-start rounded-[4px] border px-1.5 text-[10.5px] font-bold tracking-wider ${row.source === "SUPPORT"
            ? "border-ink bg-ink text-white" : "border-line bg-surface text-neutral"}`}>{row.source}</span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="first-letter:uppercase">{row.text}</span>
            {row.detail ? <span className="text-[12.5px] text-ink-muted">{row.detail}</span> : null}
            {row.facts ? (
              <details className="text-[12.5px]">
                <summary className="w-fit cursor-pointer text-ink-soft">Stored facts</summary>
                <pre className="mt-1.5 overflow-x-auto rounded-[6px] border border-[#efedf3] bg-[#f9f8fb] px-2.5 py-2 font-mono text-xs text-ink-soft">{JSON.stringify(row.facts, null, 2)}</pre>
              </details>
            ) : null}
          </div>
          <span className="whitespace-nowrap text-right text-[12.5px] text-ink-muted"><AdminTime timeZone={timeZone} value={row.at} /></span>
        </li>
      ))}
    </ul>
  );
}
