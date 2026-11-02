"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRef, type MouseEvent } from "react";
import { signOutTo } from "@/lib/client/sign-out";
import { buttonClasses } from "@/components/ui/button";
import { TabLabel } from "@/components/ui/link-tabs";

const exploreLinks = [
  { href: "/events", label: "Explore events" },
  { href: "/societies", label: "Explore societies" }
];

// Pages a sign-in shouldn't come back to: the auth forms themselves and link-token pages.
const noReturn = /^\/(login|signup|forgot-password|reset-password|verify-email|change-email|staff\/invites\/accept|guest)(\/|$)/;

// Session-only header. Society context belongs to the shells below it, which
// receive live authority from the server; nothing here grants or implies access.
export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "";
  const search = useSearchParams()?.toString() ?? "";
  const menu = useRef<HTMLElement>(null);
  // Dashboard pages have a full-height sidebar at the left edge, so the header spans the window to line up with it.
  const fullWidth = pathname.startsWith("/dashboard");
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Checkout keeps a quiet header: no browsing links to pull the buyer away (visual spec 3.3).
  const checkout = /\/checkout(\/|$)/.test(pathname);
  const user = session?.user?.id ? session.user : null;
  const member = user?.accountRole === "member";
  // Signing in or up from a page comes back to it; login and signup check the path again (safeReturnPath).
  const here = pathname + (search ? `?${search}` : "");
  const back = pathname === "/" || noReturn.test(pathname) ? "" : `callbackUrl=${encodeURIComponent(here)}`;
  const withBack = (href: string) => (back ? `${href}${href.includes("?") ? "&" : "?"}${back}` : href);
  const accountLinks = user
    ? [
        ...(member ? [{ href: "/tickets", label: "My tickets" }] : []),
        { href: "/dashboard", label: "Dashboard" },
        { href: "/account/settings", label: "Account" }
      ]
    : [];
  const signOut = () => signOutTo("/");
  const linkClass = "inline-flex h-full items-center whitespace-nowrap text-ink-soft transition-colors hover:text-brand";
  // The current section: ink text and a brand rule along the header's bottom edge (artboard ExploreEventsA2).
  const navClass = (href: string) =>
    isActive(href) ? "inline-flex h-full items-center whitespace-nowrap font-semibold text-brand-ink shadow-[inset_0_-3px_0_0_var(--ts-brand)]" : linkClass;
  // Phone menu rows: 44px, the current page marked with the brand edge the organiser column uses.
  const rowClass = (href?: string) =>
    `flex min-h-11 w-full items-center rounded-control border-l-[3px] px-3 text-left ${
      href && isActive(href) ? "border-brand bg-brand-tint font-semibold text-brand-ink" : "border-transparent text-ink hover:bg-surface-subtle"
    }`;
  // A tapped link closes the menu, even when it points at the page already open.
  const closeOnLink = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("a")) menu.current?.hidePopover();
  };
  // My tickets sits outside the phone menu, so the menu doesn't name it twice.
  const menuLinks = [...exploreLinks, ...accountLinks.filter((link) => link.href !== "/tickets")];

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[60px] border-b border-line bg-surface md:h-[72px]">
      <div className={`mx-auto flex h-full items-center gap-3 px-4 text-sm font-medium md:gap-6 md:px-8 ${fullWidth ? "lg:pl-4" : "max-w-page"}`}>
        <Link
          className="font-display text-lg font-semibold text-brand-ink"
          href="/"
        >
          Thunderstrux
        </Link>

        <nav
          aria-label="Primary navigation"
          className="hidden h-full flex-1 items-center gap-6 md:flex"
        >
          {(checkout ? [] : exploreLinks).map((link) => (
            <Link
              aria-current={isActive(link.href) ? "page" : undefined}
              className={navClass(link.href)}
              href={link.href}
              key={link.href}
            >
              <TabLabel>{link.label}</TabLabel>
            </Link>
          ))}
          <span className="ml-auto flex h-full items-center gap-5">
            {(checkout ? [] : accountLinks).map((link) => (
              <Link
                aria-current={isActive(link.href) ? "page" : undefined}
                className={navClass(link.href)}
                href={link.href}
                key={link.href}
              >
                <TabLabel>{link.label}</TabLabel>
              </Link>
            ))}
            {user ? (
              <button className={buttonClasses({ variant: "secondary", size: "sm", className: "whitespace-nowrap" })} onClick={signOut} type="button">
                Sign out
              </button>
            ) : (
              <>
                {/* A member account is the common case; a society account is a shared committee login. */}
                <Link className={linkClass} href="/signup?for=society">
                  Create a society
                </Link>
                <Link className={linkClass} href={withBack("/login")}>
                  Sign in
                </Link>
                <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={withBack("/signup")}>
                  Sign up
                </Link>
              </>
            )}
          </span>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          {/* What a member opens a phone for is their ticket, so it stays out of the menu. */}
          {member && !checkout ? (
            <Link aria-current={isActive("/tickets") ? "page" : undefined} className={buttonClasses({ variant: "secondary", className: "whitespace-nowrap px-3!" })} href="/tickets">
              {/* At 320px "tickets" alone fits beside Menu; the name still reads "My tickets". */}
              {/* One inline run, so the button's flex gap doesn't widen the word space. */}
              <span>
                <span className="max-[359px]:sr-only">My </span>tickets
              </span>
            </Link>
          ) : null}
          {checkout ? null : (
            <>
              <button className={buttonClasses({ variant: "secondary", className: "px-3!" })} popoverTarget="site-menu" type="button">
                Menu
              </button>
              {/* A popover, as the event More menu is: Escape and a tap outside close it. */}
              <nav
                aria-label="Menu"
                className="fixed inset-auto right-4 top-[64px] m-0 w-60 rounded-card border border-line bg-surface p-2 shadow-float"
                id="site-menu"
                onClick={closeOnLink}
                popover="auto"
                ref={menu}
              >
                <div className="grid gap-1">
                  {menuLinks.map((link) => (
                    <Link aria-current={isActive(link.href) ? "page" : undefined} className={rowClass(link.href)} href={link.href} key={link.href}>
                      {link.label}
                    </Link>
                  ))}
                  {user ? (
                    <>
                      <div aria-hidden="true" className="my-1 border-t" />
                      <button className={rowClass()} onClick={signOut} type="button">
                        Sign out
                      </button>
                    </>
                  ) : (
                    <>
                      <Link className={rowClass("/signup")} href={withBack("/signup")}>
                        Sign up
                      </Link>
                      <Link className={rowClass()} href="/signup?for=society">
                        Create a society
                      </Link>
                    </>
                  )}
                </div>
              </nav>
            </>
          )}
          {user ? null : (
            <Link className={buttonClasses({ variant: "secondary", className: "whitespace-nowrap px-3!" })} href={withBack("/login")}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
