import Link from "next/link";
import { redirect } from "next/navigation";
import { listFailedBusinessNotifications, NotificationCursorError } from "@/lib/email/notification-outbox";
import { requireManagementPage } from "@/lib/auth/page-access";
import { FailedNotifications } from "@/components/settings/failed-notifications";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const organisation = await requireManagementPage("orders:email_resend", "/dashboard/notifications");
  let page;
  try { page = await listFailedBusinessNotifications(organisation.id, (await searchParams).cursor); }
  catch (error) { if (error instanceof NotificationCursorError) redirect("/dashboard/notifications"); throw error; }
  return <DashboardShell basePath="/dashboard" orgName={organisation.name}><div className="mx-auto max-w-3xl p-6"><h2 className="mb-6 text-2xl font-bold">Failed notifications</h2><FailedNotifications jobs={page.jobs} />
    {page.nextCursor && <Link href={`/dashboard/notifications?cursor=${encodeURIComponent(page.nextCursor)}`}>Older failed notifications</Link>}
    {(await searchParams).cursor && <Link href="/dashboard/notifications">Newest failed notifications</Link>}
  </div></DashboardShell>;
}
