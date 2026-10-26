import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { ReadinessBlocker } from "@/lib/events/event-readiness";

// The publish checks in a fixed order; each shows the shared readiness blocker
// that fails it, so the wording matches the Publish button's reason.
const checks = [
  { label: "Title, description and location", codes: ["details_missing"] },
  { label: "Ends after it starts", codes: ["schedule_invalid"] },
  { label: "Sales close in the future, before the end", codes: ["sales_close_after_end", "sales_window_past"] },
  { label: "A ticket type with tickets left", codes: ["no_ticket_types", "no_stock", "sold_out"] },
  { label: "A ticket people can buy now", codes: ["payments_unavailable", "paid_tickets_waiting"] },
  // Shown only while it blocks, since most events are not members-only.
  { label: "A plan that unlocks members-only events", codes: ["members_only_unavailable"], onlyWhenBlocked: true }
];

export function ReadinessChecklist({
  blockers,
  warnings = [],
  editHref
}: {
  blockers: ReadinessBlocker[];
  // Things that don't stop publishing but that buyers will notice.
  warnings?: ReadinessBlocker[];
  // Fix links go to this page's fields; left out on the Edit page itself.
  editHref?: string;
}) {
  return (
    <ul className="grid gap-3">
      {checks.map((check) => {
        const blocker = blockers.find((item) => check.codes.includes(item.code)) ?? warnings.find((item) => check.codes.includes(item.code));
        if (!blocker && "onlyWhenBlocked" in check) return null;
        const fix =
          blocker?.code === "payments_unavailable" || blocker?.code === "paid_tickets_waiting"
            ? { href: "/dashboard/settings", label: "Set up payments" }
            : blocker?.code === "members_only_unavailable"
              ? { href: "/dashboard/memberships", label: "Go to Memberships" }
              : blocker && editHref
              ? { href: `${editHref}#${blocker.field}`, label: "Fix on the Edit page" }
              : null;

        return (
          <li className="flex gap-2.5 text-ui" key={check.label}>
            <Icon
              className={blocker ? "mt-0.5 text-warning" : "mt-0.5 text-success"}
              name={blocker ? "warning" : "success"}
              size={20}
            />
            <span className="grid gap-0.5">
              <span className={blocker ? "font-semibold text-ink" : "text-ink"}>
                <span className="sr-only">{blocker ? "Needs attention: " : "Done: "}</span>
                {check.label}
              </span>
              {blocker ? <span className="text-sm text-ink-soft">{blocker.message}</span> : null}
              {fix ? (
                <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={fix.href}>
                  {fix.label}
                </Link>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
