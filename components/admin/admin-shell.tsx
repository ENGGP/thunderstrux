import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { appUrl } from "@/lib/app-url";
import { hasPlatformPermission, type PlatformPermission } from "@/lib/permissions/platform";
import type { PlatformActor } from "@/lib/platform/authority";
import { AdminCodeOff } from "./action-dialog";
import { AdminSignOut } from "./admin-sign-out";
import { Omnibox } from "./omnibox";
import { VerifyWindow } from "./verify-window";

// T54 (round H, board H1): the admin portal's own shell. Neutral white and ink,
// never the society's night violet, so it can't be mistaken for a society
// dashboard. The environment band leads every page.
export function adminEnvironment() {
  let host = "";
  try { host = new URL(appUrl() ?? "").hostname; } catch { /* unset: treated as dev */ }
  const stripe = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") ? "Stripe live mode" : "Stripe test mode";
  if (host === "thunderstrux.com" || host === "www.thunderstrux.com") return { label: "PRODUCTION", className: "bg-[#9e122f] text-white", host, stripe };
  if (!host || host === "localhost" || host === "127.0.0.1") return { label: "DEV", className: "bg-[#e4e1ea] text-[#2f2a3a]", host: host || "local", stripe };
  return { label: "PREVIEW", className: "bg-[#f4cc64] text-ink", host, stripe };
}

type Section = "overview" | "users" | "societies" | "orders" | "operations" | "audit" | "operators";
const sections: Array<{ key: Section; href: string; label: string; icon: IconName; permission: PlatformPermission; group?: string }> = [
  { key: "overview", href: "/admin", label: "Overview", icon: "home", permission: "platform:monitor" },
  { key: "users", href: "/admin/users", label: "Users", icon: "users", permission: "platform:read" },
  { key: "societies", href: "/admin/societies", label: "Societies", icon: "profile", permission: "platform:read" },
  { key: "orders", href: "/admin/orders", label: "Orders", icon: "receipt", permission: "platform:read" },
  { key: "operations", href: "/admin/operations", label: "Operations", icon: "zap", permission: "platform:monitor", group: "Platform" },
  { key: "audit", href: "/admin/audit", label: "Audit", icon: "clock", permission: "platform:audit_read" },
  { key: "operators", href: "/admin/operators", label: "Operators", icon: "shield", permission: "platform:operators" }
];

const operatorName = (actor: PlatformActor) => actor.user.email;

export function AdminShell({ actor, current, children }: { actor: PlatformActor; current: Section; children: ReactNode }) {
  const environment = adminEnvironment();
  const started = new Date(Date.now() - process.uptime() * 1000);
  const visible = sections.filter((section) => hasPlatformPermission(actor.role, section.permission));
  return (
    // Cancels the site header's offset: this shell replaces the header (the navbar steps aside on /admin).
    <div className="-mt-[60px] flex min-h-dvh flex-col bg-[#f6f5f8] text-sm text-ink md:-mt-[72px]" data-admin-shell>
      <p className={`flex flex-wrap items-center gap-x-3 px-5 py-1 text-xs font-bold tracking-wider ${environment.className}`}>
        {environment.label}
        <span className="font-medium tracking-normal">
          {environment.host} · admin process started {started.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" })} · {environment.stripe}
        </span>
      </p>
      <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-5 py-2">
        <Link className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink" href="/admin">
          Thunderstrux
          <span className="rounded-[5px] bg-ink px-1.5 py-1 font-sans text-[11px] font-bold leading-none tracking-widest text-white">ADMIN</span>
        </Link>
        <Omnibox />
        <div className="ml-auto flex items-center gap-3">
          {actor.mfaOff ? (
            <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-subtle px-2.5 text-[13px] font-semibold text-ink-soft">
              <Icon name="warning" size={16} />No code (dev)
            </span>
          ) : <VerifyWindow endsAt={actor.windowEndsAt.toISOString()} />}
          <span className="flex flex-col text-xs leading-tight text-ink-muted">
            <strong className="text-sm text-ink">{operatorName(actor)}</strong>
            {actor.role}
          </span>
          <AdminSignOut />
        </div>
      </header>
      <div className="flex flex-1 flex-wrap">
        <nav aria-label="Admin navigation" className="flex flex-[0_0_200px] flex-col gap-0.5 border-r border-line bg-surface px-2.5 py-3.5">
          {visible.map((section) => (
            <div className="contents" key={section.key}>
              {section.group ? <p className="mb-1 mt-3.5 px-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{section.group}</p> : null}
              <Link
                aria-current={section.key === current ? "page" : undefined}
                className={`flex min-h-[38px] items-center gap-2.5 rounded-[7px] px-2.5 font-medium ${section.key === current
                  ? "bg-[#efedf3] font-semibold text-ink shadow-[inset_3px_0_0_var(--ts-ink)]"
                  : "text-ink-soft hover:bg-surface-subtle hover:text-ink"}`}
                href={section.href}
              >
                <Icon name={section.icon} size={18} />
                {section.label}
              </Link>
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-[999_1_540px] px-7 pb-10 pt-6" id="main" tabIndex={-1}>
          <div className="mx-auto flex max-w-[1180px] flex-col gap-[18px]">{actor.mfaOff ? <AdminCodeOff>{children}</AdminCodeOff> : children}</div>
        </main>
      </div>
    </div>
  );
}
