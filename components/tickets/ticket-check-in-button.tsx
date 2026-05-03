"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type TicketCheckInButtonProps = {
  ticketId: string;
  initialCheckedInAt: string | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(new Date(value));
}

export function TicketCheckInButton({
  ticketId,
  initialCheckedInAt
}: TicketCheckInButtonProps) {
  const router = useRouter();
  const [checkedInAt, setCheckedInAt] = useState(initialCheckedInAt);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function updateTicketCheckIn(action: "check-in" | "check-out") {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/tickets/${ticketId}/${action}`, {
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
          : "Could not check out ticket."
      );
    } finally {
      setIsBusy(false);
    }
  }

  if (checkedInAt) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-neutral-500">{formatDateTime(checkedInAt)}</p>
        <Button
          disabled={isBusy}
          onClick={() => updateTicketCheckIn("check-out")}
          type="button"
        >
          {isBusy ? "Checking out..." : "Check out"}
        </Button>
        {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        disabled={isBusy}
        onClick={() => updateTicketCheckIn("check-in")}
        type="button"
      >
        {isBusy ? "Checking in..." : "Check in"}
      </Button>
      {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
    </div>
  );
}
