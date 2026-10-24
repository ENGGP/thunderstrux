import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";

// PAY-005, design round F1: what the society's Stripe balance is holding until
// its events end, what is on its way to the bank, and the latest payouts.
// Dates arrive as JSON strings.
export type PayoutSummaryView = {
  held: { events: { amount: number; eventCount: number; nextEndsAt: string | null }; commerce: { amount: number }; total: number };
  onTheWay: { amount: number; sentAt: string | null };
  recent: Array<{ id: string; amount: number; status: "pending" | "paid" | "failed"; createdAt: string }>;
  failed: { amount: number; createdAt: string } | null;
};

const badge: Record<PayoutSummaryView["recent"][number]["status"], [Status, string]> = {
  pending: ["pending", "On its way"],
  paid: ["paid", "Paid"],
  failed: ["failed", "Didn't go through"]
};

// A payout the bank refused: shown at the top of Payments.
export function PayoutFailedNotice({ failed, action }: { failed: NonNullable<PayoutSummaryView["failed"]>; action: ReactNode }) {
  return (
    <Notice title="Your bank didn't accept a payout" tone="warning">
      <p>
        Stripe couldn&apos;t pay {formatMoney(failed.amount)} into your bank account on {formatDate(failed.createdAt)}. The money is safe in
        your Stripe balance and goes with your next payout once your bank details are fixed.
      </p>
      <div className="mt-3">{action}</div>
    </Notice>
  );
}

function Figure({ label, amount, note }: { label: string; amount: number; note: string }) {
  return (
    <div className="grid content-start gap-1 rounded-control bg-surface-subtle px-4 py-4">
      <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular-nums text-ink">{formatMoney(amount)}</dd>
      <dd className="text-sm text-ink-soft">{note}</dd>
    </div>
  );
}

// Without a bank account, the Stripe account card above already offers to add one.
export function PayoutsCard({ payouts, payoutsEnabled, seeAll }: { payouts: PayoutSummaryView; payoutsEnabled: boolean; seeAll: ReactNode }) {
  const { events, commerce } = payouts.held;
  if (!payoutsEnabled) {
    return (
      <Card>
        <div className="grid gap-3">
          <h2 className="text-xl font-semibold text-ink">Payouts</h2>
          <p className="text-ui text-ink-soft">
            Add a bank account in Stripe and Thunderstrux sends your money as each event ends. Sales keep working meanwhile
            {payouts.held.total > 0 ? `; ${formatMoney(payouts.held.total)} is waiting` : ""}.
          </p>
        </div>
      </Card>
    );
  }
  const eventNote = events.eventCount === 0
    ? "No events waiting"
    : `${events.eventCount} ${events.eventCount === 1 ? "event" : "events"}${events.nextEndsAt ? `, the next ends ${formatDate(events.nextEndsAt)}` : ""}`;
  return (
    <Card>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold text-ink">Payouts</h2>
          <p className="text-ui text-ink-soft">
            Ticket money goes to your bank 2 days after each event ends. Membership and merchandise money goes 7 days after each sale.
            Until then it stays in your Stripe balance, so a refund for a cancelled event comes out of money you still have.
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <Figure amount={events.amount} label="Waiting for events to end" note={eventNote} />
          <Figure amount={commerce.amount} label="Memberships and merchandise" note="Sales from the last 7 days" />
          <Figure
            amount={payouts.onTheWay.amount}
            label="On its way to your bank"
            note={payouts.onTheWay.sentAt ? `Sent ${formatDate(payouts.onTheWay.sentAt)}, usually arrives in 2 business days` : "Nothing on its way"}
          />
        </dl>

        <div className="grid gap-2">
          <h3 className="text-base font-semibold text-ink">Recent payouts</h3>
          {payouts.recent.length === 0 ? (
            <p className="text-sm text-ink-soft">No payouts yet. The first goes out after your first paid event ends.</p>
          ) : (
            <table className="w-full border-collapse text-ui tabular-nums">
              <caption className="sr-only">Recent payouts to your bank</caption>
              <thead>
                <tr className="text-left text-sm text-ink-soft">
                  <th className="border-b border-line py-2 font-semibold" scope="col">Sent</th>
                  <th className="border-b border-line py-2 text-right font-semibold" scope="col">Amount</th>
                  <th className="border-b border-line py-2 pl-4 font-semibold" scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.recent.map((payout) => (
                  <tr key={payout.id}>
                    <td className="border-b border-line py-3">{formatDate(payout.createdAt)}</td>
                    <td className="border-b border-line py-3 text-right">{formatMoney(payout.amount)}</td>
                    <td className="border-b border-line py-3 pl-4"><StatusBadge label={badge[payout.status][1]} status={badge[payout.status][0]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {seeAll}
        </div>

        <p className="text-caption text-ink-muted">
          Stripe holds money for at most 90 days, so money from a sale made more than 80 days before its event is sent then. Money under an
          open dispute waits until the dispute closes.
        </p>
      </div>
    </Card>
  );
}
