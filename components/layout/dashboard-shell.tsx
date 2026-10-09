"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { hasOrganisationPermission, type OrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";
import { ContextSelector } from "./context-selector";
const navItems: Array<{ label: string; href: string; permission?: OrganisationPermission }> = [
  { label: "Dashboard", href: "" }, { label: "Events", href: "/events", permission: "events:read" },
  { label: "Orders", href: "/orders", permission: "orders:read" },
  { label: "Notifications", href: "/notifications", permission: "orders:email_resend" },
  { label: "Stripe settings", href: "/settings", permission: "stripe:manage" },
  { label: "Staff", href: "/settings/staff", permission: "staff:manage" }
];
export function DashboardShell({ basePath = "/dashboard", orgName, staffRole, children }: {
  basePath?: string; orgName: string; orgSlug?: string; staffRole: OrganisationStaffRole; children: ReactNode
}) {
  const pathname = usePathname() ?? "";
  const items = navItems.filter(item => !item.permission || hasOrganisationPermission(staffRole, item.permission));
  const active = items.filter(item => pathname === `${basePath}${item.href}` ||
    (item.href && pathname.startsWith(`${basePath}${item.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  const navigation = <nav aria-label="Organisation navigation" className="grid gap-3">
    {items.map(item => <Link key={item.href} href={`${basePath}${item.href}`} aria-current={active === item ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm ${active === item ? "bg-neutral-100 font-semibold" : "text-neutral-700 hover:bg-neutral-50"}`}>
      {item.label}</Link>)}
    <Link className="px-3 py-2 text-sm underline" href="/mfa?callbackUrl=/dashboard">Staff MFA</Link>
  </nav>;
  return <div className="min-h-screen bg-neutral-100">
    <aside className="fixed bottom-0 left-0 top-16 hidden w-64 overflow-y-auto border-r bg-white p-4 md:block">
      <ContextSelector />{navigation}</aside>
    <div className="md:ml-64"><header className="border-b bg-white px-6 py-6">
      <p className="text-sm text-neutral-600">Current organisation</p><h1 className="text-3xl font-semibold">{orgName}</h1>
      <details className="mt-4 md:hidden"><summary className="cursor-pointer">Organisation menu</summary><ContextSelector />{navigation}</details>
    </header><main>{children}</main></div>
  </div>;
}
