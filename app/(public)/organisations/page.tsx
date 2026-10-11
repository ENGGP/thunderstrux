import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import {
  discoveryInput,
  discoverOrganisations,
} from "@/lib/organisations/discovery";
import { AssetError } from "@/lib/assets/image";
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
    <main className="society-surface min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-sm">Campus communities</p>
          <h1 className="mt-2 text-3xl font-semibold">Discover societies</h1>
          <p className="mt-3">
            Find your people, explore their profiles and see what is coming up.
          </p>
        </header>
        <form
          action="/organisations"
          method="GET"
          className="society-panel flex flex-col gap-3 p-5 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <TextInput
              label="Search societies"
              name="q"
              defaultValue={input.q}
              maxLength={120}
            />
          </div>
          <Button type="submit" variant="society">
            Search
          </Button>
        </form>
        {warning && <p role="alert">{warning} Showing the first page.</p>}
        {!page.organisations.length ? (
          <section className="society-panel p-6">
            <h2 className="font-semibold">No societies found</h2>
            <p className="mt-2">Try a different name or clear the search.</p>
            <Link
              className="society-link mt-3 inline-block"
              href="/organisations"
            >
              Show all societies
            </Link>
          </section>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {page.organisations.map((org) => (
              <article className="society-panel space-y-3 p-6" key={org.id}>
                {org.logoAssetId && (
                  <img
                    src={`/api/public/assets/${org.logoAssetId}`}
                    alt=""
                    className="h-16 w-16 object-contain"
                  />
                )}
                <h2 className="text-xl font-semibold">
                  <Link href={`/organisations/${org.slug}`}>{org.name}</Link>
                </h2>
                <p>
                  {org.description ||
                    "This society is getting its profile ready."}
                </p>
                {org.nextEvent && (
                  <p className="text-sm">Coming up: {org.nextEvent.title}</p>
                )}
                <Link
                  className="society-link inline-block"
                  href={`/organisations/${org.slug}`}
                >
                  View society
                </Link>
              </article>
            ))}
          </div>
        )}
        <nav aria-label="Society result pages" className="flex gap-6">
          {page.pageInfo.hasPreviousPage && (
            <Link
              href={`/organisations?${new URLSearchParams({ q: input.q, limit: String(input.limit) })}`}
            >
              First page
            </Link>
          )}
          {page.pageInfo.nextCursor && (
            <Link href={`/organisations?${next}`}>More societies</Link>
          )}
        </nav>
      </div>
    </main>
  );
}
