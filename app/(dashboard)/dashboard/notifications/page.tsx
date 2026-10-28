import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listFailedBusinessNotifications, NotificationCursorError } from "@/lib/email/notification-outbox";
import { requireManagementPage } from "@/lib/auth/page-access";
import { FailedNotifications } from "@/components/settings/failed-notifications";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/ui/pager";

export const metadata: Metadata = { title: "Email delivery" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string; direction?: string }> }) {
  const organisation = await requireManagementPage("orders:email_resend", "/dashboard/notifications");
  const { cursor, direction } = await searchParams;
  let page;
  try { page = await listFailedBusinessNotifications(organisation.id, cursor, direction === "prev" ? "prev" : "next"); }
  catch (error) { if (error instanceof NotificationCursorError) redirect("/dashboard/notifications"); throw error; }
  const pageHref = (at: string | null, way: "next" | "prev") =>
    at && `/dashboard/notifications?${new URLSearchParams({ cursor: at, ...(way === "prev" ? { direction: way } : {}) })}`;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        description="Society emails that could not be delivered. Check why each one failed, then send it again."
        title="Email delivery"
      />
      <div className="grid max-w-4xl gap-4">
        <FailedNotifications jobs={page.jobs} />
        <Pager
          label="Failed email pages"
          next={pageHref(page.nextCursor, "next")}
          nextLabel="Older emails"
          previous={pageHref(page.previousCursor, "prev")}
          previousLabel="Newer emails"
        />
      </div>
    </DashboardShell>
  );
}
