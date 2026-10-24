import type { Metadata } from "next";
import Link from "next/link";
import { SocietyCard } from "@/components/organisations/society-card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { TextInput } from "@/components/ui/input";
import {
  discoveryInput,
  discoverOrganisations,
} from "@/lib/organisations/discovery";
import { AssetError } from "@/lib/assets/image";

export const metadata: Metadata = { title: "Discover societies" };
export const dynamic = "force-dynamic";
export default async function SocietiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["q", "cursor", "limit"] as const)
    if (typeof params[key] === "string") query.set(key, params[key]);
  let input: ReturnType<typeof discoveryInput>;
  let warning = "";
  try {
    input = discoveryInput(query);
  } catch (error) {
    if (!(error instanceof AssetError)) throw error;
    warning = error.message;
    input = discoveryInput(new URLSearchParams());
  }
  const page = await discoverOrganisations(input);
  const next = new URLSearchParams({
    q: input.q,
    limit: String(input.limit),
    cursor: page.pageInfo.nextCursor ?? "",
  });
  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-10 md:px-8 md:py-14">
        <header className="grid gap-2">
          <p className="text-sm font-semibold text-brand">Campus communities</p>
          <h1 className="font-display text-4xl font-semibold text-ink md:text-5xl">
            Discover societies
          </h1>
          <p className="max-w-xl text-lg text-ink-soft">
            Find your people, explore their profiles and see what is coming up.
          </p>
        </header>
        <form
          action="/societies"
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-end"
          method="GET"
        >
          <div className="min-w-0 flex-1">
            <TextInput
              label="Search societies"
              name="q"
              defaultValue={input.q}
              maxLength={120}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {warning && (
          <Notice role="alert" tone="warning">
            {warning} Showing the first page.
          </Notice>
        )}
        {!page.organisations.length ? (
          <section className="rounded-card border border-line bg-surface p-6">
            <h2 className="text-lg font-semibold text-ink">No societies found</h2>
            <p className="mt-2 text-ink-soft">
              Try a different name or clear the search.
            </p>
            <Link
              className="mt-3 inline-block text-brand underline"
              href="/societies"
            >
              Show all societies
            </Link>
          </section>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {page.organisations.map((org) => (
              <SocietyCard key={org.id} {...org} />
            ))}
          </div>
        )}
        <nav aria-label="Society result pages" className="flex flex-wrap gap-3">
          {page.pageInfo.hasPreviousPage && (
            <Link
              className={buttonClasses({ variant: "secondary" })}
              href={`/societies?${new URLSearchParams({ q: input.q, limit: String(input.limit) })}`}
            >
              First page
            </Link>
          )}
          {page.pageInfo.nextCursor && (
            <Link
              className={buttonClasses({ variant: "secondary" })}
              href={`/societies?${next}`}
            >
              More societies
            </Link>
          )}
        </nav>
      </div>
    </main>
  );
}
