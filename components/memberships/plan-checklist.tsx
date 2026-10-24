import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { PlanBlocker } from "@/lib/memberships/plans";

// The publish checks in a fixed order, each showing the server's blocker.
const checks: Array<{ label: string; code: PlanBlocker["code"] }> = [
  { label: "Dates still to come", code: "term_past" },
  { label: "Doesn't overlap another published plan", code: "overlap" },
  { label: "Payments set up (needed for a paid plan)", code: "payments_unavailable" }
];

export function PlanChecklist({ blockers }: { blockers: PlanBlocker[] }) {
  return (
    <ul className="grid gap-3">
      {checks.map((check) => {
        const blocker = blockers.find((item) => item.code === check.code);
        return (
          <li className="flex gap-2.5 text-ui" key={check.code}>
            <Icon className={blocker ? "mt-0.5 text-warning" : "mt-0.5 text-success"} name={blocker ? "warning" : "success"} size={20} />
            <span className="grid gap-0.5">
              <span className={blocker ? "font-semibold text-ink" : "text-ink"}>
                <span className="sr-only">{blocker ? "Needs attention: " : "Done: "}</span>
                {check.label}
              </span>
              {blocker ? <span className="text-sm text-ink-soft">{blocker.message}</span> : null}
              {blocker?.code === "payments_unavailable" ? (
                <Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/dashboard/settings">
                  Go to Payments
                </Link>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
