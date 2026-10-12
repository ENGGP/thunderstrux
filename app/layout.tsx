import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { AuthSessionProvider } from "@/components/layout/auth-session-provider";
import Navbar from "@/components/layout/navbar";
import { accountLinkCaptureScript } from "@/lib/auth/account-link-capture";
import { getLiveSession } from "@/lib/auth/live-session";
import "./globals.css";

// Downloaded at build time and served by the app; no font requests leave the site.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap"
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap"
});

export const metadata: Metadata = {
  title: { default: "Thunderstrux", template: "%s · Thunderstrux" },
  description: "Events, tickets and tools for student societies"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getLiveSession();

  return (
    <html
      className={`${dmSans.variable} ${spaceGrotesk.variable}`}
      lang="en-AU"
    >
      <head>
        <script
          data-account-link-capture
          dangerouslySetInnerHTML={{ __html: accountLinkCaptureScript }}
        />
      </head>
      <body>
        <AuthSessionProvider session={session}>
          <Navbar />
          <div className="pt-[60px] md:pt-[72px]">
            {session?.user && !session.user.emailVerifiedAt && (
              <p
                className="bg-warning-bg px-4 py-3 text-center text-sm text-warning"
                role="status"
              >
                Verify your email to use purchases and society features.{" "}
                <Link className="font-semibold underline" href="/verify-email">
                  Send verification email
                </Link>
              </p>
            )}
            {children}
          </div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
