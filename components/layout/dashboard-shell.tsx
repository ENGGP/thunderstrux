import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { label: "Dashboard", href: "", active: true },
  { label: "Events", href: "/events", active: false },
  { label: "Settings", href: "/settings", active: false }
];

export function DashboardShell({
  orgSlug,
  children
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-200 bg-white p-6 shadow-md md:block">
        <div className="mb-10">
          <p className="text-sm font-semibold text-neutral-900">Thunderstrux</p>
          <p className="mt-1 text-xs text-neutral-500">{orgSlug}</p>
        </div>
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
      <div className="md:pl-64">
        <header className="border-b border-neutral-200 bg-white px-6 py-6 shadow-sm">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div className="grid gap-2">
              <p className="text-sm text-neutral-500">Current organisation</p>
              <h1 className="text-3xl font-semibold text-neutral-950">{orgSlug}</h1>
            </div>
            <nav className="mb-6 flex flex-wrap gap-6 border-b border-neutral-200 pb-4">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={`/dashboard/${orgSlug}${item.href}`}
                  className={`text-sm transition ${
                    item.active
                      ? "font-semibold text-neutral-900"
                      : "font-medium text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
