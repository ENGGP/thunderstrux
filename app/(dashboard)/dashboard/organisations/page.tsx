import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganisationSearch } from "@/components/members/organisation-search";
import { MemberOrganisationsList } from "@/components/members/member-organisations-list";
import {
  OrganisationAccessError,
  requireAccountRole,
  getAccessibleOrganisationsForCurrentAccount,
} from "@/lib/auth/access";
export default async function MemberOrganisationsPage() {
  try {
    await requireAccountRole("member");
  } catch (error) {
    if (error instanceof OrganisationAccessError) redirect("/dashboard");
    throw error;
  }
  const organisations = await getAccessibleOrganisationsForCurrentAccount();
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
          <Link className="mt-3 inline-block underline" href="/organisations">
            Browse public societies
          </Link>
        </header>
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Your joined societies</h2>
          <p className="mt-2 text-sm">
            These are free affiliations. Paid benefits and staff access are
            separate.
          </p>
          <MemberOrganisationsList organisations={organisations} />
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <OrganisationSearch
            joinedIds={organisations.map((organisation) => organisation.id)}
          />
        </section>
      </div>
    </main>
  );
}
