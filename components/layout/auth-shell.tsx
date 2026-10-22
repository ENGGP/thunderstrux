import type { ReactNode } from "react";

// Narrow, quiet column for sign-in, recovery and other account-security steps.
export function AuthShell({
  title,
  description,
  wide = false,
  children
}: {
  title: string;
  description?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1} className="bg-paper px-4 py-10 sm:py-16">
      <div className={`mx-auto grid gap-5 ${wide ? "max-w-read" : "max-w-auth"}`}>
        <header className="grid gap-1.5">
          <h1 className="text-3xl font-semibold text-ink">{title}</h1>
          {description ? <p className="text-ink-soft">{description}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}
