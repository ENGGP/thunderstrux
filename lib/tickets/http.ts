import { apiError, badRequest, notFound, routeErrorRule, type RouteErrorRule } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule, staleSessionRule } from "@/lib/api/route-rules";
import { PaginationError } from "@/lib/pagination/cursor";
import {
  OrganisationEventTicketsAccessError,
  OrganisationTicketAccessError,
  TicketAlreadyCheckedInError,
  TicketNotCheckedInError,
  TicketNotValidError
} from "@/lib/tickets/check-in";

const conflict = (message: string, reason: string) => apiError("CONFLICT", message, 409, [{ path: ["ticketId"], message, reason }]);

// One mapping for the check-in console's routes (API-001). A missing ticket and
// another society's ticket are the same 404; a conflict names its reason so
// the console can re-read the ticket and say what happened.
export const ticketRouteRules: RouteErrorRule[] = [
  authenticationRule,
  staleSessionRule,
  organisationAccessRule,
  routeErrorRule(OrganisationEventTicketsAccessError, (error) => notFound(error.message)),
  routeErrorRule(OrganisationTicketAccessError, (error) => notFound(error.message)),
  routeErrorRule(PaginationError, (error) => badRequest(error.message)),
  routeErrorRule(TicketAlreadyCheckedInError, (error) => conflict(error.message, "already_checked_in")),
  routeErrorRule(TicketNotCheckedInError, (error) => conflict(error.message, "not_checked_in")),
  routeErrorRule(TicketNotValidError, (error) => conflict(error.message, error.validity === "refund_review" ? "under_review" : "not_valid"))
];
