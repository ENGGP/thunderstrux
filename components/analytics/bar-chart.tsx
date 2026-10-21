// One bar per bucket (round C1, T32): vertical bars from 768px, a horizontal
// list on phones. Its accessible name lists every value, so the picture never
// holds a number a screen reader can't reach.
export type ChartBar = { key: string; label: string; primary: number; secondary?: number; value: string };

export function BarChart({ label, bars, legend }: { label: string; bars: ChartBar[]; legend?: [string, string] }) {
  const max = Math.max(1, ...bars.map((bar) => bar.primary + (bar.secondary ?? 0)));
  const height = (value: number) => `${Math.round((value / max) * 160)}px`;
  // Labels for every bar up to 12, then every nth so they never collide.
  const step = Math.ceil(bars.length / 12);
  const name = `${label}: ${bars.map((bar) => `${bar.label} ${bar.value}`).join(", ")}`;
  return (
    <div className="grid gap-3">
      {legend ? (
        <div aria-hidden="true" className="flex flex-wrap gap-4 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-2"><i className="size-3 rounded-[3px] bg-brand" />{legend[0]}</span>
          <span className="inline-flex items-center gap-2"><i className="size-3 rounded-[3px] bg-ink" />{legend[1]}</span>
        </div>
      ) : null}
      <div className="hidden overflow-x-auto md:block">
        <div aria-label={name} className="flex h-56 items-end gap-2 border-b border-line pb-1" role="img" style={{ minWidth: bars.length * 14 }}>
          {bars.map((bar) => (
            <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5" key={bar.key}>
              {bars.length <= 12 ? <span className="text-[13px] tabular-nums text-ink-soft">{bar.value}</span> : null}
              <div className="flex w-full max-w-14 flex-col justify-end gap-0.5">
                <div className="rounded-t-md bg-brand" style={{ height: height(bar.primary) }} />
                {bar.secondary ? <div className="rounded-b-sm bg-ink" style={{ height: height(bar.secondary) }} /> : null}
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-2 flex gap-2" style={{ minWidth: bars.length * 14 }}>
          {bars.map((bar, index) => (
            <span className="min-w-0 flex-1 whitespace-nowrap text-center text-[13px] text-ink-soft" key={bar.key}>
              {index % step === 0 ? bar.label : ""}
            </span>
          ))}
        </div>
      </div>
      <div aria-label={name} className="grid gap-2.5 md:hidden" role="img">
        {bars.map((bar) => (
          <div className="grid grid-cols-[56px_1fr] items-center gap-2.5 text-sm" key={bar.key}>
            <span className="text-ink-soft">{bar.label}</span>
            <span className="flex items-center gap-2">
              <i className="block h-4 rounded-r-md bg-brand" style={{ width: `${Math.round((bar.primary / max) * 70)}%` }} />
              <span className="tabular-nums text-ink-soft">{bar.value}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
