import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
};

const control =
  "w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface-subtle aria-invalid:border-danger";

// The <label> holds only the label text so its accessible name stays exact;
// hint and error are tied to the control through aria-describedby.
function Field({
  id,
  label,
  hint,
  error,
  children
}: FieldProps & {
  id: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-semibold text-ink" htmlFor={id}>
        {label}
      </label>
      {children(describedBy)}
      {hint ? (
        <p className="text-sm text-ink-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  hint,
  error,
  id,
  className = "",
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <Field error={error} hint={hint} id={fieldId} label={label}>
      {(describedBy) => (
        <input
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`h-11 ${control} ${className}`}
          id={fieldId}
          {...props}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  id,
  className = "",
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <Field error={error} hint={hint} id={fieldId} label={label}>
      {(describedBy) => (
        <textarea
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`min-h-28 py-2 ${control} ${className}`}
          id={fieldId}
          {...props}
        />
      )}
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  className = "",
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <Field error={error} hint={hint} id={fieldId} label={label}>
      {(describedBy) => (
        <select
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`h-11 ${control} ${className}`}
          id={fieldId}
          {...props}
        />
      )}
    </Field>
  );
}

// Dollars with a fixed "$" prefix; callers parse the text to cents with
// parseMoneyInput on save (EVT-002), so no float ever holds money.
export function MoneyInput({
  label = "Price",
  hint,
  error,
  value,
  disabled,
  onChange
}: Omit<FieldProps, "label"> & { label?: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const id = useId();

  return (
    <Field error={error} hint={hint} id={id} label={label}>
      {(describedBy) => (
        <div className="flex h-11 items-center rounded-control border border-line-strong bg-surface has-[[aria-invalid]]:border-danger has-[:disabled]:bg-surface-subtle">
          <span aria-hidden="true" className="pl-3 text-ink-soft">
            $
          </span>
          <input
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className="h-full w-full min-w-0 bg-transparent px-2 text-base text-ink disabled:cursor-not-allowed"
            disabled={disabled}
            id={id}
            inputMode="decimal"
            onChange={(event) => onChange(event.target.value)}
            placeholder="0.00"
            value={value}
          />
        </div>
      )}
    </Field>
  );
}
