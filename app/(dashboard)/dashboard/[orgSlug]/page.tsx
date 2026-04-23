import Link from "next/link";

export default async function DashboardPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="rounded-xl bg-red-500 p-10 text-2xl font-semibold text-white shadow-md">
        TAILWIND WORKING TEST
      </div>
      <div className="rounded-xl bg-blue-600 p-5 text-lg font-semibold text-white shadow-md">
        UI UPGRADE ACTIVE
      </div>
      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-md">
        <div className="space-y-3">
          <h2 className="text-3xl font-semibold text-neutral-950">Dashboard</h2>
          <p className="text-sm text-neutral-500">
            Overview for {orgSlug} and quick access to organisation activity.
          </p>
        </div>
      </section>
      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-md">
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-neutral-950">
              Organisation dashboard
            </h3>
            <p className="text-sm text-neutral-500">
              Manage events for this organisation.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/dashboard/${orgSlug}/events`}
              className="inline-flex items-center justify-center rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
            >
              View events
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
