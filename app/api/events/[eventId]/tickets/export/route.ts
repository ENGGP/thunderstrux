import { apiError, mapRouteError, routeErrorRule } from "@/lib/api/errors";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { ExportTooLargeError, exportAttendees, exportFileName, recordExport } from "@/lib/export/order-exports";
import { readTimeZone } from "@/lib/organisations/profile";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { ticketRouteRules } from "@/lib/tickets/http";

type RouteContext = { params: Promise<{ eventId: string }> };

// GET /api/events/[eventId]/tickets/export (UI-018): the event's attendee list
// (tickets that admit) as CSV. It holds buyer emails, so it needs orders:read as
// well as the console's tickets:check_in: owners and admins. Rate-limited,
// never cached and audited.
export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:read");
    const actor = await requireAuthenticatedUser();
    const limit = await enforceRateLimit({ policy: "data_export", request, keyParts: [organisation.id, actor.id] });
    if (limit) return limit;
    const timeZone = await readTimeZone(organisation.id);
    const file = await exportAttendees(organisation.id, eventId, timeZone);
    await recordExport(organisation.id, actor.id, "order.attendees_exported", { type: "Event", id: eventId }, { eventId, rows: file.rows });
    return new Response(file.csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(organisation.slug, `attendees-${file.title.slice(0, 40)}`, timeZone)}"`,
      "Cache-Control": "private, no-store"
    } });
  } catch (error) {
    return mapRouteError(error, { operation: "event.tickets.export", request, rules: [
      ...ticketRouteRules,
      routeErrorRule(ExportTooLargeError, (failure) => apiError("BAD_REQUEST", failure.message, 413))
    ] });
  }
}
