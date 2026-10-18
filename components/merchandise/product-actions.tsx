"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import type { ProductBlocker } from "@/lib/merchandise/catalogue";

// The publish checks in a fixed order, each showing the server's blocker.
const checks: Array<{ label: string; codes: Array<ProductBlocker["code"]> }> = [
  { label: "A photo", codes: ["photo_missing"] },
  { label: "An option in stock", codes: ["no_options", "no_stock"] },
  { label: "Payments set up (needed for paid options)", codes: ["payments_unavailable"] },
  { label: "Pickup details in Society profile", codes: ["pickup_missing"] }
];
const fixLinks: Partial<Record<ProductBlocker["code"], { href: string; label: string }>> = {
  payments_unavailable: { href: "/dashboard/settings", label: "Go to Payments" },
  pickup_missing: { href: "/dashboard/settings/profile", label: "Go to Society profile" }
};

export function ProductChecklist({ blockers }: { blockers: ProductBlocker[] }) {
  return (
    <ul className="grid gap-3">
      {checks.map((check) => {
        const blocker = blockers.find((item) => check.codes.includes(item.code));
        const fix = blocker ? fixLinks[blocker.code] : undefined;
        return (
          <li className="flex gap-2.5 text-[15px]" key={check.label}>
            <Icon className={blocker ? "mt-0.5 text-warning" : "mt-0.5 text-success"} name={blocker ? "warning" : "success"} size={20} />
            <span className="grid gap-0.5">
              <span className={blocker ? "font-semibold text-ink" : "text-ink"}>
                <span className="sr-only">{blocker ? "Needs attention: " : "Done: "}</span>
                {check.label}
              </span>
              {blocker ? <span className="text-sm text-ink-soft">{blocker.message}</span> : null}
              {fix ? (
                <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={fix.href}>
                  {fix.label}
                </Link>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Publish (drafts), Archive (anything not archived) and Restore (archived) for one product.
export function ProductActions({
  orgSlug,
  product,
  publishBlocked
}: {
  orgSlug: string;
  product: { id: string; name: string; status: "draft" | "published" | "archived"; version: number };
  publishBlocked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "publish" | "archive" | "restore") {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orgs/${orgSlug}/merchandise/${product.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: product.version })
      });
      setConfirm(false);
      router.refresh();
    } catch (failure) {
      setConfirm(false);
      setError(getClientErrorMessage(failure, `Unable to ${action} the product.`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {product.status === "draft" ? (
          <Button aria-describedby={publishBlocked ? "publish-blocked" : undefined} disabled={busy || publishBlocked} onClick={() => act("publish")}>
            Publish product
          </Button>
        ) : null}
        {product.status === "archived" ? (
          <Button disabled={busy} onClick={() => act("restore")} variant="secondary">
            Restore as draft
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => setConfirm(true)} variant="secondary">
            Archive product
          </Button>
        )}
      </div>
      {publishBlocked && product.status === "draft" ? (
        <p className="text-sm text-ink-soft" id="publish-blocked">
          Fix the items above to publish. Drafts never show to buyers.
        </p>
      ) : null}
      {error ? (
        <Notice role="alert" title="Not changed" tone="danger">
          <p className="mt-0.5">{error}</p>
        </Notice>
      ) : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel={product.status === "published" ? "Keep selling" : "Keep draft"}
        confirmLabel="Archive product"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => act("archive")}
        open={confirm}
        title={`Archive ${product.name}?`}
      >
        <ul className="grid list-disc gap-1 pl-5">
          <li>{product.status === "published" ? "It stops selling now and leaves your Merchandise tab." : "It won't be published."}</li>
          <li>You can restore it as a draft later and publish it again.</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}
