import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

// The one h1 of a dashboard page, its optional trail back up and its primary action.
export function PageHeader({
  title,
  description,
  breadcrumbs = [],
  actions
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Array<{ label: string; href: string }>;
  actions?: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      {breadcrumbs.length ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
          {breadcrumbs.map((crumb) => (
            <span className="flex items-center gap-1.5" key={crumb.href}>
              <Link className="font-semibold text-brand underline underline-offset-4" href={crumb.href}>
                {crumb.label}
              </Link>
              <Icon name="chevronRight" size={14} />
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <h1 className="text-3xl font-semibold text-ink [overflow-wrap:anywhere]">{title}</h1>
          {description ? <p className="text-ink-soft">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
