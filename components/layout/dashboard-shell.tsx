import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { label: "Dashboard", href: "" },
  { label: "Events", href: "/events" },
  { label: "Settings", href: "/settings" }
];

export function DashboardShell({
  orgSlug,
  children
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-200 bg-white p-6 md:block">
        <div className="mb-8">
          <p className="text-sm font-semibold text-neutral-900">Thunderstrux</p>
          <p className="mt-1 text-xs text-neutral-500">{orgSlug}</p>
        </div>
        <nav className="grid gap-1">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={`/dashboard/${orgSlug}${item.href}`}
              className="rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="md:pl-64">
        <header className="border-b border-neutral-200 bg-white px-6 py-4">
          <p className="text-sm text-neutral-500">Current organisation</p>
          <h1 className="text-xl font-semibold text-neutral-950">{orgSlug}</h1>
        </header>
        <main className="px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
