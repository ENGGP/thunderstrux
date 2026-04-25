import { notFound } from "next/navigation";
import {
  OrganisationAccessError,
  requireFinanceAccess,
  requireOrganisationMembershipBySlug
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

function statusLabel(status: "pending" | "paid" | "failed") {
  if (status === "paid") {
    return "Paid";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Pending";
}

export default async function OrganisationOrdersPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  let organisation: Awaited<ReturnType<typeof requireOrganisationMembershipBySlug>>;

  try {
    organisation = await requireOrganisationMembershipBySlug(orgSlug);
    await requireFinanceAccess(organisation.id);
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      notFound();
    }

    throw error;
  }

  const orders = await prisma.order.findMany({
    where: { organisationId: organisation.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      quantity: true,
      totalAmount: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      user: {
        select: {
          email: true
        }
      },
      event: {
        select: {
          title: true
        }
      },
      ticketType: {
        select: {
          name: true
        }
      }
    }
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-neutral-950">Orders</h2>
        <p className="text-sm text-neutral-600">
          Review ticket purchases and payment reconciliation for {organisation.name}.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        {orders.length === 0 ? (
          <p className="text-sm text-neutral-600">No orders have been placed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="py-3 pr-4 font-medium">Buyer</th>
                  <th className="py-3 pr-4 font-medium">Event</th>
                  <th className="py-3 pr-4 font-medium">Ticket</th>
                  <th className="py-3 pr-4 font-medium">Quantity</th>
                  <th className="py-3 pr-4 font-medium">Total</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 font-medium">Payment time</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    className="border-b border-neutral-100 last:border-0"
                    key={order.id}
                  >
                    <td className="py-3 pr-4 text-neutral-700">
                      {order.user?.email ?? "Unknown buyer"}
                    </td>
                    <td className="py-3 pr-4 font-medium text-neutral-950">
                      {order.event.title}
                    </td>
                    <td className="py-3 pr-4 text-neutral-700">
                      {order.ticketType.name}
                    </td>
                    <td className="py-3 pr-4 text-neutral-700">{order.quantity}</td>
                    <td className="py-3 pr-4 text-neutral-700">
                      {formatCurrency(order.totalAmount)}
                    </td>
                    <td className="py-3 pr-4 text-neutral-700">
                      {statusLabel(order.status)}
                      {order.failureReason ? (
                        <p className="mt-1 max-w-56 text-xs text-red-700">
                          {order.failureReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 text-neutral-700">
                      {formatDateTime(order.paidAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
