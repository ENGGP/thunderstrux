"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

export default function Navbar() {
  const { data: session, status } = useSession();

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-6 shadow-sm">
      <Link href="/" className="text-sm font-semibold text-neutral-950">
        Thunderstrux
      </Link>

      <div className="flex items-center gap-6">
        {session ? (
          <>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-neutral-700 transition hover:text-neutral-950"
            >
              Dashboard
            </Link>
            <button
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950"
              onClick={() => signOut({ callbackUrl: "http://localhost:3000/" })}
              type="button"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="text-sm font-medium text-neutral-700 transition hover:text-neutral-950"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
