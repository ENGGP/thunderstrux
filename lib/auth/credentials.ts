import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";

// A cost-12 hash of a random string nobody knows, the same cost as real
// passwords (lib/auth/account-lifecycle.ts). An unknown or disabled address is
// checked against it, so sign-in takes as long whether or not an account
// exists, as signup and recovery already conceal it (DEF-035).
const dummyPasswordHash = "$2b$12$EovpF930ss1ynjK3OyY2VedpzGSc/Uqk5pcvZgTj6GzmqgGFBIXBu";

// The Credentials provider's sign-in check (auth.ts).
export async function authorizeCredentials(credentials: Partial<Record<string, unknown>> | undefined) {
  const email =
    typeof credentials?.email === "string"
      ? credentials.email.trim().toLowerCase()
      : "";
  const password =
    typeof credentials?.password === "string" ? credentials.password : "";

  if (!email || !password) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      disabledAt: true,
      authVersion: true,
      accountRole: true,
      firstName: true,
      lastName: true,
      onboardingCompletedAt: true
    }
  });

  if (!user || user.disabledAt) {
    await compare(password, dummyPasswordHash);
    return null;
  }

  const isValidPassword = await compare(password, user.password);

  if (!isValidPassword) {
    return null;
  }

  return {
    id: user.id,
    authVersion: user.authVersion,
    email: user.email,
    accountRole: user.accountRole,
    firstName: user.firstName,
    lastName: user.lastName,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null
  };
}
