import { NextResponse } from "next/server";
import {
  forbidden,
  internalError,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAccountRole
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireAccountRole("member");
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";

    const organisations = await prisma.organisation.findMany({
      where:
        query.length > 0
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { slug: { contains: query.toLowerCase(), mode: "insensitive" } }
              ]
            }
          : undefined,
      orderBy: { name: "asc" },
      take: 25,
      select: {
        id: true,
        name: true,
        slug: true,
        members: {
          where: { userId: user.id },
          select: { id: true },
          take: 1
        }
      }
    });

    return NextResponse.json({
      organisations: organisations.map((organisation) => ({
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
        joined: organisation.members.length > 0
      }))
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to search organisations", error);
    return internalError();
  }
}
