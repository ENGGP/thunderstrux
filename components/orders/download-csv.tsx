"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// "Download CSV" for an Orders tab or an event's attendees (UI-018). Fetched
// here rather than linked, so a refusal (too many rows, the hourly limit) shows
// under the button instead of as a page of JSON.
export function DownloadCsv({ href, label = "Download CSV" }: { href: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The download didn't work. Try again.");
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "thunderstrux-export.csv";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The download didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid justify-items-end gap-2">
      <Button busy={busy} busyLabel="Preparing…" onClick={() => void download()} type="button" variant="secondary">
        {label}
      </Button>
      {error ? <Notice className="w-full text-left" reveal role="alert" tone="warning">{error}</Notice> : null}
    </div>
  );
}
