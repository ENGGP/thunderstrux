import { prisma } from "@/lib/db";
import {
  lockVerifiedAccount,
  type AccountActor,
} from "@/lib/auth/account-lifecycle";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
} from "@/lib/auth/access";
import { normaliseSlug } from "@/lib/validators/slug";
import { createOrganisationSchema } from "@/lib/validators/orgs";

export async function bootstrapOrganisation(
  actor: AccountActor,
  input: { name: string; slug?: string },
) {
  input = createOrganisationSchema.parse(input);
  const baseSlug = normaliseSlug(input.slug ?? input.name);
  if (!baseSlug)
    throw new OrganisationAccessError(
      "Organisation slug must contain letters or numbers",
    );
  for (let suffix = 0; suffix < 100; suffix++) {
    const slug = suffix ? `${baseSlug}-${suffix + 1}` : baseSlug;
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await lockVerifiedAccount(tx, actor.id);
        if (user.authVersion !== actor.authVersion)
          throw new AuthenticationRequiredError();
        if (user.accountRole !== "organisation")
          throw new OrganisationAccessError(
            "Account role is not allowed for this action",
          );
        const existing = await tx.organisation.findMany({
          where: {
            OR: [
              { accountUserId: user.id },
              { staff: { some: { userId: user.id, status: "active" } } },
            ],
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        for (const row of existing)
          await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${row.id} FOR UPDATE`;
        if (existing.length)
          throw new OrganisationAccessError(
            "Organisation account already has an organisation",
          );
        const organisation = await tx.organisation.create({
          data: { name: input.name, slug, accountUserId: user.id },
          select: { id: true, name: true, slug: true, createdAt: true },
        });
        await tx.organisationMember.create({
          data: {
            organisationId: organisation.id,
            userId: user.id,
            role: "org_owner",
          },
        });
        await tx.organisationStaff.create({
          data: {
            organisationId: organisation.id,
            userId: user.id,
            role: "owner",
            status: "active",
            acceptedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            organisationId: organisation.id,
            actorUserId: user.id,
            action: "organisation.created",
            targetType: "Organisation",
            targetId: organisation.id,
          },
        });
        return organisation;
      });
    } catch (error) {
      const constraint = error as {
        code?: string;
        meta?: { target?: string[] };
      };
      if (
        constraint.code === "P2002" &&
        constraint.meta?.target?.includes("slug")
      )
        continue;
      throw error;
    }
  }
  throw new OrganisationAccessError(
    "Unable to generate a unique organisation slug",
  );
}
