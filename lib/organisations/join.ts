import { prisma } from "@/lib/db";
import { lockAccount } from "@/lib/auth/account-lock";
import {
  AccountVerificationError,
  type AccountActor,
} from "@/lib/auth/account-lifecycle";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
} from "@/lib/auth/access";
import { AssetError } from "@/lib/assets/image";

export async function setSocietyJoin(
  actor: AccountActor,
  slug: string,
  joined: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const user = await lockAccount(tx, actor.id);
    if (!user || user.disabledAt || user.authVersion !== actor.authVersion)
      throw new AuthenticationRequiredError();
    if (user.accountRole !== "member")
      throw new OrganisationAccessError(
        "Account role is not allowed for this action",
      );
    if (joined && !user.emailVerifiedAt) throw new AccountVerificationError();
    const organisation = await tx.organisation.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!organisation) throw new AssetError(404, "Organisation was not found");
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisation.id} FOR UPDATE`;
    if (joined)
      await tx.organisationMember.upsert({
        where: {
          userId_organisationId: {
            userId: user.id,
            organisationId: organisation.id,
          },
        },
        update: { role: "member" },
        create: {
          userId: user.id,
          organisationId: organisation.id,
          role: "member",
        },
      });
    else
      await tx.organisationMember.deleteMany({
        where: { userId: user.id, organisationId: organisation.id },
      });
    return { ...organisation, joined };
  });
}
