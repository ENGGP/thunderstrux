import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PlanActions } from "@/components/memberships/plan-actions";
import { PlanChecklist } from "@/components/memberships/plan-checklist";
import { PlanForm } from "@/components/memberships/plan-form";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatPrice, joinDays } from "@/lib/format";
import { formatDay, readPlan } from "@/lib/memberships/plans";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Membership plan" };

export default async function MembershipPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const organisation = await requireManagementPage("memberships:manage", `/dashboard/memberships/${encodeURIComponent(planId)}`);
  const found = await readPlan(organisation.id, planId);
  if (!found) notFound();
  const { plan, sold, holders, blockers, timeZone } = found;
  const archived = plan.status === "archived";
  const year = Number(plan.firstDay.slice(0, 4));
  const unlocks = [
    plan.entitlements.includes("member_prices") ? "Member prices on tickets" : null,
    plan.entitlements.includes("members_only_events") ? "Members-only events" : null
  ].filter(Boolean);
  const heldBy = holders === 1 ? "1 person has this plan" : holders > 1 ? `${holders} people have this plan` : "This plan has sold";

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        badge={<StatusBadge status={plan.standing} />}
        breadcrumbs={[{ label: "Memberships", href: "/dashboard/memberships" }]}
        title={plan.name}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid gap-5">
          {archived ? (
            <Notice title="Archived" tone="info">
              <p className="mt-0.5">This plan no longer sells and can&apos;t go back on sale. People who have it keep their membership and its dates.</p>
            </Notice>
          ) : sold ? (
            <Notice title={heldBy} tone="info">
              <p className="mt-0.5">Its name, dates, price and unlocks are locked so what people bought doesn&apos;t change. You can still edit the description.</p>
            </Notice>
          ) : null}
          <PlanForm
            archived={archived}
            locked={sold}
            orgSlug={organisation.slug}
            plan={plan}
            timeZone={timeZone}
            years={[year - 1, year, year + 1, year + 2].map(String)}
          />
        </div>

        <aside aria-label="Publishing and preview" className="grid gap-5 lg:sticky lg:top-24">
          {archived ? null : (
            <Card>
              <div className="grid gap-4">
                <h2 className="font-display text-xl font-semibold text-ink">{plan.status === "draft" ? "Ready to publish" : "On sale"}</h2>
                {plan.status === "draft" || blockers.length ? (
                  <PlanChecklist blockers={blockers} />
                ) : (
                  <p className="text-ink-soft">Shown on your society page until its last day.</p>
                )}
                <PlanActions holders={holders} orgSlug={organisation.slug} plan={plan} publishBlocked={blockers.length > 0} />
                {plan.status === "draft" ? (
                  <p className="text-sm text-ink-soft">Publishing puts it on your society page. After the first sale, the dates, price and unlocks are locked.</p>
                ) : null}
              </div>
            </Card>
          )}
          <section aria-labelledby="preview-heading" className="grid gap-2.5">
            <h2 className="text-sm font-semibold text-ink-muted" id="preview-heading">
              How buyers see it
            </h2>
            <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <p className="font-display text-lg font-semibold text-ink [overflow-wrap:anywhere]">{plan.name}</p>
              <p className="text-ui text-ink">
                {joinDays(formatDay(plan.firstDay), formatDay(plan.lastDay))}, {zoneCity(timeZone)}
              </p>
              {plan.description ? <p className="whitespace-pre-wrap text-sm text-ink-soft [overflow-wrap:anywhere]">{plan.description}</p> : null}
              <p className="text-sm text-ink-soft">{unlocks.join(" · ") || "No unlocks"}</p>
              <p className="border-t border-line pt-2.5 text-xl font-semibold tabular-nums text-ink">{formatPrice(plan.priceAmount)}</p>
            </div>
          </section>
        </aside>
      </div>
    </DashboardShell>
  );
}
