import { compare } from "bcryptjs";
import { randomUUID } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { getSessionIdentity } from "@/lib/auth/session-identity";

const unsafeAuthSecrets = new Set([
  "",
  "dev-secret",
  "replace-with-a-non-empty-secret"
]);

function resolveAuthSecret() {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  const isProduction = process.env.NODE_ENV === "production";
  const isBuild = process.env.npm_lifecycle_event === "build";

  if (isProduction && !isBuild && unsafeAuthSecrets.has(secret)) {
    throw new Error(
      "AUTH_SECRET must be set to a strong non-placeholder value in production."
    );
  }

  if (unsafeAuthSecrets.has(secret)) {
    if (!isBuild) {
      console.warn(
        "AUTH_SECRET is using a development fallback. Set AUTH_SECRET in .env for persistent local sessions."
      );
    }

    return "dev-only-auth-secret";
  }

  return secret;
}

export const authSecret = resolveAuthSecret();

const authRuntime = NextAuth({
  secret: authSecret,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
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
    })
  ],
  pages: {
    signIn: "/login"
  },
  callbacks: {
    async jwt({ token, user }) {
      // Only a new password sign-in can establish a persistent MFA login ID.
      // Server-side auth() reads cannot persist a refreshed JWT for old cookies.
      if (user?.id) {
        token.staffMfaSessionId = randomUUID();
        token.authVersion = user.authVersion;
      }
      if (user?.id) {
        token.userId = user.id;
      }

      if (user && "accountRole" in user) {
        token.accountRole = user.accountRole as "member" | "organisation";
      }

      if (user && "firstName" in user) {
        token.firstName = user.firstName as string | null;
      }

      if (user && "lastName" in user) {
        token.lastName = user.lastName as string | null;
      }

      if (user && "onboardingCompletedAt" in user) {
        token.onboardingCompletedAt = user.onboardingCompletedAt as string | null;
      }

      return token;
    },
    async session({ session, token }) {
      const identity = await getSessionIdentity(token.userId, token.authVersion);
      if (!identity) return { expires: session.expires };
      if (session.user) {
        session.user.authVersion = token.authVersion;
        session.user.staffMfaSessionId = token.staffMfaSessionId as string;
        session.user.id = token.userId as string;
        session.user.email = identity.email;
        session.user.accountRole = identity.accountRole;
        session.user.firstName = identity.firstName;
        session.user.lastName = identity.lastName;
        session.user.onboardingCompletedAt = identity.onboardingCompletedAt?.toISOString() ?? null;
        session.user.emailVerifiedAt = identity.emailVerifiedAt?.toISOString() ?? null;
      }

      return session;
    }
  }
});

export const { auth, signIn, signOut } = authRuntime;
export const handlers = {
  POST: authRuntime.handlers.POST,
  async GET(request: import("next/server").NextRequest) {
    const response = await authRuntime.handlers.GET(request);
    if (new URL(request.url).pathname.endsWith("/api/auth/session")) {
      const session = await response.clone().json().catch(() => null);
      if (!session?.user?.id) {
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response("null", { status: response.status, headers });
      }
    }
    return response;
  }
};
