import { notFound, redirect } from "next/navigation";
import { requireOrganisationPermission } from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export default async function LegacyEventsPage({
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
    await requireOrganisationPermission(organisation.id, "events:manage");
  } catch {
    notFound();
  }

  redirect("/dashboard/events");
}
