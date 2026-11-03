"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { verifyBannerCookie } from "@/lib/auth/verify-banner";

// Guidance, not enforcement: closing it hides the reminder on this browser for
// a week. Purchases, joins and invitations still require a verified email on
// the server, and those screens prompt again where it matters. It is ochre,
// because it stops a purchase, and it steps aside (globals.css) on a page that
// already shows its own verify prompt, so there is one Verify button, not two.
export function VerifyEmailBanner({ userId }: { userId: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function dismiss() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${verifyBannerCookie}=${encodeURIComponent(userId)}; Max-Age=604800; Path=/; SameSite=Lax${secure}`;
    setDismissed(true);
  }

  return (
    <div
      aria-label="Email verification"
      className="border-b border-warning-border bg-warning-bg text-sm text-ink"
      data-verify-banner
      role="region"
    >
      <div className="mx-auto flex max-w-page items-center gap-3 py-1 pl-4 pr-2 md:pl-8">
        <Icon className="text-warning-icon" name="mail" />
        <p className="flex-1 py-2">Verify your email to use purchases and society features.</p>
        <Link className={buttonClasses({ variant: "secondary", size: "sm", className: "max-sm:min-h-11" })} href="/verify-email">
          Verify email
        </Link>
        <button
          aria-label="Dismiss email verification reminder"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface hover:text-ink"
          onClick={dismiss}
          type="button"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
