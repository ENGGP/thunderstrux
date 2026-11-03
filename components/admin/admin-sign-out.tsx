"use client";

import { signOutTo } from "@/lib/client/sign-out";

export function AdminSignOut() {
  return (
    <button className="min-h-8 rounded-control px-2.5 text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink" onClick={() => signOutTo("/login?callbackUrl=%2Fadmin")} type="button">
      Sign out
    </button>
  );
}
