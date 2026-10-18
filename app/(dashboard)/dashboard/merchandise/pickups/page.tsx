import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PickupAction } from "@/components/merchandise/pickup-action";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/input";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/notice";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { listPickups, pickupResult, pickupStages, type PickupRow, type PickupStage } from "@/lib/merchandise/pickups";
import { hasOrganisationPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Pickups" };

const stageLabels: Record<PickupStage, string> = { prepare: "To prepare", ready: "Ready to collect", collected: "Collected", review: "Needs review" };
const emptyText: Record<PickupStage, [string, string]> = {
  prepare: ["Nothing to prepare", "Paid and free orders show here as they come in."],
  ready: ["Nothing waiting to be collected", "Orders you mark ready show here until they're handed over."],
  collected: ["Nothing collected yet", "Orders show here once they're handed over."],
  review: ["Nothing needs review", "A payment that arrived after the items ran out would show here."]
};

function href(stage: PickupStage, query = "", cursor?: string) {
  const params = new URLSearchParams();
  if (stage !== "prepare") params.set("stage", stage);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `/dashboard/merchandise/pickups?${search}` : "/dashboard/merchandise/pickups";
}

// Pickups (T28a, design round B2): fulfilled merchandise orders by stage, for
// staff with merchandise:fulfil. To prepare and Ready list oldest first.
export default async function PickupsPage({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string; cursor?: string; done?: string }> }) {
  const organisation = await requireManagementPage("merchandise:fulfil", "/dashboard/merchandise/pickups");
  const params = await searchParams;
  const stage = pickupStages.find((name) => name === params.stage) ?? "prepare";
  const query = params.q?.trim().slice(0, 100) ?? "";
  const cursor = params.cursor?.slice(0, 500) || undefined;
  const [{ timeZone, pickupPolicy }, done] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { timeZone: true, pickupPolicy: true } }),
    params.done ? pickupResult(organisation.id, params.done.slice(0, 40)) : null
  ]);

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader title="Merchandise" />
      <LinkTabs
        label="Merchandise sections"
        tabs={[
          ...(hasOrganisationPermission(organisation.staffRole, "merchandise:manage") ? [{ href: "/dashboard/merchandise", label: "Products", active: false }] : []),
          { href: "/dashboard/merchandise/pickups", label: "Pickups", active: true }
        ]}
      />
      {done ? (
        <Notice role="status" title={done.collected ? "Collected" : "Ready to collect"} tone="success">
          <p className="mt-0.5">
            {done.collected
              ? `Order ${done.reference} was handed over by ${done.by} at ${formatDateTime(done.at, { timeZone })}.`
              : `Order ${done.reference} is on the Ready tab. ${done.buyer} was emailed.`}
          </p>
        </Notice>
      ) : null}
      <Suspense fallback={<ListSkeleton label="Loading pickups" />}>
        <Pickups cursor={cursor} organisationId={organisation.id} orgSlug={organisation.slug} query={query} stage={stage} timeZone={timeZone} />
      </Suspense>
      {pickupPolicy ? <p className="whitespace-pre-wrap text-sm text-ink-soft [overflow-wrap:anywhere]">Pickup: {pickupPolicy}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="grid content-start gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Mark ready</h2>
          <p className="text-sm text-ink-soft">Emails the buyer that it&apos;s ready to collect, with your pickup details. On the Ready tab, Mark collected records who handed it over and when.</p>
        </section>
        <section className="grid content-start gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Needs review</h2>
          <p className="text-sm text-ink-soft">A payment that arrived after the items ran out. Finance sorts it out before anything is handed over.</p>
        </section>
      </div>
    </DashboardShell>
  );
}

async function Pickups({ organisationId, orgSlug, stage, query, cursor, timeZone }: { organisationId: string; orgSlug: string; stage: PickupStage; query: string; cursor?: string; timeZone: string }) {
  const { orders, counts, nextCursor } = await listPickups(organisationId, { stage, query, cursor });
  const when = (date: Date) => formatDateTime(date, { timeZone });
  const working = stage === "prepare" || stage === "ready";
  const items = (order: PickupRow) => (
    <ul className="grid gap-0.5">
      {order.lines.map((line, index) => (
        <li className="[overflow-wrap:anywhere]" key={index}>
          {line.quantity} × {line.nameSnapshot}
          {line.variantSnapshot ? ` · ${line.variantSnapshot}` : ""}
        </li>
      ))}
    </ul>
  );
  const status = (order: PickupRow) =>
    stage === "review"
      ? "Payment review: don't hand this over yet. Finance is checking the payment."
      : stage === "collected" && order.step
        ? `Handed over by ${order.step.by}, ${when(order.step.at)}`
        : stage === "ready" && order.step
          ? `Ready since ${when(order.step.at)}`
          : `${order.paymentKind === "free" ? "Free" : "Paid"} · ordered ${when(order.createdAt)}`;
  const action = (order: PickupRow, wide = false) =>
    working ? (
      <PickupAction order={order} orgSlug={orgSlug} stage={stage} step={stage === "prepare" ? "ready" : "collected"} wide={wide} />
    ) : (
      <StatusBadge status={stage === "collected" ? "collected" : "review"} />
    );

  return (
    <>
      <nav aria-label="Pickup stages" className="flex gap-2 overflow-x-auto pb-0.5 sm:flex-wrap">
        {pickupStages.map((name) => (
          <Link
            aria-current={name === stage ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold ${name === stage ? "border-brand bg-brand-tint text-brand-ink" : "border-line bg-surface text-ink-soft hover:text-ink"}`}
            href={href(name, query)}
            key={name}
          >
            {stageLabels[name]} · {counts[name]}
          </Link>
        ))}
      </nav>
      <Form action="/dashboard/merchandise/pickups" className="flex w-full items-end gap-2 sm:max-w-xl" role="search">
        {stage !== "prepare" ? <input name="stage" type="hidden" value={stage} /> : null}
        <div className="flex-1">
          <TextInput defaultValue={query} label="Find an order" name="q" placeholder="Order reference, name or email" type="search" />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </Form>

      {orders.length === 0 ? (
        <EmptyState icon={query ? "search" : "bag"} title={query ? `No ${stageLabels[stage].toLowerCase()} orders match “${query}”` : emptyText[stage][0]}>
          {query ? "Check the reference or spelling, or clear the search." : emptyText[stage][1]}
        </EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full min-w-[820px] border-collapse text-left text-[15px]">
              <thead>
                <tr className="text-[13px] text-ink-soft">
                  <th className="px-5 py-3.5 font-semibold" scope="col">Order</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Buyer</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Items</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Status</th>
                  <th className="px-5 py-3.5 text-right font-semibold" scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr className="border-t border-line align-top" key={order.id}>
                    <td className="px-5 py-4 font-semibold">{order.reference}</td>
                    <td className="px-3 py-4">
                      <span className="[overflow-wrap:anywhere]">{order.buyer}</span>
                      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                        {order.guest ? "Guest · " : ""}
                        {order.buyerEmailSnapshot}
                      </p>
                    </td>
                    <td className="px-3 py-4">{items(order)}</td>
                    <td className="px-3 py-4 text-sm text-ink-soft">{status(order)}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end">{action(order)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-3 md:hidden">
            {orders.map((order) => (
              <li className="grid gap-2.5 rounded-card border border-line bg-surface p-4" key={order.id}>
                <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">
                  {order.reference} · {order.buyer}
                </h2>
                <div className="text-[15px] text-ink">{items(order)}</div>
                <p className={`text-sm ${stage === "review" ? "font-semibold text-warning" : "text-ink-soft"}`}>
                  {order.guest ? "Guest · " : ""}
                  {status(order)}
                </p>
                {working ? action(order, true) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {nextCursor ? (
        <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={href(stage, query, nextCursor)}>
          Next page
        </Link>
      ) : null}
    </>
  );
}
