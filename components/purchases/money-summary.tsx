import { formatMoney, formatPrice } from "@/lib/format";

// Lines and a total for a review or receipt. Amounts are integer AUD cents; a
// zero total reads "Free" and never mentions fees.
export function MoneySummary({
  lines,
  note
}: {
  lines: Array<{ label: string; quantity: number; unitPrice: number }>;
  note?: string;
}) {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  return (
    <div className="grid gap-3 text-[15px]">
      <dl className="grid gap-3">
        {lines.map((line) => (
          <div className="flex items-start justify-between gap-4" key={line.label}>
            <dt className="grid">
              <span className="font-semibold text-ink [overflow-wrap:anywhere]">
                {line.quantity} × {line.label}
              </span>
              {line.unitPrice > 0 && line.quantity > 1 ? (
                <span className="text-sm text-ink-soft">{formatMoney(line.unitPrice)} each</span>
              ) : null}
            </dt>
            <dd className="tabular-nums text-ink">{formatPrice(line.quantity * line.unitPrice)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">
            {total === 0 ? "Free" : `${formatMoney(total)} AUD`}
          </dd>
        </div>
      </dl>
      {note ? <p className="text-sm text-ink-soft">{note}</p> : null}
    </div>
  );
}
