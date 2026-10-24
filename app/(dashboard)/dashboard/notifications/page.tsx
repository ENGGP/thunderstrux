import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listFailedBusinessNotifications, NotificationCursorError } from "@/lib/email/notification-outbox";
import { requireManagementPage } from "@/lib/auth/page-access";
import { FailedNotifications } from "@/components/settings/failed-notifications";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Email delivery" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const organisation = await requireManagementPage("orders:email_resend", "/dashboard/notifications");
  const { cursor } = await searchParams;
  let page;
  try { page = await listFailedBusinessNotifications(organisation.id, cursor); }
  catch (error) { if (error instanceof NotificationCursorError) redirect("/dashboard/notifications"); throw error; }
  const link = "text-sm font-semibold text-brand underline underline-offset-4";

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        description="Society emails that could not be delivered. Check why each one failed, then send it again."
        title="Email delivery"
      />
      <div className="grid max-w-4xl gap-4">
        <FailedNotifications jobs={page.jobs} />
        {page.nextCursor || cursor ? (
          <nav aria-label="Failed email pages" className="flex flex-wrap gap-4">
            {cursor ? <Link className={link} href="/dashboard/notifications">Newest failed notifications</Link> : null}
            {page.nextCursor ? (
              <Link className={link} href={`/dashboard/notifications?cursor=${encodeURIComponent(page.nextCursor)}`}>
                Older failed notifications
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </DashboardShell>
  );
}
