import { notFound, redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export default async function LegacyEditEventPage({
  params
}: {
  params: Promise<{ eventId: string; orgSlug: string }>;
}) {
  const { eventId, orgSlug } = await params;
  const user = await requireAuthenticatedUser();
  const organisation = await prisma.organisation.findFirst({
    where: {
      slug: orgSlug,
      accountUserId: user.id
    },
    select: { id: true }
  });

  if (!organisation) {
    notFound();
  }

  redirect(`/dashboard/events/${eventId}/edit`);
}
