import Link from "next/link";
import { formatMoney, parseMoneyInput } from "@/lib/format";
import { calculatePlatformFee } from "@/lib/stripe/fees";

// What the society receives for one sale, with the same fee function checkout
// uses: one ticket, or one item on an order of its own. A bigger order is rounded
// once, so it can differ by a cent. Event and product forms both show it.
export function FeeHint({ price, chargesReady = true, unit = "ticket" }: { price: string; chargesReady?: boolean; unit?: "ticket" | "item" }) {
  const cents = parseMoneyInput(price);
  if (cents === null) return null;
  if (cents === 0) return <p className="text-sm text-ink-muted">Free. No fee and no payment setup needed.</p>;

  return (
    <p className="text-sm text-ink-muted">
      For one {unit === "ticket" ? "ticket" : "item ordered on its own"} you receive{" "}
      <strong className="font-semibold text-ink">{formatMoney(cents - calculatePlatformFee(cents))}</strong> after the Thunderstrux fee (3.75% plus
      $0.89 {unit === "ticket" ? "a ticket" : "an order"}), which includes card processing.
      {chargesReady ? null : (
        <>
          {" "}Paid tickets go on sale once you{" "}
          <Link className="font-semibold text-brand underline underline-offset-4" href="/dashboard/settings">
            set up payments
          </Link>
          .
        </>
      )}
    </p>
  );
}
