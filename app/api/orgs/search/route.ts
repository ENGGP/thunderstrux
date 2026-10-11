import { NextResponse } from "next/server";
import { requireAccountRole } from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import {
  discoveryInput,
  discoverOrganisations,
} from "@/lib/organisations/discovery";
import { organisationError } from "@/lib/organisations/http";
export async function GET(request: Request) {
  try {
    const user = await requireAccountRole("member");
    const params = new URL(request.url).searchParams;
    const page = await discoverOrganisations(discoveryInput(params));
    const joined = new Set(
      (
        await prisma.organisationMember.findMany({
          where: {
            userId: user.id,
            organisationId: { in: page.organisations.map((row) => row.id) },
          },
          select: { organisationId: true },
        })
      ).map((row) => row.organisationId),
    );
    return NextResponse.json(
      {
        organisations: page.organisations.map(({ id, name, slug }) => ({
          id,
          name,
          slug,
          joined: joined.has(id),
        })),
        ...(params.has("limit") || params.has("cursor")
          ? { pageInfo: page.pageInfo }
          : {}),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return organisationError(error);
  }
}
