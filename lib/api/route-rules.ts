import { AuthenticationRequiredError, OrganisationAccessError } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { forbidden, routeErrorRule, unauthorized, type RouteErrorRule } from "./errors";

// Shared mappings for the guards most routes call. Order them before any
// broader rule for the same error class.
export const authenticationRule = routeErrorRule(AuthenticationRequiredError, () => unauthorized());
export const staleSessionRule: RouteErrorRule = {
  matches: (error) => error instanceof AccountSecurityError && error.kind === "stale_session",
  toResponse: () => unauthorized()
};
export const organisationAccessRule = routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message));
