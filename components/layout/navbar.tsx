"use client";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
export default function Navbar() {
  const { data: session } = useSession();
  const accountLinks = (
    <>
      <Link href="/dashboard">Dashboard</Link>
      {session?.user?.accountRole === "member" && (
        <Link href="/tickets">My tickets</Link>
      )}
      <Link href="/account/settings">Settings</Link>
    </>
  );
  const logout = (
    <button
      className="rounded-lg border border-neutral-300 px-2 py-2 text-sm font-medium transition hover:bg-neutral-100 sm:px-4"
      onClick={() => signOut({ callbackUrl: "/" })}
      type="button"
    >
      Sign out
    </button>
  );
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between gap-2 border-b border-neutral-200 bg-white px-3 shadow-sm sm:px-6">
      <Link
        href={
          session?.user?.accountRole === "organisation" ? "/dashboard" : "/"
        }
        className="text-sm font-semibold text-neutral-950"
      >
        Thunderstrux
      </Link>
      <nav
        aria-label="Primary navigation"
        className="hidden items-center gap-6 text-sm font-medium text-neutral-700 md:flex"
      >
        <Link href="/organisations">Societies</Link>
        {session?.user?.id ? (
          <>
            {accountLinks}
            {logout}
          </>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </nav>
      <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 md:hidden">
        <Link href="/organisations">Societies</Link>
        {session?.user?.id ? (
          <>
            <details className="relative">
              <summary className="cursor-pointer rounded-md px-2 py-2">
                Menu
              </summary>
              <nav
                aria-label="Account navigation"
                className="absolute right-0 top-full grid w-48 gap-4 rounded-md border bg-white p-4 shadow-md"
              >
                {accountLinks}
              </nav>
            </details>
            {logout}
          </>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </div>
    </header>
  );
}
