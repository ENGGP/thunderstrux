import { badRequest, conflict, forbidden, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule, staleSessionRule } from "@/lib/api/route-rules";
import { OrganisationMismatchError, OrganisationScopeError } from "@/lib/db/organisation-scope";
import {
  EventLifecycleConflictError,
  EventLifecycleNotFoundError,
  EventLifecycleValidationError
} from "@/lib/events/event-lifecycle";

// Error mappings shared by the event route adapters. The scope rule names the
// fields each route reads its organisation from, as those routes always have.
export function eventRouteRules(scopeFields: string[]) {
  return [
    authenticationRule,
    staleSessionRule,
    organisationAccessRule,
    routeErrorRule(OrganisationMismatchError, (error) => forbidden(error.message)),
    routeErrorRule(OrganisationScopeError, (error) =>
      badRequest(error.message, scopeFields.map((field) => ({ path: [field], message: error.message })))
    ),
    routeErrorRule(EventLifecycleNotFoundError, (error) => notFound(error.message)),
    routeErrorRule(EventLifecycleValidationError, (error) => badRequest(error.message, error.details)),
    routeErrorRule(EventLifecycleConflictError, (error) => conflict(error.message))
  ];
}
