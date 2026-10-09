import { readAccountContext } from "@/lib/auth/context";
import { notFound, redirect } from "next/navigation";
import { requireOrganisationPermission, StaffMfaRequiredError } from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export default async function LegacySettingsPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await prisma.organisation.findFirst({
    where: {
      slug: orgSlug
    },
    select: { id: true }
  });

  if (!organisation) {
    notFound();
  }

  try {
    await requireOrganisationPermission(organisation.id, "stripe:manage");
  } catch (error) {
    if (error instanceof StaffMfaRequiredError) redirect(`/mfa?callbackUrl=${encodeURIComponent(`/dashboard/${orgSlug}/settings`)}`);
    notFound();
  }

  if ((await readAccountContext()).selected?.id !== organisation.id) redirect("/dashboard");

  redirect("/dashboard/settings");
}
