import "next-auth";

declare module "next-auth" {
  interface User {
    accountRole?: "member" | "organisation";
    firstName?: string | null;
    lastName?: string | null;
    onboardingCompletedAt?: string | null;
  }

  interface Session {
    user: {
      id: string;
      accountRole: "member" | "organisation";
      email?: string | null;
      image?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      name?: string | null;
      onboardingCompletedAt?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    accountRole?: "member" | "organisation";
    firstName?: string | null;
    lastName?: string | null;
    onboardingCompletedAt?: string | null;
  }
}
