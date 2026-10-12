"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

type MemberOrganisation = {
  id: string;
  name: string;
  slug: string;
  joinedAt: Date | null;
};

// Free affiliations only. Leaving one never touches paid purchases or staff access.
export function MemberOrganisationsList({
  organisations,
}: {
  organisations: MemberOrganisation[];
}) {
  const router = useRouter();
  const [visibleOrganisations, setVisibleOrganisations] =
    useState(organisations);
  const [confirming, setConfirming] = useState<MemberOrganisation | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setVisibleOrganisations(organisations);
  }, [organisations]);

  async function leaveOrganisation(organisation: MemberOrganisation) {
    setLeaving(true);
    setMessage(null);
    setError(null);

    try {
      await fetchJson(`/api/orgs/${organisation.slug}/leave`, {
        method: "POST",
      });
      setVisibleOrganisations((current) =>
        current.filter((item) => item.id !== organisation.id),
      );
      setMessage(`Left ${organisation.name}.`);
      router.refresh();
    } catch (leaveError) {
      setError(getClientErrorMessage(leaveError, "Unable to leave society."));
    } finally {
      setLeaving(false);
      setConfirming(null);
    }
  }

  return (
    <div className="mt-5 grid gap-4">
      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice role="status" tone="success">
          {message}
        </Notice>
      ) : null}

      {visibleOrganisations.length === 0 ? (
        <p className="text-sm text-ink-soft">
          You have not joined any societies yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleOrganisations.map((organisation) => (
            <article
              className="rounded-card border border-line p-4"
              key={organisation.id}
            >
              <h3 className="font-semibold text-ink [overflow-wrap:anywhere]">
                {organisation.name}
              </h3>
              {organisation.joinedAt ? (
                <p className="mt-1 text-sm text-ink-muted">
                  Joined {formatDate(organisation.joinedAt)}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  href={`/societies/${organisation.slug}`}
                >
                  View society
                </Link>
                <Link
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  href={`/societies/${organisation.slug}#events`}
                >
                  View events
                </Link>
                <Button
                  onClick={() => setConfirming(organisation)}
                  size="sm"
                  type="button"
                  variant="danger"
                >
                  Leave society
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        busy={leaving}
        confirmLabel="Leave society"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && leaveOrganisation(confirming)}
        open={confirming !== null}
        title={`Leave ${confirming?.name ?? "society"}?`}
      >
        You will stop being listed as joined. Tickets you have bought and any
        staff access you hold are not affected, and you can join again later.
      </ConfirmDialog>
    </div>
  );
}
