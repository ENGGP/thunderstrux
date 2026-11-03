// One bar per bucket (round C1, T32): vertical bars from 768px, a horizontal
// list on phones. Its accessible name lists every value, so the picture never
// holds a number a screen reader can't reach.
export type ChartBar = { key: string; label: string; primary: number; secondary?: number; value: string; secondaryValue?: string };

// `below` hangs the secondary series under the axis (refunds against gross), so
// it reads as money going back rather than stacking onto the sales (UI-068): it is
// hatched grey, the quietest mark, with its amount in crimson. Without it the two
// series stack (new members, then renewals in a lighter violet). `muted` greys every
// bar, for the history of a cancelled event.
export function BarChart({ label, bars, legend, below = false, muted = false }: { label: string; bars: ChartBar[]; legend?: [string, string]; below?: boolean; muted?: boolean }) {
  const max = Math.max(1, ...bars.map((bar) => (below ? Math.max(bar.primary, bar.secondary ?? 0) : bar.primary + (bar.secondary ?? 0))));
  const height = (value: number) => `${Math.round((value / max) * 160)}px`;
  const deepest = below ? Math.max(0, ...bars.map((bar) => bar.secondary ?? 0)) : 0;
  // Labels for every bar up to 12, then every nth so they never collide.
  const step = Math.ceil(bars.length / 12);
  const labelled = bars.length <= 12;
  const name = `${label}: ${bars.map((bar) => `${bar.label} ${bar.value}${bar.secondaryValue && legend ? `, ${legend[1].toLowerCase()} ${bar.secondaryValue}` : ""}`).join(", ")}`;
  const fill = muted ? "bg-chart-out" : "bg-brand";
  const second = below ? "hatch" : "bg-chart-2";
  return (
    <div className="grid gap-3">
      {legend ? (
        <div aria-hidden="true" className="flex flex-wrap gap-4 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-2"><i className={`size-3 rounded-[3px] ${fill}`} />{legend[0]}</span>
          <span className="inline-flex items-center gap-2"><i className={`size-3 rounded-[3px] ${second}`} />{legend[1]}{below ? " (below the line)" : ""}</span>
        </div>
      ) : null}
      <div className="hidden overflow-x-auto md:block">
        {below ? (
          <div aria-label={name} className="relative flex gap-2" role="img" style={{ minWidth: bars.length * 14 }}>
            {/* One axis across every bar: sales rise above it, refunds hang below. */}
            <div aria-hidden="true" className="absolute inset-x-0 border-t border-ink-muted" style={{ top: 192 }} />
            {bars.map((bar) => (
              <div className="flex min-w-0 flex-1 flex-col items-center" key={bar.key}>
                <div className="flex h-48 w-full flex-col items-center justify-end gap-1.5">
                  {labelled ? <span className="text-caption tabular-nums text-ink-soft">{bar.value}</span> : null}
                  <div className={`w-full max-w-14 rounded-t-md ${fill}`} style={{ height: height(bar.primary) }} />
                </div>
                <div className="flex w-full flex-col items-center gap-1 pt-px" style={{ height: `calc(${height(deepest)} + ${labelled ? "1.5rem" : "0px"})` }}>
                  {bar.secondary ? <div className="hatch w-full max-w-14 rounded-b-md" style={{ height: height(bar.secondary) }} /> : null}
                  {bar.secondary && labelled ? <span className="text-caption font-semibold tabular-nums text-danger">−{bar.secondaryValue}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div aria-label={name} className="flex h-56 items-end gap-2 border-b border-ink-muted pb-1" role="img" style={{ minWidth: bars.length * 14 }}>
            {bars.map((bar) => (
              <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5" key={bar.key}>
                {labelled ? <span className="text-caption tabular-nums text-ink-soft">{bar.value}</span> : null}
                {/* A 2px gap keeps the two series apart without relying on their colours. */}
                <div className="flex w-full max-w-14 flex-col justify-end gap-0.5">
                  <div className={`rounded-t-md ${fill}`} style={{ height: height(bar.primary) }} />
                  {bar.secondary ? <div className={`rounded-b-sm ${muted ? "bg-chart-out" : "bg-chart-2"}`} style={{ height: height(bar.secondary) }} /> : null}
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
      {/* Phones: refunds run left from zero with their amount, sales run right; stacked series share one row. */}
      <div aria-label={name} className="grid gap-2.5 md:hidden" role="img">
        {bars.map((bar) =>
          below ? (
            <div className="grid grid-cols-[48px_minmax(0,2fr)_1px_minmax(0,5fr)] items-center text-sm" key={bar.key}>
              <span className="text-ink-soft">{bar.label}</span>
              <span className="flex items-center justify-end gap-1.5 pr-1">
                {bar.secondary ? (
                  <>
                    <span className="font-semibold tabular-nums text-danger">−{bar.secondaryValue}</span>
                    <i className="hatch block h-4 rounded-l-md" style={{ width: `${Math.max(8, Math.round((bar.secondary / max) * 60))}%` }} />
                  </>
                ) : null}
              </span>
              <span aria-hidden="true" className="h-full bg-ink-muted" />
              <span className="flex items-center gap-1.5 pl-1">
                <i className={`block h-4 rounded-r-md ${fill}`} style={{ width: `${Math.round((bar.primary / max) * 75)}%` }} />
                <span className="tabular-nums text-ink-soft">{bar.value}</span>
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-[56px_1fr] items-center gap-2.5 text-sm" key={bar.key}>
              <span className="text-ink-soft">{bar.label}</span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-0.5" style={{ width: `${Math.round(((bar.primary + (bar.secondary ?? 0)) / max) * 70)}%` }}>
                  <i className={`block h-4 ${bar.secondary ? "" : "rounded-r-md"} ${fill}`} style={{ flex: bar.primary }} />
                  {bar.secondary ? <i className={`block h-4 rounded-r-md ${muted ? "bg-chart-out" : "bg-chart-2"}`} style={{ flex: bar.secondary }} /> : null}
                </span>
                <span className="tabular-nums text-ink-soft">{bar.value}</span>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
