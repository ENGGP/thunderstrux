import { NextResponse } from "next/server";
import {
  forbidden,
  internalError,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAccountRole
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { validateJson } from "@/lib/validators";
import { memberProfileSchema } from "@/lib/validators/auth";

export async function PATCH(request: Request) {
  const validation = await validateJson(request, memberProfileSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const user = await requireAccountRole("member");
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        displayName: validation.data.displayName || null,
        phone: validation.data.phone || null,
        studentNumber: validation.data.studentNumber || null,
        onboardingCompletedAt: new Date()
      },
      select: {
        id: true,
        email: true,
        accountRole: true,
        firstName: true,
        lastName: true,
        displayName: true,
        phone: true,
        studentNumber: true,
        onboardingCompletedAt: true
      }
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to update member profile", error);
    return internalError();
  }
}
