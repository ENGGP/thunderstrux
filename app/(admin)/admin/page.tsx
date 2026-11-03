import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminTime, Panel } from "@/components/admin/record";
import { Icon } from "@/components/ui/icon";
import { formatMoney } from "@/lib/format";
import { requirePlatformPage } from "@/lib/platform/authority";
import { readCounts, readHealth, readNeeds, type NeedItem } from "@/lib/platform/overview";

export const metadata: Metadata = { title: "Admin overview" };

const relative = (from: Date, to: Date) => {
  const minutes = Math.max(0, Math.round(Math.abs(to.getTime() - from.getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
};

const levelStyle: Record<NeedItem["level"], { icon: "warning" | "clock" | "info"; className: string }> = {
  hot: { icon: "warning", className: "text-danger-icon" },
  warm: { icon: "clock", className: "text-warning-icon" },
  cool: { icon: "info", className: "text-neutral-icon" }
};

// T54 (board H2): what needs an operator comes first, worst first; then health; then counts.
export default async function AdminOverviewPage() {
  const actor = await requirePlatformPage("platform:monitor", "/admin");
  const now = new Date();
  const [needs, health, counts] = await Promise.all([readNeeds(now), readHealth(), readCounts(now)]);
  const healthItems: Array<[boolean | null, string]> = [
    [health.ready, health.ready ? "Ready" : "Not ready"],
    [health.rateLimiting, `Rate limiting ${health.rateLimiting ? "on" : "off"}`],
    [null, `Stripe ${health.stripeMode} mode`],
    [health.staffMfa === "enforce", `Staff MFA: ${health.staffMfa}`],
    [health.legacyAccess === "deny", `Legacy access: ${health.legacyAccess}`]
  ];
  const tiles: Array<[string, string, string]> = [
    ["Signups", String(counts.day.signups), `${counts.week.signups} in 7 days`],
    ["New societies", String(counts.day.societies), `${counts.week.societies} in 7 days`],
    ["New published events", String(counts.day.events), `${counts.week.events} in 7 days`],
    ["Paid orders", String(counts.day.paidOrders), `${counts.week.paidOrders} in 7 days`],
    ["Gross sales", formatMoney(counts.day.gross), `${formatMoney(counts.week.gross)} in 7 days`],
    ["Thunderstrux fees", formatMoney(counts.day.fees), `${formatMoney(counts.week.fees)} in 7 days`],
    ["Refunds", String(counts.day.refunds), `${counts.week.refunds} in 7 days`],
    ["Open disputes", String(counts.openDisputes), "answer in Stripe"]
  ];
  return (
    <AdminShell actor={actor} current="overview">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">Overview</h1>
        <p className="text-sm text-ink-soft">Checked <AdminTime value={now} />, Brisbane time</p>
      </div>
      <Panel note={needs.length ? "Each row opens the record it's about" : undefined} title={needs.length ? `Needs you · ${needs.length}, worst first` : "Needs you"}>
        {needs.length === 0 ? (
          <div className="flex items-center gap-3.5 px-4 py-3.5">
            <Icon className="text-success-icon" name="success" size={24} />
            <div>
              <p className="font-semibold">Nothing needs you</p>
              <p className="text-ink-soft">Disputes, reviews, refunds, payouts, queues and workers are all clear.</p>
            </div>
          </div>
        ) : (
          <ul>
            {needs.map((need, index) => (
              <li className="grid grid-cols-[22px_minmax(0,1fr)_auto_auto] items-center gap-x-3.5 gap-y-1 border-t border-[#efedf3] px-4 py-3 first:border-t-0" key={`${need.href}-${index}`}>
                <Icon className={levelStyle[need.level].className} name={levelStyle[need.level].icon} size={20} />
                <div className="min-w-0">
                  <p className="font-semibold">{need.title}</p>
                  <p className="text-[13px] text-ink-soft">{need.detail}</p>
                </div>
                <span className={`whitespace-nowrap text-[13px] font-semibold ${need.level === "hot" ? "text-danger" : need.level === "warm" ? "text-warning" : "text-ink-soft"}`}>
                  {need.due ? `due in ${relative(now, need.due)}` : need.age ? relative(need.age, now) : ""}
                </span>
                <Link className="inline-flex min-h-8 items-center rounded-[8px] border border-line-strong bg-surface px-2.5 text-[13px] font-semibold" href={need.href}>{need.action}</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Health">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 text-[13px]">
          {healthItems.map(([good, label]) => (
            <li className="inline-flex items-center gap-1.5" key={label}>
              <Icon className={good === null ? "text-neutral-icon" : good ? "text-success-icon" : "text-warning-icon"} name={good === null ? "circle" : good ? "success" : "warning"} size={16} />
              {label}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel note="Last 24 hours, with the last 7 days under each" title="Activity">
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))]">
          {tiles.map(([label, value, week]) => (
            <div className="flex flex-col gap-0.5 border-l border-[#efedf3] px-4 py-3.5 first:border-l-0" key={label}>
              <dt className="order-1 text-[12.5px] text-ink-muted">{label}</dt>
              <dd className="order-2 m-0 text-[22px] font-semibold tabular-nums">{value}</dd>
              <dd className="order-3 m-0 text-xs text-ink-soft">{week}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </AdminShell>
  );
}
