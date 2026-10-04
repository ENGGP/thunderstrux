import { NextResponse } from "next/server";
import { listFailedBusinessNotifications, NotificationCursorError } from "@/lib/email/notification-outbox";
import { AuthenticationRequiredError, OrganisationAccessError, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { badRequest, forbidden, internalError, unauthorized } from "@/lib/api/errors";

export async function GET(request?: Request) {
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    const cursor = request ? new URL(request.url).searchParams.get("cursor") ?? undefined : undefined;
    const result = await listFailedBusinessNotifications(organisation.id, cursor);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return unauthorized();
    if (error instanceof OrganisationAccessError) return forbidden(error.message);
    if (error instanceof NotificationCursorError) return badRequest(error.message);
    return internalError();
  }
}
