"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatDateTime } from "@/lib/format";

// Ten one-time recovery codes, with Copy all and Download (UI-018), after set-up
// and after replacing them. The list holds only the codes: browser tests count its items.
export function RecoveryCodes({ codes, email }: { codes: string[]; email?: string | null }) {
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  function download() {
    const lines = [
      "Thunderstrux recovery codes",
      ...(email ? [`Account: ${email}`] : []),
      // The reader's own clock: the file is theirs, wherever they are.
      `Created: ${formatDateTime(new Date(), { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
      "",
      "Each code works once, when you can't use your authenticator app.",
      "",
      ...codes,
      ""
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "thunderstrux-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="grid gap-3">
      {/* One column on phones: two 20-character codes don't fit side by side at 390px. */}
      <ul className="grid gap-2 rounded-card bg-surface-subtle p-4 font-mono text-ui text-ink sm:grid-cols-2">
        {codes.map((entry) => <li key={entry}>{entry}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()} type="button" variant="secondary">
          Copy all
        </Button>
        <Button onClick={download} type="button" variant="secondary">
          Download
        </Button>
      </div>
      {copied ? (
        <Notice reveal role="status" tone={copied === "done" ? "success" : "warning"}>
          {copied === "done" ? "Copied all ten codes." : "Couldn't copy. Select the codes and copy them, or use Download."}
        </Notice>
      ) : null}
    </div>
  );
}
