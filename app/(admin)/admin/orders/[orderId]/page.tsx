import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { IdChip } from "@/components/admin/id-chip";
import { RememberRecord } from "@/components/admin/omnibox";
import { ActivityList, AdminTime, AttentionStrip, Breadcrumbs, Facts, Panel, RecordHeader, rowLink, tableClass } from "@/components/admin/record";
import { LinkTabs } from "@/components/ui/link-tabs";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { formatMoney, orderReference } from "@/lib/format";
import { recordPlatformView } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { readOrderRecord } from "@/lib/platform/records";

export const metadata: Metadata = { title: "Admin order" };

const tabs = ["overview", "activity"] as const;
const stripePaymentLink = (paymentIntent: string) => `https://dashboard.stripe.com/payments/${encodeURIComponent(paymentIntent)}`;
const orderStatus = (status: string): Status => (status === "paid" ? "paid" : status === "failed" ? "failed" : status === "expired" ? "expired" : "pending");
const personName = (user: { firstName: string | null; lastName: string | null; displayName: string | null; email: string }) =>
  user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

// T54 (board H6): one ticket, membership or shop order, read-only. Money moves in
// Stripe or on the society's own page, never here.
export default async function AdminOrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { orderId } = await params;
  const path = `/admin/orders/${encodeURIComponent(orderId)}`;
  const actor = await requirePlatformPage("platform:read", path);
  const record = await readOrderRecord(orderId);
  if (!record) notFound();
  const { order, society, activity, attention } = record;
  await recordPlatformView(actor, { type: record.family === "ticket" ? "Order" : "CommerceOrder", id: orderId, organisationId: society.id });
  const requested = (await searchParams).tab;
  const tab = tabs.find((name) => name === requested) ?? "overview";
  const zone = society.timeZone;
  const reference = orderReference(order.id);
  const kind = record.family === "ticket" ? "Ticket order" : record.order.kind === "membership" ? "Membership order" : "Merchandise order";
  const buyer = order.user
    ? <Link className={rowLink} href={`/admin/users/${order.user.id}`}>{personName(order.user)}</Link>
    : <span>{order.buyerEmailSnapshot ?? "Guest"}{record.family === "ticket" && record.order.guestIdentity ? " · guest" : ""}</span>;
  return (
    <AdminShell actor={actor} current="orders">
      <RememberRecord href={path} kind="Order" label={`${reference} · ${society.name}`} />
      <Breadcrumbs items={[{ label: "Orders", href: "/admin/orders" }, { label: reference }]} />
      <RecordHeader
        actions={order.stripePaymentIntentId ? <a className="inline-flex min-h-[38px] items-center rounded-[8px] border border-line-strong bg-surface px-3.5 font-semibold" href={stripePaymentLink(order.stripePaymentIntentId)} rel="noreferrer" target="_blank">Payment in Stripe</a> : null}
        badges={<>
          <StatusBadge status={orderStatus(order.status)} />
          {order.cancelledAt ? <StatusBadge status="cancelled" /> : null}
          {order.refundStatus === "refunded" ? <StatusBadge status="refunded" /> : order.refundStatus === "processing" ? <StatusBadge status="refund-processing" /> : null}
          {order.disputeStatus === "open" ? <StatusBadge status="disputed" /> : null}
          {record.family === "ticket" && record.order.requiresCompensationReview ? <StatusBadge status="review" /> : null}
        </>}
        facts={[
          <Link className={rowLink} href={`/admin/societies/${society.id}`} key="s">{society.name}</Link>,
          record.family === "ticket" ? record.order.event.title : `${record.order.lines.length} ${record.order.lines.length === 1 ? "line" : "lines"}`,
          formatMoney(order.totalAmount),
          order.paidAt ? <>Paid <AdminTime key="p" timeZone={zone} value={order.paidAt} /></> : <>Created <AdminTime key="c" timeZone={zone} value={order.createdAt} /></>
        ]}
        ids={<IdChip label="order id" value={order.id} />}
        title={`Order ${reference}`}
        type={kind}
      />
      <AttentionStrip items={attention} />
      <LinkTabs label="Record sections" tabs={[
        { href: path, label: "Overview", active: tab === "overview" },
        { href: `${path}?tab=activity`, label: "Activity", active: tab === "activity", count: activity.length }
      ]} />
      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-[18px]">
            <Panel note="As it was at checkout" title="Purchase">
              <Facts rows={[
                ["Buyer", buyer],
                ...(record.family === "ticket"
                  ? [["Ticket type", `${record.order.purchasedTicketTypeName ?? "—"} · ${formatMoney(record.order.unitPrice)} each`], ["Quantity", String(record.order.quantity)]] as Array<[string, string]>
                  : record.order.lines.map((line): [string, string] => [`Line ${line.lineNumber}`, `${line.quantity} × ${line.nameSnapshot} · ${formatMoney(line.lineAmount)}`])),
                ["Total", formatMoney(order.totalAmount)],
                ["Thunderstrux fee", order.feeAmount === null ? "—" : formatMoney(order.feeAmount)],
                ["Payment", order.paymentKind === "free" ? "Free" : "Stripe"]
              ]} />
            </Panel>
            <Panel note="Stripe is the truth for money" title="Stripe">
              <Facts rows={[
                ["Checkout Session", order.stripeSessionId ? <IdChip key="cs" label="Checkout Session id" value={order.stripeSessionId} /> : "—"],
                ["PaymentIntent", order.stripePaymentIntentId ? <IdChip key="pi" label="PaymentIntent id" value={order.stripePaymentIntentId} /> : "—"],
                ...order.disputes.map((dispute): [string, ReactNode] => ["Dispute", <><IdChip key={dispute.stripeDisputeId} label="dispute id" value={dispute.stripeDisputeId} /><span className="text-ink-muted">{[dispute.reason, dispute.providerStatus].filter(Boolean).join(" · ")}</span></>]),
                ...order.refundRequests.map((refund): [string, ReactNode] => ["Refund", <>{refund.stripeRefundId ? <IdChip key={refund.id} label="refund id" value={refund.stripeRefundId} /> : null}<span className="text-ink-muted">{formatMoney(refund.amount)} · {refund.status}</span></>]),
                ["Last asked Stripe", <AdminTime key="k" timeZone={zone} value={order.stripeCheckedAt} />]
              ]} />
            </Panel>
          </div>
          {record.family === "ticket" ? (
            <Panel title="Tickets">
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr><th scope="col">Ticket</th><th scope="col">Valid</th><th scope="col">Checked in</th></tr></thead>
                  <tbody>
                    {record.order.tickets.map((ticket) => (
                      <tr key={ticket.id}>
                        <td className="font-mono">#{ticket.issueSequence}</td>
                        <td><StatusBadge status={ticket.validity === "active" ? "valid" : ticket.validity === "void" ? "void" : "under-review"} /></td>
                        <td>{ticket.checkedInAt ? <AdminTime timeZone={zone} value={ticket.checkedInAt} /> : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
          <p className="text-sm text-ink-soft">No refund or cancel button here on purpose: money moves in Stripe or on the society's own order page.</p>
        </>
      ) : (
        <Panel note="The order's lifecycle, with each row's source" title="Activity">
          <ActivityList rows={activity} timeZone={zone} />
        </Panel>
      )}
    </AdminShell>
  );
}
