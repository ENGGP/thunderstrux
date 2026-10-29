"use client";

import { FormEvent, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ListSkeleton } from "@/components/ui/skeleton";
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
  // A new search shows the skeleton; paging keeps the list until the next page arrives (UI-025).
  const [loading, setLoading] = useState<"search" | "next" | "prev" | null>("search");
  const [pages, setPages] = useState<{ next: string | null; previous: string | null }>({ next: null, previous: null });
  const [searchedQuery, setSearchedQuery] = useState("");

  async function search(nextQuery = query, page?: { cursor: string; direction: "next" | "prev" }) {
    const requestId = ++revision.current;
    setLoading(page?.direction ?? "search");
    setError(null);

    try {
      const params = new URLSearchParams({ q: nextQuery, limit: "25" });
      if (page) {
        params.set("cursor", page.cursor);
        params.set("direction", page.direction);
      }
      const data = await fetchJson<{
        organisations: SearchOrganisation[];
        pageInfo: { nextCursor: string | null; previousCursor?: string | null };
      }>(`/api/orgs/search?${params}`);
      if (requestId !== revision.current) return;
      setOrganisations(data.organisations);
      setPages({ next: data.pageInfo.nextCursor, previous: data.pageInfo.previousCursor ?? null });
      setSearchedQuery(nextQuery);
    } catch (searchError) {
      if (requestId !== revision.current) return;
      setError(
        getClientErrorMessage(searchError, "Unable to search societies."),
      );
    } finally {
      if (requestId === revision.current) setLoading(null);
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
      setLoading(null);
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
    setLoading(null);
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
        <Button busy={loading === "search"} busyLabel="Searching…" disabled={joiningSlug !== null || loading === "next" || loading === "prev"} type="submit">
          Search
        </Button>
      </form>

      {error ? (
        <Notice reveal role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice reveal role="status" tone="success">
          {message}
        </Notice>
      ) : null}

      {loading === "search" ? (
        <ListSkeleton label="Loading societies" rows={3} />
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
                busy={joiningSlug === organisation.slug}
                busyLabel="Joining…"
                disabled={organisation.joined}
                onClick={() => {
                  if (joiningSlug === null) void joinOrganisation(organisation);
                }}
                type="button"
                variant={organisation.joined ? "secondary" : "primary"}
              >
                {organisation.joined ? "Joined" : "Join society"}
              </Button>
            </article>
          ))}
        </div>
      )}
      {pages.next || pages.previous ? (
        <nav aria-label="Society search pages" className="flex flex-wrap items-center justify-between gap-3">
          {pages.previous ? (
            <Button
              busy={loading === "prev"}
              busyLabel="Loading…"
              disabled={loading !== null || joiningSlug !== null}
              onClick={() => search(searchedQuery, { cursor: pages.previous as string, direction: "prev" })}
              type="button"
              variant="secondary"
            >
              <Icon className="rotate-180" name="chevronRight" />
              Previous page
            </Button>
          ) : (
            <span />
          )}
          {pages.next ? (
            <Button
              busy={loading === "next"}
              busyLabel="Loading…"
              disabled={loading !== null || joiningSlug !== null}
              onClick={() => search(searchedQuery, { cursor: pages.next as string, direction: "next" })}
              type="button"
              variant="secondary"
            >
              Next page
              <Icon name="chevronRight" />
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
