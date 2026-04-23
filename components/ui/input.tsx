import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldProps = {
  label: string;
  error?: string;
};

export function TextInput({
  label,
  error,
  className = "",
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-2 text-sm font-medium text-neutral-800">
      <span>{label}</span>
      <input
        className={`h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-900 ${className}`}
        {...props}
      />
      {error ? <span className="text-sm font-normal text-red-600">{error}</span> : null}
    </label>
  );
}

export function TextArea({
  label,
  error,
  className = "",
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="grid gap-2 text-sm font-medium text-neutral-800">
      <span>{label}</span>
      <textarea
        className={`min-h-28 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 ${className}`}
        {...props}
      />
      {error ? <span className="text-sm font-normal text-red-600">{error}</span> : null}
    </label>
  );
}
