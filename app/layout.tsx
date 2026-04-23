import type { Metadata } from "next";
import { auth } from "@/auth";
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

  return (
    <html lang="en">
      <body>
        <AuthSessionProvider session={session}>
          <Navbar />
          <div className="pt-16">{children}</div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
