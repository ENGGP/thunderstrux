"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { verifyBannerCookie } from "@/lib/auth/verify-banner";

// Guidance, not enforcement: closing it hides the reminder on this browser for
// a week. Purchases, joins and invitations still require a verified email on
// the server, and those screens prompt again where it matters.
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
      className="border-b border-info-border bg-info-bg text-sm text-ink"
      role="region"
    >
      <div className="mx-auto flex max-w-page items-center gap-3 py-1 pl-4 pr-2 md:pl-8">
        <Icon className="text-info-icon" name="mail" />
        <p className="flex-1 py-2">
          Verify your email to use purchases and society features.{" "}
          <Link className="font-semibold text-brand underline underline-offset-4" href="/verify-email">
            Verify email
          </Link>
        </p>
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
