import { apiError, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { commerceOrderFilters } from "@/lib/commerce/orders";
import { ExportTooLargeError, exportCommerceOrders, exportFileName, exportTicketOrders, recordExport } from "@/lib/export/order-exports";
import { OrganisationOrderEventAccessError, parseOrderStatusFilter } from "@/lib/orders/grouped-orders";
import { readTimeZone } from "@/lib/organisations/profile";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { dateFilterBound } from "@/lib/zoned-time";

// GET /api/orders/export?family=tickets|memberships|merchandise and the Orders
// tab's filters (UI-018): every matching order of the current society as CSV.
// orders:read, the data_export limit, never cached, and an audit row, since the
// file holds buyer emails.
export async function GET(request: Request) {
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:read");
    const actor = await requireAuthenticatedUser();
    const limit = await enforceRateLimit({ policy: "data_export", request, keyParts: [organisation.id, actor.id] });
    if (limit) return limit;
    const params = new URL(request.url).searchParams;
    const value = (name: string) => params.get(name)?.trim().slice(0, 200) || undefined;
    const family = value("family") === "memberships" || value("family") === "merchandise" ? (value("family") as "memberships" | "merchandise") : "tickets";
    const timeZone = await readTimeZone(organisation.id);
    const date = (name: string, endOfDay: boolean) => {
      const raw = value(name);
      const parsed = raw ? dateFilterBound(raw, timeZone, { endOfDay }) : undefined;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
    };
    const search = value("search");
    const startDate = date("startDate", false);
    const endDate = date("endDate", true);

    let file: { rows: number; csv: string };
    let filters: Record<string, string | undefined>;
    if (family === "tickets") {
      const includeSystemOrders = value("includeSystem") === "true";
      const status = parseOrderStatusFilter(value("status") ?? null, { includeSystemOrders });
      const eventId = value("eventId");
      file = await exportTicketOrders(organisation.id, timeZone, status, eventId, { includeSystemOrders, search, startDate, endDate });
      filters = { status, eventId, search, startDate: value("startDate"), endDate: value("endDate") };
    } else {
      const filter = commerceOrderFilters.find((name) => name === value("status")) ?? "all";
      const productId = value("productId");
      file = await exportCommerceOrders(organisation.id, timeZone, family === "memberships" ? "membership" : "merchandise", { filter, search, productId, startDate, endDate });
      filters = { status: filter, productId, search, startDate: value("startDate"), endDate: value("endDate") };
    }
    await recordExport(organisation.id, actor.id, "order.list_exported", { type: "Organisation", id: organisation.id },
      { family, rows: file.rows, filters: Object.fromEntries(Object.entries(filters).filter((entry) => entry[1])) });
    return new Response(file.csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(organisation.slug, `${family}-orders`, timeZone)}"`,
      "Cache-Control": "private, no-store"
    } });
  } catch (error) {
    return mapRouteError(error, { operation: "orders.export", request, rules: [
      authenticationRule, organisationAccessRule,
      routeErrorRule(OrganisationOrderEventAccessError, () => notFound("Event not found")),
      routeErrorRule(ExportTooLargeError, (failure) => apiError("BAD_REQUEST", failure.message, 413))
    ] });
  }
}
