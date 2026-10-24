import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { OrganisationSearch } from "@/components/organisations/organisation-search";
import { MemberOrganisationsList } from "@/components/organisations/member-organisations-list";
import { Card } from "@/components/ui/card";
import {
  OrganisationAccessError,
  requireAccountRole,
  getAccessibleOrganisationsForCurrentAccount,
} from "@/lib/auth/access";

export const metadata: Metadata = { title: "Societies" };

export default async function MemberOrganisationsPage() {
  try {
    await requireAccountRole("member");
  } catch (error) {
    if (error instanceof OrganisationAccessError) redirect("/dashboard");
    throw error;
  }
  const organisations = await getAccessibleOrganisationsForCurrentAccount();
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
        <MemberOrganisationsList organisations={organisations} />
      </Card>
      <Card>
        <OrganisationSearch
          joinedIds={organisations.map((organisation) => organisation.id)}
        />
      </Card>
    </PersonalShell>
  );
}
