import { notFound, redirect } from "next/navigation";
import { requireAnyOrganisationPermission, StaffMfaRequiredError } from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export default async function LegacyDashboardPage({
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
    await requireAnyOrganisationPermission(organisation.id, [
      "events:manage",
      "orders:read",
      "tickets:check_in",
      "stripe:manage",
      "staff:manage"
    ]);
  } catch (error) {
    if (error instanceof StaffMfaRequiredError) redirect(`/mfa?callbackUrl=${encodeURIComponent(`/dashboard/${orgSlug}`)}`);
    notFound();
  }

  redirect("/dashboard");
}
