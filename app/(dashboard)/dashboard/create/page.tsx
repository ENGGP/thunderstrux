import Link from "next/link";
import { CreateOrganisationForm } from "@/components/orgs/create-organisation-form";
import { Card } from "@/components/ui/card";

export default function CreateOrganisationPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-md gap-4">
        <header>
          <Link
            className="text-sm font-medium text-neutral-600 hover:text-neutral-950"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-neutral-950">
            Create organisation
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Create your first organisation to start managing events.
          </p>
        </header>

        <Card>
          <CreateOrganisationForm />
        </Card>
      </div>
    </main>
  );
}
