import type { Metadata } from "next";
import { auth } from "@/auth";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AuthSessionProvider } from "@/components/layout/auth-session-provider";
import Navbar from "@/components/layout/navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thunderstrux",
  description: "Multi-tenant SaaS for student societies"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const identity = session?.user?.id ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailVerifiedAt: true, disabledAt: true } }) : null;

  return (
    <html lang="en">
      <body>
        <AuthSessionProvider session={session}>
          <Navbar />
          <div className="pt-16">
            {identity && !identity.disabledAt && !identity.emailVerifiedAt && <p role="status" className="bg-amber-50 px-4 py-3 text-center text-sm">Verify your email to use purchases and society features. <Link className="underline" href="/verify-email">Send verification email</Link></p>}
            {children}
          </div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
