import Link from "next/link";
import { Card } from "@/components/ui/card";

export default async function DashboardPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div className="grid gap-4">
      <h2 className="text-2xl font-semibold text-neutral-950">Dashboard</h2>
      <Card>
        <p className="text-sm text-neutral-600">
          Manage events for this organisation.
        </p>
        <Link
          href={`/dashboard/${orgSlug}/events`}
          className="mt-4 inline-flex rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          View events
        </Link>
      </Card>
    </div>
  );
}
