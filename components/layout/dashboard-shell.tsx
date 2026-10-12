"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { ContextChoices } from "@/lib/auth/context";
import {
  hasOrganisationPermission,
  type OrganisationPermission,
  type OrganisationStaffRole
} from "@/lib/permissions";
import { ContextSelector } from "./context-selector";

type NavItem = { label: string; href: string; permission?: OrganisationPermission };

// Only destinations that exist today. Filtering is presentation: every page
// and API independently enforces the same capability.
const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Run",
    items: [
      { label: "Overview", href: "/dashboard" },
      { label: "Events", href: "/dashboard/events", permission: "events:read" },
      { label: "Orders", href: "/dashboard/orders", permission: "orders:read" }
    ]
  },
  {
    label: "Understand",
    items: [
      { label: "Payments", href: "/dashboard/settings", permission: "stripe:manage" }
    ]
  },
  {
    label: "Settings & tools",
    items: [
      { label: "Staff", href: "/dashboard/settings/staff", permission: "staff:manage" },
      { label: "Settings", href: "/dashboard/settings/profile", permission: "organisation:settings" },
      { label: "Notifications", href: "/dashboard/notifications", permission: "orders:email_resend" }
    ]
  }
];

export function DashboardShell({
  orgName,
  staffRole,
  contexts,
  children
}: {
  orgName: string;
  staffRole: OrganisationStaffRole;
  contexts: ContextChoices;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const groups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.permission || hasOrganisationPermission(staffRole, item.permission)
      )
    }))
    .filter((group) => group.items.length > 0);
  // The longest matching route wins, so /dashboard/settings/staff marks Staff, not Payments.
  const active = groups
    .flatMap((group) => group.items)
    .filter(
      (item) =>
        pathname === item.href ||
        (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  const itemClass = "flex min-h-10 items-center rounded-control border-l-[3px] px-3 text-sm font-medium";
  const menu = (
    <div className="grid gap-4">
      <ContextSelector contexts={contexts} />
      <nav aria-label="Organisation navigation" className="grid gap-1">
        {groups.map((group) => (
          <div className="grid gap-1" key={group.label}>
            <p className="px-3 pt-3 text-xs font-semibold text-white/60">
              {group.label}
            </p>
            {group.items.map((item) => (
              <Link
                aria-current={active === item ? "page" : undefined}
                className={`${itemClass} ${
                  active === item
                    ? "border-brand bg-brand-tint text-brand-ink"
                    : "border-transparent text-white/85 hover:bg-white/10 hover:text-white"
                }`}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <Link
          className={`${itemClass} border-transparent text-white/85 underline underline-offset-4 hover:text-white`}
          href="/mfa?callbackUrl=/dashboard"
        >
          Staff MFA
        </Link>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper">
      <aside className="fixed bottom-0 left-0 top-[72px] hidden w-[244px] overflow-y-auto bg-brand-ink p-4 text-white lg:block">
        {menu}
      </aside>
      <div className="lg:ml-[244px]">
        <header className="border-b border-line bg-surface px-4 py-5 sm:px-8">
          <p className="text-sm text-ink-muted">Current organisation</p>
          <h1 className="text-2xl font-semibold text-ink">{orgName}</h1>
          <details className="mt-4 lg:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-brand">
              Organisation menu
            </summary>
            <div className="mt-3 rounded-card bg-brand-ink p-4 text-white">
              {menu}
            </div>
          </details>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
