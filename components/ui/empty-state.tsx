import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

// A list with nothing in it: one reason and one action. Failures and denied
// access use a Notice instead, so they never read as "nothing here".
export function EmptyState({
  icon = "search",
  title,
  children,
  action
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="grid justify-items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <Icon className="text-brand" name={icon} size={40} />
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      {children ? <p className="max-w-prose text-ink-soft">{children}</p> : null}
      {action}
    </section>
  );
}
