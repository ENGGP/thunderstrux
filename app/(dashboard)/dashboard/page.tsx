import Link from "next/link";
import { headers } from "next/headers";

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
    <main className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {organisations.length === 0 ? (
          <section className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center">
            <div className="w-full rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
              <div className="space-y-6 text-center">
                <div className="space-y-3">
                  <h1 className="text-3xl font-semibold text-neutral-950">
                    You don&apos;t have an organisation yet
                  </h1>
                  <p className="text-sm text-neutral-500">
                    Create your first organisation to start managing events
                  </p>
                </div>
                <Link
                  className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
                  href="/dashboard/create"
                >
                  Create Organisation
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            <header className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div className="space-y-3">
                  <h1 className="text-3xl font-semibold text-neutral-950">
                    Dashboard
                  </h1>
                  <p className="text-sm text-neutral-500">
                    Select an organisation to manage.
                  </p>
                </div>
                <Link
                  className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
                  href="/dashboard/create"
                >
                  New organisation
                </Link>
              </div>
            </header>

            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-lg font-medium text-neutral-950">
                    Your organisations
                  </h2>
                  <p className="text-sm text-neutral-500">
                    Open a dashboard to manage events, tickets, and settings.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {organisations.map((organisation) => (
                    <article
                      key={organisation.id}
                      className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
                    >
                      <div className="flex min-h-44 flex-col justify-between gap-6">
                        <div className="space-y-2">
                          <h3 className="text-lg font-medium text-neutral-950">
                            {organisation.name}
                          </h3>
                          <p className="text-sm text-neutral-500">
                            Manage events, tickets, and settings for this organisation.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Link
                            href={`/dashboard/${organisation.slug}`}
                            className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
                          >
                            Open dashboard
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
