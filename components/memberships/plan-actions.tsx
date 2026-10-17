"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Publish (drafts) and Archive (anything not archived) for one plan.
export function PlanActions({
  orgSlug,
  plan,
  publishBlocked,
  holders
}: {
  orgSlug: string;
  plan: { id: string; name: string; status: "draft" | "published" | "archived"; version: number };
  publishBlocked: boolean;
  holders: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "publish" | "archive") {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orgs/${orgSlug}/memberships/${plan.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: plan.version })
      });
      setConfirm(false);
      router.refresh();
    } catch (failure) {
      setConfirm(false);
      setError(getClientErrorMessage(failure, action === "publish" ? "Unable to publish the plan." : "Unable to archive the plan."));
    } finally {
      setBusy(false);
    }
  }

  if (plan.status === "archived") return null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {plan.status === "draft" ? (
          <Button aria-describedby={publishBlocked ? "publish-blocked" : undefined} disabled={busy || publishBlocked} onClick={() => act("publish")}>
            Publish plan
          </Button>
        ) : null}
        <Button disabled={busy} onClick={() => setConfirm(true)} variant="secondary">
          Archive plan
        </Button>
      </div>
      {publishBlocked && plan.status === "draft" ? (
        <p className="text-sm text-ink-soft" id="publish-blocked">
          Fix the items in the publish check to publish.
        </p>
      ) : null}
      {error ? (
        <Notice role="alert" title="Not changed" tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel={plan.status === "published" ? "Keep selling" : "Keep draft"}
        confirmLabel="Archive plan"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => act("archive")}
        open={confirm}
        title={`Archive ${plan.name}?`}
      >
        <ul className="grid list-disc gap-1 pl-5">
          <li>{plan.status === "published" ? "It stops selling now and leaves your society page." : "It won't be published."}</li>
          {holders > 0 ? <li>The {holders === 1 ? "person who has" : `${holders} people who have`} it keep their membership and its dates.</li> : null}
          <li>An archived plan can&apos;t go back on sale. You can create a new one.</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}
