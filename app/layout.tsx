import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { AuthSessionProvider } from "@/components/layout/auth-session-provider";
import Navbar from "@/components/layout/navbar";
import { VerifyEmailBanner } from "@/components/layout/verify-email-banner";
import { accountLinkCaptureScript } from "@/lib/auth/account-link-capture";
import { getLiveSession } from "@/lib/auth/live-session";
import { verifyBannerCookie } from "@/lib/auth/verify-banner";
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
  const user = session?.user;
  const showVerifyBanner =
    user && !user.emailVerifiedAt && (await cookies()).get(verifyBannerCookie)?.value !== user.id;

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
            {showVerifyBanner ? <VerifyEmailBanner userId={user.id} /> : null}
            {children}
          </div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
