"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { ContextChoices } from "@/lib/auth/context";
import { Icon, type IconName } from "@/components/ui/icon";
import { ContextSelector } from "./context-selector";

// The signed-in person's own area. It never shows society management tools;
// staff switch to a society through the explicit context selector.
export function PersonalShell({
  accountRole = "member",
  contexts,
  children
}: {
  accountRole?: "member" | "organisation";
  contexts?: ContextChoices;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const items: Array<{ label: string; href: string; icon: IconName }> = [
    { label: "Overview", href: "/dashboard", icon: "home" },
    ...(accountRole === "member"
      ? [
          { label: "My tickets", href: "/tickets", icon: "ticket" as const },
          { label: "Societies", href: "/dashboard/organisations", icon: "users" as const }
        ]
      : []),
    { label: "Account", href: "/account/settings", icon: "user" }
  ];

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto grid max-w-personal gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10 lg:py-10">
        <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start">
          <p className="w-fit rounded-tag bg-brand-tint px-2 py-1 text-xs font-semibold text-brand-ink">
            Personal
          </p>
          <nav
            aria-label="Personal navigation"
            className="flex gap-1 overflow-x-auto lg:grid"
          >
            {items.map((item) => (
              <Link
                aria-current={pathname === item.href ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-control px-3 text-sm font-medium ${
                  pathname === item.href
                    ? "bg-brand-tint text-brand-ink"
                    : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
                }`}
                href={item.href}
                key={item.href}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </nav>
          {contexts ? <ContextSelector contexts={contexts} /> : null}
        </aside>
        <main className="grid min-w-0 content-start gap-6">{children}</main>
      </div>
    </div>
  );
}
