"use client";

import { FormEvent, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type SearchOrganisation = {
  id: string;
  name: string;
  slug: string;
  joined: boolean;
};

export function OrganisationSearch({ joinedIds }: { joinedIds: string[] }) {
  const router = useRouter();
  const revision = useRef(0);
  const joinedRevision = useRef(joinedIds);
  const [query, setQuery] = useState("");
  const [organisations, setOrganisations] = useState<SearchOrganisation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joiningSlug, setJoiningSlug] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");

  async function search(nextQuery = query, cursor?: string) {
    const requestId = ++revision.current;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ q: nextQuery, limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const data = await fetchJson<{
        organisations: SearchOrganisation[];
        pageInfo: { nextCursor: string | null };
      }>(`/api/orgs/search?${params}`);
      if (requestId !== revision.current) return;
      setOrganisations((current) =>
        cursor
          ? [
              ...new Map(
                [...current, ...data.organisations].map((row) => [row.id, row]),
              ).values(),
            ]
          : data.organisations,
      );
      setNextCursor(data.pageInfo.nextCursor);
      setSearchedQuery(nextQuery);
    } catch (searchError) {
      if (requestId !== revision.current) return;
      setError(
        getClientErrorMessage(searchError, "Unable to search societies."),
      );
    } finally {
      if (requestId === revision.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    void search("");
    return () => {
      revision.current++;
    };
  }, []);

  useEffect(() => {
    if (joinedRevision.current !== joinedIds) {
      revision.current++;
      setIsLoading(false);
      joinedRevision.current = joinedIds;
    }
    const joined = new Set(joinedIds);
    setOrganisations((current) =>
      current.map((row) => ({ ...row, joined: joined.has(row.id) })),
    );
  }, [joinedIds]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await search();
  }

  async function joinOrganisation(organisation: SearchOrganisation) {
    revision.current++;
    setIsLoading(false);
    setJoiningSlug(organisation.slug);
    setError(null);
    setMessage(null);

    try {
      await fetchJson(`/api/orgs/${organisation.slug}/join`, {
        method: "POST",
      });
      setOrganisations((current) =>
        current.map((item) =>
          item.id === organisation.id ? { ...item, joined: true } : item,
        ),
      );
      setMessage(`Joined ${organisation.name}.`);
      router.refresh();
    } catch (joinError) {
      setError(
        getClientErrorMessage(joinError, "Unable to join organisation."),
      );
    } finally {
      setJoiningSlug(null);
    }
  }

  return (
    <div className="grid gap-5">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={onSubmit}
      >
        <div className="flex-1">
          <TextInput
            label="Search societies"
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />
        </div>
        <Button disabled={isLoading || joiningSlug !== null} type="submit">
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </form>

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

      {isLoading ? (
        <p className="text-sm text-ink-soft" role="status">Loading societies…</p>
      ) : organisations.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-5 text-sm text-ink-muted">
          No societies found.
        </div>
      ) : (
        <div className="grid gap-3">
          {organisations.map((organisation) => (
            <article
              className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-5"
              key={organisation.id}
            >
              <div>
                <h2 className="font-medium text-ink">
                  <Link
                    className="underline"
                    href={`/societies/${organisation.slug}`}
                  >
                    {organisation.name}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {organisation.slug}
                </p>
              </div>
              <Button
                disabled={organisation.joined || joiningSlug !== null}
                onClick={() => joinOrganisation(organisation)}
                type="button"
                variant={organisation.joined ? "secondary" : "primary"}
              >
                {organisation.joined
                  ? "Joined"
                  : joiningSlug === organisation.slug
                    ? "Joining..."
                    : "Join society"}
              </Button>
            </article>
          ))}
        </div>
      )}
      {nextCursor && (
        <Button
          type="button"
          variant="secondary"
          disabled={isLoading || joiningSlug !== null}
          onClick={() => search(searchedQuery, nextCursor)}
        >
          More societies
        </Button>
      )}
    </div>
  );
}
