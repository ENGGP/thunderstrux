"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { ClientApiError, fetchJson } from "@/lib/client/api";

type SearchOrganisation = {
  id: string;
  name: string;
  slug: string;
  joined: boolean;
};

export function OrganisationSearch() {
  const [query, setQuery] = useState("");
  const [organisations, setOrganisations] = useState<SearchOrganisation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joiningSlug, setJoiningSlug] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function search(nextQuery = query) {
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchJson<{ organisations: SearchOrganisation[] }>(
        `/api/orgs/search?q=${encodeURIComponent(nextQuery)}`
      );
      setOrganisations(data.organisations);
    } catch (searchError) {
      setError(
        searchError instanceof ClientApiError
          ? searchError.message
          : "Unable to search organisations."
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void search("");
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await search();
  }

  async function joinOrganisation(organisation: SearchOrganisation) {
    setJoiningSlug(organisation.slug);
    setError(null);
    setMessage(null);

    try {
      await fetchJson(`/api/orgs/${organisation.slug}/join`, {
        method: "POST"
      });
      setOrganisations((current) =>
        current.map((item) =>
          item.id === organisation.id ? { ...item, joined: true } : item
        )
      );
      setMessage(`Joined ${organisation.name}.`);
    } catch (joinError) {
      setError(
        joinError instanceof ClientApiError
          ? joinError.message
          : "Unable to join organisation."
      );
    } finally {
      setJoiningSlug(null);
    }
  }

  return (
    <div className="grid gap-5">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSubmit}>
        <div className="flex-1">
          <TextInput
            label="Search organisations"
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />
        </div>
        <Button disabled={isLoading} type="submit">
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </form>

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

      {organisations.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-600">
          No organisations found.
        </div>
      ) : (
        <div className="grid gap-3">
          {organisations.map((organisation) => (
            <article
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-5"
              key={organisation.id}
            >
              <div>
                <h2 className="font-medium text-neutral-950">
                  {organisation.name}
                </h2>
                <p className="mt-1 text-sm text-neutral-500">
                  {organisation.slug}
                </p>
              </div>
              <Button
                disabled={organisation.joined || joiningSlug === organisation.slug}
                onClick={() => joinOrganisation(organisation)}
                type="button"
                variant={organisation.joined ? "secondary" : "primary"}
              >
                {organisation.joined
                  ? "Joined"
                  : joiningSlug === organisation.slug
                    ? "Joining..."
                    : "Join"}
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
