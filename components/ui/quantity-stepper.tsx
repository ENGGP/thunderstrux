import { useId, type ReactNode } from "react";
import { Field } from "./input";

const stepButton = "size-11 shrink-0 text-lg font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink-muted";
const frame = "flex w-fit items-center rounded-control border border-line-strong bg-surface";

type Steps = { value: number; min?: number; max: number; onChange: (next: number) => void; disabled?: boolean };

// −/+ that never step outside min..max, from wherever the value is (UX spec 14.2).
function StepButtons({ value, min = 1, max, onChange, disabled, children }: Steps & { children: ReactNode }) {
  const current = Number.isInteger(value) ? value : min;
  return (
    <>
      <button aria-label="One fewer" className={stepButton} disabled={disabled || current <= min} onClick={() => onChange(Math.max(min, Math.min(max, current - 1)))} type="button">
        −
      </button>
      {children}
      <button aria-label="One more" className={stepButton} disabled={disabled || current >= max} onClick={() => onChange(Math.min(max, Math.max(min, current + 1)))} type="button">
        +
      </button>
    </>
  );
}

// A count stepped with 44px buttons, named by its group: the shop's option picker and basket lines.
export function Stepper({ label, labelledBy, ...steps }: Steps & { label?: string; labelledBy?: string }) {
  return (
    <div aria-label={label} aria-labelledby={labelledBy} className={frame} role="group">
      <StepButtons {...steps}>
        <span aria-live="polite" className="min-w-9 text-center font-semibold tabular-nums">
          {steps.value}
        </span>
      </StepButtons>
    </div>
  );
}

// A quantity field: type a number or step it. Label, hint and error work as TextInput's do, and an
// error replaces the hint rather than stacking under it.
export function QuantityStepper({ label = "Quantity", hint, error, ...steps }: Steps & { label?: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <Field error={error} hint={error ? undefined : hint} id={id} label={label}>
      {(describedBy) => (
        <div className={`${frame} has-[[aria-invalid]]:border-danger has-[input:disabled]:bg-surface-subtle`}>
          <StepButtons {...steps}>
            <input
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              className="h-11 w-14 border-x border-line bg-transparent text-center text-base font-semibold tabular-nums text-ink [appearance:textfield] disabled:cursor-not-allowed [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              disabled={steps.disabled}
              id={id}
              inputMode="numeric"
              max={steps.max}
              min={steps.min ?? 1}
              onChange={(event) => steps.onChange(Number(event.target.value))}
              type="number"
              value={Number.isNaN(steps.value) ? "" : steps.value}
            />
          </StepButtons>
        </div>
      )}
    </Field>
  );
}
