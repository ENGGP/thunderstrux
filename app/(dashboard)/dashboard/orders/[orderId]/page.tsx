import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { OrderDetailActions } from "@/components/orders/order-detail-actions";
import {
  requireCurrentOrganisationAccount,
  requireOrganisationFinanceAccess
} from "@/lib/auth/access";
import {
  OrganisationOrderAccessError,
  getOrganisationOrderDetail
} from "@/lib/orders/order-detail";

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(value);
}

function statusLabel(status: "pending" | "paid" | "failed" | "expired") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buyerName(user: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  if (user.displayName) {
    return user.displayName;
  }

  return [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
}

export default async function OrganisationOrderDetailPage({
  params
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const organisation = await requireCurrentOrganisationAccount();
  await requireOrganisationFinanceAccess(organisation.id);

  let order: Awaited<ReturnType<typeof getOrganisationOrderDetail>>;

  try {
    order = await getOrganisationOrderDetail(organisation.id, orderId);
  } catch (error) {
    if (error instanceof OrganisationOrderAccessError) {
      notFound();
    }

    throw error;
  }

  const buyer = order.user
    ? {
        email: order.user.email,
        name: buyerName(order.user)
      }
    : null;

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              className="text-sm font-medium text-neutral-600 hover:text-neutral-950"
              href="/dashboard/orders"
            >
              Back to orders
            </Link>
            <h2 className="mt-2 text-3xl font-semibold text-neutral-950">
              Order detail
            </h2>
          </div>
          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm font-medium text-neutral-700">
            {statusLabel(order.status)}
          </span>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-sm text-neutral-500">Order ID</p>
              <p className="mt-1 break-all text-sm font-medium text-neutral-950">
                {order.id}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-500">Created</p>
              <p className="mt-1 text-sm text-neutral-950">
                {formatDateTime(order.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-500">Paid</p>
              <p className="mt-1 text-sm text-neutral-950">
                {formatDateTime(order.paidAt)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-500">Buyer</p>
              <p className="mt-1 text-sm text-neutral-950">
                {buyer?.email ?? "Unknown buyer"}
              </p>
              {buyer?.name ? (
                <p className="mt-1 text-sm text-neutral-600">{buyer.name}</p>
              ) : null}
            </div>
            <div>
              <p className="text-sm text-neutral-500">Event</p>
              <Link
                className="mt-1 inline-block text-sm font-medium text-neutral-950 hover:text-neutral-700"
                href={`/dashboard/events/${order.event.id}`}
              >
                {order.event.title}
              </Link>
            </div>
            <div>
              <p className="text-sm text-neutral-500">Total amount</p>
              <p className="mt-1 text-sm font-medium text-neutral-950">
                {formatCurrency(order.totalAmount)}
              </p>
            </div>
          </div>
          {order.isManuallyRefunded ? (
            <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This order is marked as manually refunded.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-neutral-950">Tickets</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="py-3 pr-4 font-medium">Ticket type</th>
                  <th className="py-3 pr-4 font-medium">Quantity</th>
                  <th className="py-3 pr-4 font-medium">Unit price</th>
                  <th className="py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-3 pr-4 text-neutral-700">
                    {order.ticketType.name}
                  </td>
                  <td className="py-3 pr-4 text-neutral-700">{order.quantity}</td>
                  <td className="py-3 pr-4 text-neutral-700">
                    {formatCurrency(order.unitPrice)}
                  </td>
                  <td className="py-3 text-neutral-700">
                    {formatCurrency(order.totalAmount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div>
            <h3 className="text-lg font-semibold text-neutral-950">Management</h3>
            <p className="mt-1 text-sm text-neutral-600">
              These actions do not change Stripe payment state.
            </p>
          </div>
          <OrderDetailActions
            canResendTickets={order.tickets.length > 0}
            isManuallyRefunded={order.isManuallyRefunded}
            orderId={order.id}
            stripeSessionId={order.stripeSessionId}
          />
          <div className="rounded-lg border border-neutral-200 p-4">
            <p className="text-sm text-neutral-500">Stripe session ID</p>
            <p className="mt-1 break-all text-sm text-neutral-950">
              {order.stripeSessionId ?? "Not available"}
            </p>
            {order.stripeDashboardUrl ? (
              <a
                className="mt-3 inline-block text-sm font-medium text-neutral-700 hover:text-neutral-950"
                href={order.stripeDashboardUrl}
                rel="noreferrer"
                target="_blank"
              >
                View Stripe session
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
