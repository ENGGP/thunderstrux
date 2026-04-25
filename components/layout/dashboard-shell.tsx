import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { label: "Dashboard", href: "", active: true },
  { label: "Events", href: "/events", active: false },
  { label: "Orders", href: "/orders", active: false },
  { label: "Settings", href: "/settings", active: false }
];

export function DashboardShell({
  orgName,
  orgSlug,
  children
}: {
  orgName: string;
  orgSlug: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-100">
      <aside className="fixed bottom-0 left-0 top-16 hidden w-64 border-r border-neutral-200 bg-white p-6 shadow-sm md:block">
        <nav className="grid gap-6">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={`/dashboard/${orgSlug}${item.href}`}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                item.active
                  ? "bg-neutral-100 font-semibold text-neutral-900"
                  : "font-medium text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="md:ml-64">
        <header className="border-b border-neutral-200 bg-white px-6 py-6 shadow-sm">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm text-neutral-500">Current organisation</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-950">
              {orgName}
            </h1>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
