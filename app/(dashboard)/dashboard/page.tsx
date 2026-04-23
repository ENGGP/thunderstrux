import Link from "next/link";
import { headers } from "next/headers";
import { Card } from "@/components/ui/card";

type Organisation = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

async function getOrganisations(): Promise<Organisation[]> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const response = await fetch(`${appUrl}/api/orgs`, {
    cache: "no-store",
    headers: {
      cookie
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load organisations");
  }

  const data = (await response.json()) as { organisations?: Organisation[] };
  return Array.isArray(data.organisations) ? data.organisations : [];
}

export default async function DashboardOrganisationsPage() {
  const organisations = await getOrganisations();

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-6">
        {organisations.length === 0 ? (
          <section className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
            <h1 className="text-3xl font-semibold text-neutral-950">
              You don&apos;t have an organisation yet
            </h1>
            <p className="mt-3 text-sm text-neutral-600">
              Create your first organisation to start managing events
            </p>
            <Link
              className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
              href="/dashboard/create"
            >
              Create Organisation
            </Link>
          </section>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold text-neutral-950">
                  Dashboard
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  Select an organisation to manage.
                </p>
              </div>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
                href="/dashboard/create"
              >
                New organisation
              </Link>
            </header>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {organisations.map((organisation) => (
                <Link href={`/dashboard/${organisation.slug}`} key={organisation.id}>
                  <Card>
                    <h2 className="text-lg font-semibold text-neutral-950">
                      {organisation.name}
                    </h2>
                    <p className="mt-2 text-sm text-neutral-500">
                      Manage events, tickets, and settings.
                    </p>
                  </Card>
                </Link>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
