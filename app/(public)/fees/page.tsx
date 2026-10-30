import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/components/public/policy-page";
import { formatMoney } from "@/lib/format";
import { calculatePlatformFee } from "@/lib/stripe/fees";

export const metadata: Metadata = { title: "Fees" };

// Worked from the fee function checkout uses, so the page can't drift from it.
const examples = [
  { label: "One $5.00 ticket", total: 500, items: 1 },
  { label: "Two $12.00 tickets", total: 2400, items: 2 },
  { label: "A $25.00 membership", total: 2500, items: 1 },
  { label: "Merchandise order of $55.00", total: 5500, items: 1 }
].map((example) => ({ ...example, fee: calculatePlatformFee(example.total, example.items) }));

export default function FeesPage() {
  return (
    <PolicyPage
      lead="Thunderstrux takes one fee from each paid sale: 3.75% plus $0.89 for each ticket, membership or merchandise order. Card processing is included, so the society receives the rest."
      title="Fees"
    >
      <PolicySection title="What buyers pay">
        <p>The price the society sets, in Australian dollars. Nothing is added at checkout.</p>
      </PolicySection>
      <PolicySection title="Examples">
        {/* Phones get one card per example (design round D1); wider screens the table. */}
        <ul className="grid gap-3 sm:hidden">
          {examples.map((example) => (
            <li className="rounded-card border border-line bg-surface px-4 py-3.5" key={example.label}>
              <p className="font-semibold text-ink">{example.label}</p>
              <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-ui tabular-nums">
                <dt>Buyer pays</dt>
                <dd className="text-right">{formatMoney(example.total)}</dd>
                <dt>Thunderstrux keeps</dt>
                <dd className="text-right">{formatMoney(example.fee)}</dd>
                <dt className="font-semibold text-ink">Society receives</dt>
                <dd className="text-right font-semibold text-ink">{formatMoney(example.total - example.fee)}</dd>
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-card border border-line bg-surface sm:block">
          <table className="w-full border-collapse text-ui tabular-nums">
            <thead>
              <tr className="border-b border-line text-left text-sm text-ink-soft">
                <th className="px-4 py-2.5 font-semibold" scope="col">Order</th>
                <th className="px-4 py-2.5 text-right font-semibold" scope="col">Buyer pays</th>
                <th className="px-4 py-2.5 text-right font-semibold" scope="col">Thunderstrux keeps</th>
                <th className="px-4 py-2.5 text-right font-semibold" scope="col">Society receives</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((example) => (
                <tr className="border-b border-line last:border-0" key={example.label}>
                  <th className="px-4 py-3 text-left font-medium text-ink" scope="row">{example.label}</th>
                  <td className="px-4 py-3 text-right">{formatMoney(example.total)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(example.fee)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{formatMoney(example.total - example.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm">The percentage is worked out once per order and rounded to the cent. The fee never exceeds the price, and it includes GST where GST applies. Each order keeps the fee it was sold under.</p>
      </PolicySection>
      <PolicySection title="Free is free">
        <p>Free tickets, free memberships and free merchandise have no fee, and a society doesn&apos;t need to set up payments to offer them.</p>
      </PolicySection>
      <PolicySection title="Refunds">
        <p>A society can refund a whole paid order or just some of its tickets, in full or in part. The refund goes back to the buyer&apos;s card and comes out of the society&apos;s Stripe balance. Thunderstrux returns its fee on the amount refunded, so the society gives back only what it received.</p>
      </PolicySection>
      <PolicySection title="How societies get paid">
        <p>Societies take payments through their own Stripe account, set up from Settings. Thunderstrux sends a society its ticket money 2 days after the event ends, and membership and merchandise money 7 days after the sale. Until then the money stays in the society&apos;s Stripe balance, so refunds for a cancelled event come out of money the society still has.</p>
      </PolicySection>
    </PolicyPage>
  );
}
