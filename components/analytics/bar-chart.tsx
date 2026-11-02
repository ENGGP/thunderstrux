// One bar per bucket (round C1, T32): vertical bars from 768px, a horizontal
// list on phones. Its accessible name lists every value, so the picture never
// holds a number a screen reader can't reach.
export type ChartBar = { key: string; label: string; primary: number; secondary?: number; value: string; secondaryValue?: string };

// `below` hangs the secondary series under the axis (refunds against gross), so
// it reads as money going back rather than stacking onto the sales (UI-068).
// Without it the two series stack (new members and renewals).
export function BarChart({ label, bars, legend, below = false }: { label: string; bars: ChartBar[]; legend?: [string, string]; below?: boolean }) {
  const max = Math.max(1, ...bars.map((bar) => (below ? Math.max(bar.primary, bar.secondary ?? 0) : bar.primary + (bar.secondary ?? 0))));
  const height = (value: number) => `${Math.round((value / max) * 160)}px`;
  const deepest = below ? Math.max(0, ...bars.map((bar) => bar.secondary ?? 0)) : 0;
  // Labels for every bar up to 12, then every nth so they never collide.
  const step = Math.ceil(bars.length / 12);
  const name = `${label}: ${bars.map((bar) => `${bar.label} ${bar.value}${bar.secondaryValue && legend ? `, ${legend[1].toLowerCase()} ${bar.secondaryValue}` : ""}`).join(", ")}`;
  return (
    <div className="grid gap-3">
      {legend ? (
        <div aria-hidden="true" className="flex flex-wrap gap-4 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-2"><i className="size-3 rounded-[3px] bg-brand" />{legend[0]}</span>
          <span className="inline-flex items-center gap-2"><i className="size-3 rounded-[3px] bg-ink" />{legend[1]}{below ? " (below the line)" : ""}</span>
        </div>
      ) : null}
      <div className="hidden overflow-x-auto md:block">
        {below ? (
          <div aria-label={name} className="relative flex gap-2" role="img" style={{ minWidth: bars.length * 14 }}>
            {/* One axis across every bar: sales rise above it, refunds hang below. */}
            <div aria-hidden="true" className="absolute inset-x-0 border-t border-line" style={{ top: 192 }} />
            {bars.map((bar) => (
              <div className="flex min-w-0 flex-1 flex-col items-center" key={bar.key}>
                <div className="flex h-48 w-full flex-col items-center justify-end gap-1.5">
                  {bars.length <= 12 ? <span className="text-caption tabular-nums text-ink-soft">{bar.value}</span> : null}
                  <div className="w-full max-w-14 rounded-t-md bg-brand" style={{ height: height(bar.primary) }} />
                </div>
                <div className="flex w-full flex-col items-center pt-px" style={{ height: height(deepest) }}>
                  {bar.secondary ? <div className="w-full max-w-14 rounded-b-md bg-ink" style={{ height: height(bar.secondary) }} /> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div aria-label={name} className="flex h-56 items-end gap-2 border-b border-line pb-1" role="img" style={{ minWidth: bars.length * 14 }}>
            {bars.map((bar) => (
              <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5" key={bar.key}>
                {bars.length <= 12 ? <span className="text-caption tabular-nums text-ink-soft">{bar.value}</span> : null}
                <div className="flex w-full max-w-14 flex-col justify-end gap-0.5">
                  <div className="rounded-t-md bg-brand" style={{ height: height(bar.primary) }} />
                  {bar.secondary ? <div className="rounded-b-sm bg-ink" style={{ height: height(bar.secondary) }} /> : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <div aria-hidden="true" className="mt-2 flex gap-2" style={{ minWidth: bars.length * 14 }}>
          {bars.map((bar, index) => (
            <span className="min-w-0 flex-1 whitespace-nowrap text-center text-caption text-ink-soft" key={bar.key}>
              {index % step === 0 ? bar.label : ""}
            </span>
          ))}
        </div>
      </div>
      {/* Phones draw both series, so the legend never names a colour that isn't there. */}
      <div aria-label={name} className="grid gap-2.5 md:hidden" role="img">
        {bars.map((bar) => (
          <div className="grid grid-cols-[56px_1fr] items-center gap-2.5 text-sm" key={bar.key}>
            <span className="text-ink-soft">{bar.label}</span>
            <span className="grid gap-1">
              <span className="flex items-center gap-2">
                <i className="block h-4 rounded-r-md bg-brand" style={{ width: `${Math.round((bar.primary / max) * 70)}%` }} />
                <span className="tabular-nums text-ink-soft">{bar.value}</span>
              </span>
              {bar.secondary ? <i className="block h-2 rounded-r-md bg-ink" style={{ width: `${Math.round((bar.secondary / max) * 70)}%` }} /> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
