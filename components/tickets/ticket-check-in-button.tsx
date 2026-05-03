"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type TicketCheckInButtonProps = {
  ticketId: string;
  initialCheckedInAt: string | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
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

  async function checkInTicket() {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/tickets/${ticketId}/check-in`, {
        method: "POST"
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body?.ticket?.checkedInAt) {
        setCheckedInAt(body.ticket.checkedInAt);
        router.refresh();
        return;
      }

      if (response.status === 409) {
        setMessage("Already checked in.");
        router.refresh();
        return;
      }

      setMessage("Could not check in ticket.");
    } finally {
      setIsBusy(false);
    }
  }

  if (checkedInAt) {
    return (
      <div className="space-y-1">
        <span className="inline-flex rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
          Checked in
        </span>
        <p className="text-xs text-neutral-500">{formatDateTime(checkedInAt)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button disabled={isBusy} onClick={checkInTicket} type="button">
        {isBusy ? "Checking in..." : "Check in"}
      </Button>
      {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
    </div>
  );
}
