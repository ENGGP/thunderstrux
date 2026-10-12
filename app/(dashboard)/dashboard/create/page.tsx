import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  OrganisationAccessError,
  getCurrentOrganisationAccount,
  requireAccountRole
} from "@/lib/auth/access";
import { AuthShell } from "@/components/layout/auth-shell";
import { CreateOrganisationForm } from "@/components/organisations/create-organisation-form";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Create a society" };

export default async function CreateOrganisationPage() {
  try {
    await requireAccountRole("organisation");
    const organisation = await getCurrentOrganisationAccount();

    if (organisation) {
      redirect("/dashboard");
    }
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      redirect("/dashboard");
    }

    throw error;
  }

  return (
    <AuthShell
      description="Start with the name. Next you add a description, contact address and branding, and you can come back to any step later."
      title="Create a society"
    >
      <Card>
        <CreateOrganisationForm />
      </Card>
    </AuthShell>
  );
}
