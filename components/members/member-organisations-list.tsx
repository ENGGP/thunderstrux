"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type MemberOrganisation = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export function MemberOrganisationsList({
  organisations
}: {
  organisations: MemberOrganisation[];
}) {
  const router = useRouter();
  const [visibleOrganisations, setVisibleOrganisations] = useState(organisations);
  const [leavingSlug, setLeavingSlug] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function leaveOrganisation(organisation: MemberOrganisation) {
    const confirmed = window.confirm(`Leave ${organisation.name}?`);

    if (!confirmed) {
      return;
    }

    setLeavingSlug(organisation.slug);
    setMessage(null);
    setError(null);

    try {
      await fetchJson(`/api/orgs/${organisation.slug}/leave`, {
        method: "POST"
      });
      setVisibleOrganisations((current) =>
        current.filter((item) => item.id !== organisation.id)
      );
      setMessage(`Left ${organisation.name}.`);
      router.refresh();
    } catch (leaveError) {
      setError(
        getClientErrorMessage(leaveError, "Unable to leave organisation.")
      );
    } finally {
      setLeavingSlug(null);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      {visibleOrganisations.length === 0 ? (
        <p className="text-sm text-neutral-600">
          You have not joined any organisations yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleOrganisations.map((organisation) => (
            <article
              className="rounded-lg border border-neutral-200 p-4"
              key={organisation.id}
            >
              <h3 className="font-medium text-neutral-950">
                {organisation.name}
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                Joined as {organisation.role}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
                  href={`/organisations/${organisation.slug}`}
                >
                  View details
                </Link>
                <button
                  className="inline-flex h-9 items-center justify-center rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={leavingSlug === organisation.slug}
                  onClick={() => leaveOrganisation(organisation)}
                  type="button"
                >
                  {leavingSlug === organisation.slug
                    ? "Leaving..."
                    : "Leave organisation"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
