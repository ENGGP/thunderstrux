"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { buttonClasses } from "@/components/ui/button";

const exploreLinks = [
  { href: "/", label: "Explore events" },
  { href: "/societies", label: "Explore societies" }
];

// Session-only header. Society context belongs to the shells below it, which
// receive live authority from the server; nothing here grants or implies access.
export default function Navbar() {
  const { data: session } = useSession();
  const user = session?.user?.id ? session.user : null;
  const accountLinks = user
    ? [
        ...(user.accountRole === "member"
          ? [{ href: "/tickets", label: "My tickets" }]
          : []),
        { href: "/dashboard", label: "Dashboard" },
        { href: "/account/settings", label: "Account" }
      ]
    : [];
  const signOutButton = (
    <button
      className={buttonClasses({ variant: "secondary", size: "sm" })}
      onClick={() => signOut({ callbackUrl: "/" })}
      type="button"
    >
      Sign out
    </button>
  );
  const linkClass = "text-ink-soft transition-colors hover:text-brand";

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[60px] border-b border-line bg-surface md:h-[72px]">
      <div className="mx-auto flex h-full max-w-page items-center gap-6 px-4 text-sm font-medium md:px-8">
        <Link
          className="font-display text-lg font-semibold text-brand-ink"
          href="/"
        >
          Thunderstrux
        </Link>

        <nav
          aria-label="Primary navigation"
          className="hidden flex-1 items-center gap-6 md:flex"
        >
          {exploreLinks.map((link) => (
            <Link className={linkClass} href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
          <span className="ml-auto flex items-center gap-5">
            {accountLinks.map((link) => (
              <Link className={linkClass} href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
            {user ? (
              signOutButton
            ) : (
              <>
                <Link className={linkClass} href="/login">
                  Sign in
                </Link>
                <Link
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  href="/signup"
                >
                  Create a society
                </Link>
              </>
            )}
          </span>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center rounded-control px-3 text-ink-soft [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <nav
              aria-label="Menu"
              className="absolute right-0 top-full mt-2 grid w-56 gap-1 rounded-card border border-line bg-surface p-2 shadow-float"
            >
              {[...exploreLinks, ...accountLinks].map((link) => (
                <Link
                  className="rounded-control px-3 py-2.5 text-ink hover:bg-surface-subtle"
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              ))}
              {user ? null : (
                <Link
                  className="rounded-control px-3 py-2.5 text-ink hover:bg-surface-subtle"
                  href="/signup"
                >
                  Create a society
                </Link>
              )}
            </nav>
          </details>
          {user ? (
            signOutButton
          ) : (
            <Link
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              href="/login"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
