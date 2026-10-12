"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export type JoinState =
  | "anonymous"
  | "verify"
  | "joined"
  | "available"
  | "organisation";
// Joining is a free affiliation. It never grants paid benefits or staff access.
export function SocietyJoin({
  slug,
  state,
}: {
  slug: string;
  state: JoinState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const callback = encodeURIComponent(`/societies/${slug}`);
  async function join() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orgs/${slug}/join`, { method: "POST" });
      router.refresh();
    } catch (failure) {
      setError(getClientErrorMessage(failure, "Unable to join society."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid justify-items-start gap-2">
      {state === "anonymous" && (
        <Link
          className={buttonClasses({ variant: "secondary" })}
          href={`/login?callbackUrl=${callback}`}
        >
          Sign in to join society
        </Link>
      )}
      {state === "verify" && (
        <Link
          className={buttonClasses({ variant: "secondary" })}
          href={`/verify-email?callbackUrl=${callback}`}
        >
          Verify email to join society
        </Link>
      )}
      {state === "available" && (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={join}
        >
          {busy ? "Joining…" : "Join society"}
        </Button>
      )}
      {state === "joined" && (
        <>
          <p
            className="rounded-tag bg-success-bg px-2 py-0.5 text-xs font-semibold text-success"
            role="status"
          >
            Joined
          </p>
          <Link
            className="text-sm text-brand underline"
            href="/dashboard/organisations"
          >
            Manage joined societies
          </Link>
        </>
      )}
      {state === "organisation" ? (
        <p className="text-sm text-ink-soft">
          Organisation accounts run a society and cannot join one. Sign in with
          a personal account to join.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Free affiliation does not grant paid benefits or staff access.
        </p>
      )}
      {error && (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      )}
    </div>
  );
}
