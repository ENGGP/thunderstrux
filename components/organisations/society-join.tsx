"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export type JoinState =
  | "anonymous"
  | "verify"
  | "joined"
  | "available"
  | "organisation";
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
    <div className="space-y-3">
      {state === "anonymous" && (
        <Link className="society-link" href={`/login?callbackUrl=${callback}`}>
          Sign in to join society
        </Link>
      )}
      {state === "verify" && (
        <Link
          className="society-link"
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
          <p role="status">Joined</p>
          <Link href="/dashboard/organisations">Manage joined societies</Link>
        </>
      )}
      {state !== "organisation" && (
        <p className="text-sm">
          Free affiliation does not grant paid benefits or staff access.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
