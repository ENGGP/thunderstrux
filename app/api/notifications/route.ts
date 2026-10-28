import { NextResponse } from "next/server";
import { listFailedBusinessNotifications, NotificationCursorError } from "@/lib/email/notification-outbox";
import { requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { badRequest, mapRouteError, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule } from "@/lib/api/route-rules";

export async function GET(request?: Request) {
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    const cursor = request ? new URL(request.url).searchParams.get("cursor") ?? undefined : undefined;
    const { jobs, nextCursor } = await listFailedBusinessNotifications(organisation.id, cursor);
    return NextResponse.json({ jobs, nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "notifications.list", request, rules: [
      authenticationRule, organisationAccessRule,
      routeErrorRule(NotificationCursorError, failure => badRequest(failure.message))
    ] });
  }
}
