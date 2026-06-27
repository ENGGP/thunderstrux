import { notFound, redirect } from "next/navigation";
import { requireAnyOrganisationPermission } from "@/lib/auth/access";
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
  } catch {
    notFound();
  }

  redirect("/dashboard");
}
