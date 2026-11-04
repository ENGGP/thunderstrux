import { AuthenticationRequiredError, OrganisationAccessError } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { PlatformAccessError, PlatformRefusal, PlatformUnavailableError, PlatformVerificationRequiredError } from "@/lib/platform/authority";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
import { badRequest, conflict, forbidden, notFound, routeErrorRule, serviceUnavailable, unauthorized, type RouteErrorRule } from "./errors";

// Shared mappings for the guards most routes call. Order them before any
// broader rule for the same error class.
export const authenticationRule = routeErrorRule(AuthenticationRequiredError, () => unauthorized());
export const staleSessionRule: RouteErrorRule = {
  matches: (error) => error instanceof AccountSecurityError && error.kind === "stale_session",
  toResponse: () => unauthorized()
};
export const organisationAccessRule = routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message));

// requireFreshStaffMfa: no grant is 403, a missing or wrong code is 400 on mfaCode.
export const freshStaffMfaRules: RouteErrorRule[] = [
  routeErrorRule(MfaRequiredError, (error) => forbidden(error.message)),
  routeErrorRule(MfaInputError, (error) => badRequest(error.message, [{ path: ["mfaCode"], message: error.message }])),
  routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable"))
];

// T55: /api/admin. A non-operator, a missing permission or a revoked operator get the
// same 404 as a missing route; a refusal says exactly why and changed nothing.
export const platformAccessRules: RouteErrorRule[] = [
  routeErrorRule(PlatformAccessError, () => notFound("Not found")),
  routeErrorRule(PlatformVerificationRequiredError, (error) => forbidden(error.message)),
  routeErrorRule(PlatformRefusal, (error) => conflict(error.message)),
  routeErrorRule(PlatformUnavailableError, (error) => serviceUnavailable(error.message))
];
