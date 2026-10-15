"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithCsrf } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";

type TicketCheckInButtonProps = {
  ticketId: string;
  // Names the attendee for screen readers, since every row has the same button.
  buyer: string;
  initialCheckedInAt: string | null;
  size?: "md" | "lg";
};

export function TicketCheckInButton({
  ticketId,
  buyer,
  initialCheckedInAt,
  size = "md"
}: TicketCheckInButtonProps) {
  const router = useRouter();
  const [checkedInAt, setCheckedInAt] = useState(initialCheckedInAt);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function updateTicketCheckIn(action: "check-in" | "check-out") {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithCsrf(`/api/tickets/${ticketId}/${action}`, {
        method: "POST"
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body?.ticket) {
        setCheckedInAt(body.ticket.checkedInAt ?? null);
        router.refresh();
        return;
      }

      if (response.status === 409) {
        setMessage(action === "check-in" ? "Already checked in." : "Already unused.");
        router.refresh();
        return;
      }

      setMessage(
        action === "check-in"
          ? "Could not check in ticket."
          : "Could not undo the check-in."
      );
    } finally {
      setIsBusy(false);
    }
  }

  const feedback = message ? <p className="text-sm text-danger" role="alert">{message}</p> : null;

  if (checkedInAt) {
    return (
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm text-ink-soft">Checked in {formatDateTime(checkedInAt)}</span>
          <Button
            disabled={isBusy}
            onClick={() => updateTicketCheckIn("check-out")}
            size="sm"
            type="button"
            variant="tertiary"
          >
            {isBusy ? "Undoing..." : "Undo check-in"}
            <span className="sr-only"> for {buyer}</span>
          </Button>
        </div>
        {feedback}
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <Button
        className={size === "lg" ? "w-full" : ""}
        disabled={isBusy}
        onClick={() => updateTicketCheckIn("check-in")}
        size={size}
        type="button"
      >
        {isBusy ? "Checking in..." : "Check in"}
        <span className="sr-only"> {buyer}</span>
      </Button>
      {feedback}
    </div>
  );
}
