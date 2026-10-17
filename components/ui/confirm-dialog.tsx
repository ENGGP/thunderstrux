"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./button";

// Native <dialog>: showModal() traps focus, Escape cancels and focus returns
// to the control that opened it. The body is mounted only while open.
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  children
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  // Name the safe choice when "Cancel" would be ambiguous, e.g. "Keep registration".
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;

    if (open && dialog && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog?.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto w-[min(92vw,520px)] rounded-card border border-line bg-surface p-6 text-ink shadow-float backdrop:bg-brand-ink/40"
      onCancel={(event) => {
        // Escape cancels; it never confirms, and not while a request is in flight.
        event.preventDefault();
        if (!busy) onCancel();
      }}
      ref={ref}
    >
      {open ? (
        <div className="grid gap-4">
          <h2 className="text-xl font-semibold" id={titleId}>{title}</h2>
          <div className="text-sm text-ink-soft">{children}</div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
              {cancelLabel}
            </Button>
            <Button
              disabled={busy}
              onClick={onConfirm}
              type="button"
              variant={destructive ? "dangerSolid" : "primary"}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
