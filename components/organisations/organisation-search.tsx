"use client";

import { FormEvent, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/input";
import { rowLinkClasses } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/notice";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type SearchOrganisation = {
  id: string;
  name: string;
  slug: string;
  joined: boolean;
};

// Joining needs a verified email; an unverified member gets the way to verify in place of Join.
export function OrganisationSearch({ joinedIds, verified = true }: { joinedIds: string[]; verified?: boolean }) {
  const router = useRouter();
  const revision = useRef(0);
  const joinedRevision = useRef(joinedIds);
  const [query, setQuery] = useState("");
  const [organisations, setOrganisations] = useState<SearchOrganisation[]>([]);
  // A join's result shows under the row that was pressed, not at the top of a long list.
  const [joined, setJoined] = useState<{ slug: string; tone: "success" | "danger"; text: string } | null>(null);
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
    setJoined(null);

    try {
      await fetchJson(`/api/orgs/${organisation.slug}/join`, {
        method: "POST",
      });
      setOrganisations((current) =>
        current.map((item) =>
          item.id === organisation.id ? { ...item, joined: true } : item,
        ),
      );
      setJoined({ slug: organisation.slug, tone: "success", text: `Joined ${organisation.name}.` });
      router.refresh();
    } catch (joinError) {
      setJoined({ slug: organisation.slug, tone: "danger", text: getClientErrorMessage(joinError, `Couldn't join ${organisation.name}. Try again.`) });
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
              className="grid gap-3 rounded-card border border-line bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={organisation.id}
            >
              <h2 className="font-semibold text-ink [overflow-wrap:anywhere]">
                <Link className={rowLinkClasses} href={`/societies/${organisation.slug}`}>
                  {organisation.name}
                </Link>
              </h2>
              {organisation.joined ? (
                // A relationship, not a button: there is nothing to press.
                <span className="sm:justify-self-end"><StatusBadge status="joined" /></span>
              ) : verified ? (
                <Button
                  busy={joiningSlug === organisation.slug}
                  busyLabel="Joining…"
                  onClick={() => {
                    if (joiningSlug === null) void joinOrganisation(organisation);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Join society
                </Button>
              ) : (
                <Link className={buttonClasses({ variant: "secondary" })} href="/verify-email?callbackUrl=%2Fdashboard%2Forganisations">
                  Verify email to join
                </Link>
              )}
              {joined?.slug === organisation.slug ? (
                <Notice className="sm:col-span-2" reveal role={joined.tone === "danger" ? "alert" : "status"} tone={joined.tone}>
                  {joined.text}
                </Notice>
              ) : null}
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
