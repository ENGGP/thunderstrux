import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { OrganisationSearch } from "@/components/organisations/organisation-search";
import { MemberOrganisationsList } from "@/components/organisations/member-organisations-list";
import { Card } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import {
  OrganisationAccessError,
  requireAccountRole,
  getAccessibleOrganisationsForCurrentAccount,
} from "@/lib/auth/access";

export const metadata: Metadata = { title: "Societies" };

const pageSize = 25;

// A page of the joined societies, by name, from the society after (or before)
// the cursor; an unknown cursor starts again at the first page (UI-025).
function joinedPage<Row extends { id: string }>(rows: Row[], cursor: string | undefined, direction: string | undefined) {
  const at = cursor ? rows.findIndex((row) => row.id === cursor) : -1;
  const back = direction === "prev" && at >= 0;
  const start = back ? Math.max(0, at - pageSize) : at + 1;
  const end = back ? at : start + pageSize;
  const page = rows.slice(start, end);
  return { page, previous: start > 0 ? page[0]?.id : undefined, next: end < rows.length ? page.at(-1)?.id : undefined };
}

export default async function MemberOrganisationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string; direction?: string }> }) {
  const params = await searchParams;
  try {
    await requireAccountRole("member");
  } catch (error) {
    if (error instanceof OrganisationAccessError) redirect("/dashboard");
    throw error;
  }
  const organisations = await getAccessibleOrganisationsForCurrentAccount();
  const { page, previous, next } = joinedPage(organisations, params.cursor, params.direction);
  const pageHref = (cursor: string, direction: "next" | "prev") => `/dashboard/organisations?${new URLSearchParams({ cursor, direction })}`;
  return (
    <PersonalShell>
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold text-ink">Societies</h1>
        <p className="text-ink-soft">
          Find societies and join them for free.{" "}
          <Link className="text-brand underline" href="/societies">
            Browse public societies
          </Link>
        </p>
      </header>
      <Card>
        <h2 className="text-xl font-semibold text-ink">Your joined societies</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Joining is free and follows a society&apos;s events. Memberships are bought separately.
        </p>
        <MemberOrganisationsList key={page[0]?.id ?? "none"} organisations={page} />
        {previous || next ? (
          <div className="mt-4">
            <Pager label="Joined society pages" next={next && pageHref(next, "next")} previous={previous && pageHref(previous, "prev")} />
          </div>
        ) : null}
      </Card>
      <Card>
        <OrganisationSearch
          joinedIds={organisations.map((organisation) => organisation.id)}
        />
      </Card>
    </PersonalShell>
  );
}
