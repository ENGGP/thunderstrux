import { randomUUID } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authorizeCredentials } from "@/lib/auth/credentials";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { authSecret } from "@/lib/auth/secret";

export { authSecret };

const authRuntime = NextAuth({
  secret: authSecret,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      authorize: authorizeCredentials
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
