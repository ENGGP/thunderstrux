import { compare } from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";

export const authSecret = process.env.AUTH_SECRET || "dev-secret";

export const { auth, handlers, signIn, signOut } = NextAuth({
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
            accountRole: true,
            firstName: true,
            lastName: true,
            onboardingCompletedAt: true
          }
        });

        if (!user) {
          return null;
        }

        const isValidPassword = await compare(password, user.password);

        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
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
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.accountRole = token.accountRole ?? "member";
        session.user.firstName = token.firstName ?? null;
        session.user.lastName = token.lastName ?? null;
        session.user.onboardingCompletedAt = token.onboardingCompletedAt ?? null;
      }

      return session;
    }
  }
});
