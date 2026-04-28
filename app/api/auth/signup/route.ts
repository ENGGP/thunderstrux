import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { badRequest, internalError, validationError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { validateJson } from "@/lib/validators";
import { signupSchema } from "@/lib/validators/auth";

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function POST(request: Request) {
  const validation = await validateJson(request, signupSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const password = await hash(validation.data.password, 12);
    const user = await prisma.user.create({
      data: {
        email: validation.data.email,
        password,
        accountRole: validation.data.accountRole,
        firstName: validation.data.firstName || null,
        lastName: validation.data.lastName || null,
        onboardingCompletedAt:
          validation.data.accountRole === "member" &&
          validation.data.firstName &&
          validation.data.lastName
            ? new Date()
            : null
      },
      select: {
        id: true,
        email: true,
        accountRole: true,
        firstName: true,
        lastName: true,
        onboardingCompletedAt: true,
        createdAt: true
      }
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      return badRequest("Email is already registered", [
        { path: ["email"], message: "Use a different email or sign in" }
      ]);
    }

    console.error("Failed to create user", error);
    return internalError();
  }
}
