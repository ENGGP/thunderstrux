import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { MerchandiseMoneyActions, RecordReturn } from "@/components/merchandise/order-actions";
import { PickupAction } from "@/components/merchandise/pickup-action";
import { Notice } from "@/components/ui/notice";
import { StripeReviewNotice } from "@/components/commerce/stripe-review-notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatDateTime, formatMoney, formatPrice } from "@/lib/format";
import { staffMerchandiseOrder, type StaffMerchandiseOrder } from "@/lib/merchandise/after-sale";
import { pickupSettings } from "@/lib/merchandise/pickups";
import { hasOrganisationPermission } from "@/lib/permissions";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";

export const metadata: Metadata = { title: "Merchandise order" };

const happened: Partial<Record<string, string>> = {
  order_created: "Checkout started",
  payment_fulfilled: "Payment confirmed by Stripe",
  free_fulfilled: "Free order confirmed",
  order_failed: "Checkout didn't complete",
  order_expired: "Checkout expired",
  compensation_required: "Payment held for review",
  free_cancelled: "Cancelled",
  refund_requested: "Refund requested",
  refund_pending: "Refund processing at Stripe",
  refunded: "Refunded",
  refund_failed: "Stripe turned the refund down",
  pickup_ready: "Marked ready to collect",
  pickup_collected: "Handed over",
  return_recorded: "Return recorded",
  dispute_funds_recovered: "Lost dispute taken back from the society"
};
const pickupBadge = { pending: "preparing", ready: "ready-to-collect", collected: "collected" } as const;
const name = (person: { firstName: string | null; lastName: string | null; email: string } | null) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email : null;

function Card({ title, id, action, children }: { title: string; id: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid content-start gap-3.5 rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-ink" id={id}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// One merchandise order for staff (T28b, design round B2, MerchOrderB2), from
// Pickups (merchandise:fulfil) or Orders (orders:read, T29b):
// items, pickup, history, buyer, money and returns. Pickup steps and returns
// need merchandise:fulfil; refunds and free cancellation need orders:refund;
// the fee needs orders:read. Unified Orders (T29) will link here too.
export default async function MerchandiseOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const organisation = await requireManagementPage(["merchandise:fulfil", "orders:read"], `/dashboard/merchandise/orders/${orderId}`);
  const [order, { timeZone }] = await Promise.all([staffMerchandiseOrder(organisation.id, orderId), pickupSettings(organisation.id)]);
  if (!order) notFound();
  const when = (date: Date) => formatDateTime(date, { timeZone });
  const can = (permission: Parameters<typeof hasOrganisationPermission>[1]) => hasOrganisationPermission(organisation.staffRole, permission);
  const buyer = order.buyerNameSnapshot || order.buyerEmailSnapshot;
  const free = order.paymentKind === "free";
  const open = order.status === "paid" && !order.requiresCompensationReview && !order.refundStatus && !order.disputeStatus && !order.cancelledAt;
  const step = order.pickupStatus === "pending" ? "ready" : order.pickupStatus === "ready" ? "collected" : null;
  const refund = order.refundRequests[0];
  const lineLabel = (line: StaffMerchandiseOrder["lines"][number]) => `${line.nameSnapshot}${line.variantSnapshot ? ` · ${line.variantSnapshot}` : ""}`;
  const here = `/dashboard/merchandise/orders/${order.id}`;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="grid gap-5">
        <PageHeader
          badge={
            <span className="flex flex-wrap gap-2">
              <StatusBadge status={ticketOrderProjection(order)} />
              {order.pickupStatus && !order.refundStatus && !order.cancelledAt ? <StatusBadge status={pickupBadge[order.pickupStatus]} /> : order.pickupStatus === "collected" ? <StatusBadge status="collected" /> : null}
            </span>
          }
          breadcrumbs={
            can("merchandise:fulfil")
              ? [{ label: "Merchandise", href: "/dashboard/merchandise" }, { label: "Pickups", href: "/dashboard/merchandise/pickups" }]
              : [{ label: "Orders", href: "/dashboard/orders?family=merchandise" }]
          }
          title={`Order ${order.reference}`}
        />

        {order.refundStatus === "processing" ? (
          <Notice role="status" title="Refund processing">
            <p className="mt-0.5">Stripe has the refund for {formatMoney(order.totalAmount)}. The pickup stays on hold until Stripe confirms it.</p>
          </Notice>
        ) : order.refundStatus === "refunded" && refund ? (
          <Notice title="Refunded">
            <p className="mt-0.5">
              {formatMoney(refund.amount)} was refunded on {when(refund.resolvedAt ?? refund.createdAt)}
              {name(refund.actor) ? ` by ${name(refund.actor)}` : ""}: &ldquo;{refund.reason}&rdquo;.{" "}
              {order.pickupStatus === "collected" ? "It had been collected; record a return if the items come back." : "The pickup was cancelled."}
            </p>
          </Notice>
        ) : refund?.status === "failed" && !order.refundStatus ? (
          <Notice title="Couldn't refund" tone="danger">
            <p className="mt-0.5">Stripe turned the refund down. Nothing was refunded and the order is unchanged.</p>
          </Notice>
        ) : order.cancelledAt ? (
          <Notice title="Cancelled">
            <p className="mt-0.5">
              This free order was cancelled on {when(order.cancelledAt)}: &ldquo;{order.cancellationReason}&rdquo;. There&apos;s nothing to collect.
            </p>
          </Notice>
        ) : order.requiresCompensationReview ? (
          <Notice title="Payment review" tone="warning">
            <p className="mt-0.5">Don&apos;t hand this over. Stripe took a payment that couldn&apos;t be filled ({order.reviewReason ?? "under review"}). Thunderstrux refunds it in full and emails the buyer; if Stripe refuses, finance sorts it out in Stripe.</p>
          </Notice>
        ) : null}
        <StripeReviewNotice canAct={can("orders:refund")} kind="merchandise" orderId={order.id} review={{ ...order, dispute: order.disputes[0] ?? null }} timeZone={timeZone} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-5">
            <Card id="items-heading" title="Items">
              <ul className="grid gap-2.5 text-ui">
                {order.lines.map((line) => (
                  <li className="flex items-start justify-between gap-3" key={line.id}>
                    <span className="grid">
                      <span className="text-ink [overflow-wrap:anywhere]">
                        {line.quantity} × {line.nameSnapshot}
                      </span>
                      <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                        {[line.variantSnapshot, line.merchandiseVariant?.sku, line.unitAmount ? `${formatMoney(line.unitAmount)} each` : null].filter(Boolean).join(" · ")}
                        {line.returned ? ` · ${line.returned} returned` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums text-ink">{formatPrice(line.lineAmount)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex justify-between gap-3 border-t border-line pt-3 font-semibold tabular-nums text-ink">
                <span>{free ? "Total" : "Total paid"}</span>
                <span>{formatPrice(order.totalAmount)}</span>
              </p>
              {can("orders:read") && !free ? (
                <p className="text-sm text-ink-soft">
                  Thunderstrux fee {formatMoney(order.feeAmount)}. Your society receives {formatMoney(order.totalAmount - order.feeAmount)}; the fee includes card processing. Names and prices are as bought.
                </p>
              ) : (
                <p className="text-sm text-ink-soft">Names and prices are as bought.</p>
              )}
            </Card>

            <Card
              action={open && step && can("merchandise:fulfil") ? <PickupAction after={here} order={{ ...order, buyer }} orgSlug={organisation.slug} stage={step === "ready" ? "prepare" : "ready"} step={step} /> : null}
              id="pickup-heading"
              title="Pickup"
            >
              {order.pickupStatus ? (
                <ol className="flex flex-wrap gap-x-7 gap-y-2 text-ui">
                  {(["pending", "ready", "collected"] as const).map((state, index) => (
                    <li className={state === order.pickupStatus ? "font-semibold text-brand-ink" : "text-ink-soft"} key={state}>
                      {index + 1}. {{ pending: "Preparing", ready: "Ready to collect", collected: "Collected" }[state]}
                    </li>
                  ))}
                </ol>
              ) : null}
              {open && step && can("merchandise:fulfil") ? (
                <p className="text-sm text-ink-soft">{step === "ready" ? `Mark ready emails ${buyer} that it's ready, with your pickup details.` : "Mark collected records who handed it over, and when."}</p>
              ) : (
                <p className="text-sm text-ink-soft">
                  {order.pickupStatus === "collected" ? "Handed over. Record a return below if anything comes back." : open ? "Nothing to do." : "Not for pickup: this order isn't being handed over."}
                </p>
              )}
            </Card>

            <Card id="history-heading" title="What happened">
              <ul className="grid gap-2.5 text-ui">
                {[...order.lifecycleEvents].reverse().filter((event) => happened[event.type]).map((event) => (
                  <li className="[overflow-wrap:anywhere]" key={event.sequence}>
                    <strong>{happened[event.type]}</strong>{" "}
                    <span className="text-sm text-ink-soft">
                      {when(event.createdAt)}
                      {name(event.actor) ? ` · ${name(event.actor)}` : ""}
                      {event.reason && event.type !== "compensation_required" ? ` · “${event.reason}”` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-5">
            <Card id="buyer-heading" title="Buyer">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-ui">
                <dt className="text-ink-soft">Name</dt>
                <dd className="[overflow-wrap:anywhere]">{order.buyerNameSnapshot ?? "Not given"}</dd>
                <dt className="text-ink-soft">Email</dt>
                <dd className="[overflow-wrap:anywhere]">{order.buyerEmailSnapshot}</dd>
                <dt className="text-ink-soft">Account</dt>
                <dd>{order.guestIdentityId ? "Guest" : "Member account"}</dd>
                <dt className="text-ink-soft">Ordered</dt>
                <dd>{when(order.createdAt)}</dd>
              </dl>
            </Card>

            <Card id="money-heading" title="Money">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-ui">
                <dt className="text-ink-soft">Paid</dt>
                <dd>{free ? "Nothing, it was free" : `${formatMoney(order.totalAmount)} by card, through Stripe`}</dd>
                <dt className="text-ink-soft">Refunded</dt>
                <dd>{order.refundStatus === "refunded" ? formatMoney(order.totalAmount) : order.refundStatus === "processing" ? "Processing" : order.externalRefundedAmount ? `${formatMoney(order.externalRefundedAmount)} in Stripe` : "Nothing"}</dd>
              </dl>
              {can("orders:refund") && open && !free ? (
                <MerchandiseMoneyActions action="refund" amount={formatMoney(order.totalAmount - order.externalRefundedAmount)} buyer={buyer} needsCode={mfaEnforcementMode() !== "off"} orderId={order.id} orgSlug={organisation.slug} reference={order.reference} />
              ) : null}
              {can("orders:refund") && open && free && order.pickupStatus !== "collected" ? (
                <MerchandiseMoneyActions action="cancel" amount="Free" buyer={buyer} needsCode={mfaEnforcementMode() !== "off"} orderId={order.id} orgSlug={organisation.slug} reference={order.reference} />
              ) : null}
              <p className="text-sm text-ink-soft">Owners, admins and finance managers. A refund doesn&apos;t record a return.</p>
            </Card>

            <Card id="returns-heading" title="Returns">
              {order.merchandiseReturns.length ? (
                <ul className="grid gap-2 text-ui">
                  {order.merchandiseReturns.map((row) => {
                    const line = order.lines.find((item) => item.id === row.commerceOrderLineId);
                    return (
                      <li className="[overflow-wrap:anywhere]" key={row.id}>
                        {row.quantity} × {line ? lineLabel(line) : "item"} came back on {when(row.createdAt)}. {row.restocked ? "Restocked" : "Not restocked"}: &ldquo;{row.reason}&rdquo;
                        {name(row.actor) ? <span className="text-sm text-ink-soft"> · {name(row.actor)}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">Nothing returned. Record a return when an item comes back, then decide whether to put it back in stock.</p>
              )}
              {order.status === "paid" && can("merchandise:fulfil") ? (
                <RecordReturn
                  lines={order.lines.map((line) => ({ id: line.id, label: lineLabel(line), bought: line.quantity, returned: line.returned, remaining: line.merchandiseVariant?.remaining ?? null }))}
                  orderId={order.id}
                  orgSlug={organisation.slug}
                  reference={order.reference}
                />
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
