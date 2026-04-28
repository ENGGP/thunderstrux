import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganisationSearch } from "@/components/members/organisation-search";
import {
  OrganisationAccessError,
  requireAccountRole
} from "@/lib/auth/access";

export default async function MemberOrganisationsPage() {
  try {
    await requireAccountRole("member");
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      redirect("/dashboard");
    }

    throw error;
  }

  return (
    <main className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <Link
            className="text-sm font-medium text-neutral-600 hover:text-neutral-950"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-neutral-950">
            Organisations
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Search for organisations and join them as a member.
          </p>
        </header>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <OrganisationSearch />
        </section>
      </div>
    </main>
  );
}
