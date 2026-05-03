import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { TicketCheckInButton } from "@/components/tickets/ticket-check-in-button";
import {
  OrganisationAccessError,
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  OrganisationEventTicketsAccessError,
  getOrganisationEventTickets
} from "@/lib/tickets/check-in";

type OrganiserEventTicketsPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

function statusBadgeClassName(status: "unused" | "checked-in") {
  return status === "checked-in"
    ? "rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200"
    : "rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200";
}

function buyerLabel(email: string | null, name: string | null) {
  if (email && name) {
    return `${name} (${email})`;
  }

  return name ?? email ?? "Unknown buyer";
}

export default async function OrganiserEventTicketsPage({
  params
}: OrganiserEventTicketsPageProps) {
  const { eventId } = await params;
  let organisation: Awaited<ReturnType<typeof requireCurrentOrganisationAccount>>;

  try {
    organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      redirect("/");
    }

    throw error;
  }

  let payload: Awaited<ReturnType<typeof getOrganisationEventTickets>>;

  try {
    payload = await getOrganisationEventTickets(organisation.id, eventId);
  } catch (error) {
    if (error instanceof OrganisationEventTicketsAccessError) {
      notFound();
    }

    throw error;
  }

  const checkedInCount = payload.tickets.filter(
    (ticket) => ticket.status === "checked-in"
  ).length;
  const unusedCount = payload.tickets.length - checkedInCount;

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-500">Tickets</p>
              <h2 className="mt-2 text-3xl font-semibold text-neutral-950">
                {payload.event.title}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                href={`/dashboard/events/${payload.event.id}`}
              >
                Back to event
              </Link>
              <Link
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                href={`/dashboard/orders?eventId=${payload.event.id}`}
              >
                View orders
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Total tickets</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {payload.tickets.length}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Unused</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {unusedCount}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Checked in</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {checkedInCount}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          {payload.tickets.length === 0 ? (
            <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-5 text-sm text-neutral-600">
              No issued tickets yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500">
                    <th className="py-3 pr-4 font-medium">Ticket ID</th>
                    <th className="py-3 pr-4 font-medium">Buyer</th>
                    <th className="py-3 pr-4 font-medium">Ticket type</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 pr-4 font-medium">Created</th>
                    <th className="py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.tickets.map((ticket) => (
                    <tr
                      className="border-b border-neutral-100 align-top last:border-0"
                      key={ticket.id}
                    >
                      <td className="max-w-56 break-all py-3 pr-4 font-mono text-xs text-neutral-700">
                        {ticket.id}
                      </td>
                      <td className="py-3 pr-4 text-neutral-700">
                        {buyerLabel(ticket.buyerEmail, ticket.buyerName)}
                      </td>
                      <td className="py-3 pr-4 text-neutral-700">
                        {ticket.ticketTypeName}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={statusBadgeClassName(ticket.status)}>
                          {ticket.status === "checked-in" ? "Checked in" : "Unused"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-neutral-700">
                        {formatDateTime(ticket.createdAt)}
                      </td>
                      <td className="py-3">
                        <TicketCheckInButton
                          initialCheckedInAt={
                            ticket.checkedInAt ? ticket.checkedInAt.toISOString() : null
                          }
                          ticketId={ticket.id}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
