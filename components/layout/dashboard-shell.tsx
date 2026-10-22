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
import { Icon, type IconName } from "@/components/ui/icon";
import { ContextSelector } from "./context-selector";

type NavItem = { label: string; href: string; icon: IconName; permission?: OrganisationPermission };

// Only destinations that exist today. Filtering is presentation: every page
// and API independently enforces the same capability. Daily work first, then
// the society's configuration. Staff authenticator settings live in Account.
const navGroups: Array<{ label?: string; items: NavItem[] }> = [
  {
    items: [
      { label: "Overview", href: "/dashboard", icon: "home" },
      { label: "Events", href: "/dashboard/events", icon: "calendar", permission: "events:read" },
      { label: "Calendar", href: "/dashboard/calendar", icon: "calendarDays", permission: "events:read" },
      { label: "Orders", href: "/dashboard/orders", icon: "receipt", permission: "orders:read" }
    ]
  },
  {
    label: "Community",
    items: [
      { label: "Memberships", href: "/dashboard/memberships", icon: "badge", permission: "memberships:manage" },
      { label: "Merchandise", href: "/dashboard/merchandise", icon: "bag", permission: "merchandise:manage" }
    ]
  },
  {
    label: "Insights",
    items: [
      { label: "Analytics", href: "/dashboard/analytics", icon: "chart", permission: "analytics:read" },
      { label: "History", href: "/dashboard/history", icon: "clock", permission: "audit:read" }
    ]
  },
  {
    label: "Settings",
    items: [
      { label: "Society profile", href: "/dashboard/settings/profile", icon: "profile", permission: "organisation:settings" },
      { label: "Staff", href: "/dashboard/settings/staff", icon: "users", permission: "staff:manage" },
      { label: "Payments", href: "/dashboard/settings", icon: "card", permission: "stripe:manage" },
      { label: "Email delivery", href: "/dashboard/notifications", icon: "mail", permission: "orders:email_resend" }
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
  const menu = (
    <div className="grid gap-5">
      <ContextSelector contexts={contexts} tone="dark" />
      <nav aria-label="Organisation navigation" className="grid gap-1">
        {groups.map((group) => (
          <div className="grid gap-1" key={group.label ?? "main"}>
            {group.label ? (
              <p className="px-3 pt-3 text-xs font-semibold tracking-wide text-white/70">{group.label}</p>
            ) : null}
            {group.items.map((item) => (
              <Link
                aria-current={active === item ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-control border-l-[3px] px-3 text-sm font-medium ${
                  active === item
                    ? "border-brand-200 bg-brand-tint text-brand-ink"
                    : "border-transparent text-white/90 hover:bg-white/10 hover:text-white"
                }`}
                href={item.href}
                key={item.href}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      {/* Stretches with the page; the inner column sticks under the fixed header. */}
      <aside className="bg-brand-ink text-white">
        <div className="px-4 py-3 lg:sticky lg:top-[72px] lg:max-h-[calc(100dvh-72px)] lg:overflow-y-auto lg:py-5">
          <p className="text-xs font-semibold text-white/75">Current organisation</p>
          <p className="font-semibold [overflow-wrap:anywhere]">{orgName}</p>
          <div className="mt-5 hidden lg:block">{menu}</div>
          <details className="group mt-3 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-control border border-white/50 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              Organisation menu
              <Icon className="transition-transform group-open:rotate-180" name="chevronDown" size={16} />
            </summary>
            <div className="mt-4 pb-2">{menu}</div>
          </details>
        </div>
      </aside>
      <main className="min-w-0">
        {/* One content width for every society page. */}
        <div className="mx-auto grid max-w-admin grid-cols-1 gap-6 px-4 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}
