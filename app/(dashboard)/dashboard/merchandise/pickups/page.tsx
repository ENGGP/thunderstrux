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
import { Count, LinkTabs, pillClasses } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/notice";
import { Pager } from "@/components/ui/pager";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatDateTime } from "@/lib/format";
import { listPickups, pickupResult, pickupSettings, pickupStages, toPrepareCount, type PickupRow, type PickupStage } from "@/lib/merchandise/pickups";
import { hasOrganisationPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Pickups" };

const dateHeading: Record<PickupStage, string> = { prepare: "Ordered", ready: "Ready since", collected: "Handed over", review: "Note" };
const stageLabels: Record<PickupStage, string> = { prepare: "To prepare", ready: "Ready to collect", collected: "Collected", review: "Needs review" };
const emptyText: Record<PickupStage, [string, string]> = {
  prepare: ["Nothing to prepare", "Paid and free orders show here as they come in."],
  ready: ["Nothing waiting to be collected", "Orders you mark ready show here until they're handed over."],
  collected: ["Nothing collected yet", "Orders show here once they're handed over."],
  review: ["Nothing needs review", "A payment that arrived after the items ran out would show here."]
};

function href(stage: PickupStage, query = "", cursor?: string, direction?: "next" | "prev", done?: string) {
  const params = new URLSearchParams();
  if (stage !== "prepare") params.set("stage", stage);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  if (cursor && direction === "prev") params.set("direction", direction);
  if (done) params.set("done", done);
  const search = params.toString();
  return search ? `/dashboard/merchandise/pickups?${search}` : "/dashboard/merchandise/pickups";
}

// Pickups (T28a, design round B2): fulfilled merchandise orders by stage, for
// staff with merchandise:fulfil. To prepare and Ready list oldest first.
export default async function PickupsPage({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string; cursor?: string; direction?: string; done?: string }> }) {
  const organisation = await requireManagementPage("merchandise:fulfil", "/dashboard/merchandise/pickups");
  const params = await searchParams;
  const stage = pickupStages.find((name) => name === params.stage) ?? "prepare";
  const query = params.q?.trim().slice(0, 100) ?? "";
  const cursor = params.cursor?.slice(0, 500) || undefined;
  const direction = params.direction === "prev" ? "prev" : "next";
  const [{ timeZone, pickupPolicy }, toPrepare, done] = await Promise.all([
    pickupSettings(organisation.id),
    toPrepareCount(organisation.id),
    params.done ? pickupResult(organisation.id, params.done.slice(0, 40)) : null
  ]);

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader title="Merchandise" />
      <LinkTabs
        label="Merchandise sections"
        tabs={[
          ...(hasOrganisationPermission(organisation.staffRole, "merchandise:manage") ? [{ href: "/dashboard/merchandise", label: "Products", active: false }] : []),
          { href: "/dashboard/merchandise/pickups", label: toPrepare ? `Pickups · ${toPrepare} to prepare` : "Pickups", active: true }
        ]}
      />
      {done ? (
        <Notice reveal role="status" title={done.collected ? "Collected" : "Ready to collect"} tone="success">
          <p className="mt-0.5">
            {done.collected
              ? `Order ${done.reference} was handed over by ${done.by} at ${formatDateTime(done.at, { timeZone })}.`
              : `Order ${done.reference} is on the Ready tab. ${done.buyer} was emailed.`}
          </p>
        </Notice>
      ) : null}
      <Suspense fallback={<ListSkeleton label="Loading pickups" />}>
        <Pickups cursor={cursor} direction={direction} organisationId={organisation.id} orgSlug={organisation.slug} query={query} stage={stage} timeZone={timeZone} />
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

async function Pickups({ organisationId, orgSlug, stage, query, cursor, direction, timeZone }: { organisationId: string; orgSlug: string; stage: PickupStage; query: string; cursor?: string; direction: "next" | "prev"; timeZone: string }) {
  const { orders, counts, nextCursor, previousCursor } = await listPickups(organisationId, { stage, query, cursor, direction });
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
  const dated = (order: PickupRow) =>
    stage === "review" ? "Don't hand this over yet." : stage !== "prepare" && order.step ? `${when(order.step.at)}${stage === "collected" ? ` by ${order.step.by}` : ""}` : when(order.createdAt);
  const action = (order: PickupRow, wide = false) =>
    working ? (
      <PickupAction after={href(stage, query, cursor, direction, order.id)} order={order} orgSlug={orgSlug} stage={stage} step={stage === "prepare" ? "ready" : "collected"} wide={wide} />
    ) : stage === "collected" ? (
      <StatusBadge status="collected" />
    ) : null;

  return (
    <>
      <nav aria-label="Pickup stages" className="flex gap-2 overflow-x-auto pb-0.5 sm:flex-wrap">
        {pickupStages.map((name) => (
          <Link
            aria-current={name === stage ? "page" : undefined}
            className={`shrink-0 ${pillClasses(name === stage)}`}
            href={href(name, query)}
            key={name}
          >
            {stageLabels[name]} <Count active={name === stage} value={counts[name]} />
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
        <ResponsiveTable
          card={(order) => (
            <div className="grid gap-2.5">
              <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">
                <Link className="text-brand underline underline-offset-4" href={`/dashboard/merchandise/orders/${order.id}`}>
                  {order.reference}
                </Link>{" "}
                · {order.buyer}
              </h2>
              <div className="text-ui text-ink">{items(order)}</div>
              <p className={`text-sm ${stage === "review" ? "font-semibold text-warning" : "text-ink-soft"}`}>
                {order.guest ? "Guest · " : ""}
                {status(order)}
              </p>
              {working ? action(order, true) : null}
            </div>
          )}
          columns={[
            {
              header: "Order",
              className: "font-semibold",
              cell: (order) => (
                <Link aria-label={`Open order ${order.reference}`} className="text-brand underline underline-offset-4" href={`/dashboard/merchandise/orders/${order.id}`}>
                  {order.reference}
                </Link>
              )
            },
            {
              header: "Buyer",
              cell: (order) => (
                <>
                  <span className="[overflow-wrap:anywhere]">{order.buyer}</span>
                  <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                    {order.guest ? "Guest · " : ""}
                    {order.buyerEmailSnapshot}
                  </p>
                </>
              )
            },
            { header: "Items", cell: items },
            { header: "Payment", cell: (order) => <StatusBadge status={stage === "review" ? "review" : order.paymentKind === "free" ? "free" : "paid"} /> },
            { header: dateHeading[stage], className: "text-sm text-ink-soft", cell: dated },
            { header: "Action", cell: (order) => <div className="flex justify-end">{action(order)}</div> }
          ]}
          label={`${stageLabels[stage]} orders`}
          rowKey={(order) => order.id}
          rows={orders}
        />
      )}
      <p className="text-sm text-ink-soft">
        {stage === "prepare" || stage === "ready" ? "Oldest first, in the order they came in. " : "Newest first. "}Only paid and free orders appear here; checkouts still waiting on Stripe don&apos;t.
      </p>
      <Pager label="Pickup pages" next={nextCursor && href(stage, query, nextCursor)} previous={previousCursor && href(stage, query, previousCursor, "prev")} />
    </>
  );
}
