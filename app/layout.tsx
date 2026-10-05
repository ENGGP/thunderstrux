import type { Metadata } from "next";
import { getLiveSession } from "@/lib/auth/live-session";
import Link from "next/link";
import { AuthSessionProvider } from "@/components/layout/auth-session-provider";
import Navbar from "@/components/layout/navbar";
import { accountLinkCaptureScript } from "@/lib/auth/account-link-capture";
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
  const session = await getLiveSession();


  return (
    <html lang="en">
      <head><script data-account-link-capture dangerouslySetInnerHTML={{ __html: accountLinkCaptureScript }} /></head>
      <body>
        <AuthSessionProvider session={session}>
          <Navbar />
          <div className="pt-16">
            {session?.user && !session.user.emailVerifiedAt && <p role="status" className="bg-amber-50 px-4 py-3 text-center text-sm">Verify your email to use purchases and society features. <Link className="underline" href="/verify-email">Send verification email</Link></p>}
            {children}
          </div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
