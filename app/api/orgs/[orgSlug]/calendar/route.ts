import { NextResponse } from "next/server";
import { badRequest, forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { OrganisationAccessError } from "@/lib/auth/access";
import { CalendarRangeError, calendarRange, readCalendar } from "@/lib/events/calendar";
import { organisationActor } from "@/lib/organisations/http";
import { readTimeZone } from "@/lib/organisations/profile";

type Context = { params: Promise<{ orgSlug: string }> };

// GET /api/orgs/[orgSlug]/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD (T33): the
// society's events overlapping those local days, for any staff with
// events:read. Drafts and membership end dates follow the caller's live role.
export async function GET(request: Request, context: Context) {
  try {
    const { organisationId, staffRole } = await organisationActor((await context.params).orgSlug, "events:read");
    const search = new URL(request.url).searchParams;
    const range = calendarRange(search.get("from"), search.get("to"));
    const timeZone = await readTimeZone(organisationId);
    return NextResponse.json({ ...range, timeZone, ...(await readCalendar(organisationId, staffRole, range, timeZone)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "calendar.read",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(OrganisationAccessError, (denied) =>
          denied.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(denied.message)
        ),
        routeErrorRule(CalendarRangeError, (invalid) => badRequest(invalid.message, [{ path: ["from"], message: invalid.message }]))
      ]
    });
  }
}
