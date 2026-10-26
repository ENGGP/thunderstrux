import { NextResponse } from "next/server";
import { badRequest, conflict, forbidden, notFound, routeErrorRule, serviceUnavailable } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { OrganisationAccessError } from "@/lib/auth/access";
import { OrganisationScopeError } from "@/lib/db/organisation-scope";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
import { StripeConfigurationError } from "@/lib/stripe";
import {
  OrganisationStripeConnectNotFoundError,
  OrganisationStripeConnectValidationError,
  StripeConnectPlatformNotReadyError,
  StripeDisconnectBlockedError,
  StripeDisconnectUnavailableError
} from "@/lib/stripe/connect";

// Error mappings shared by the Connect routes. A missing tenant and one the
// caller cannot reach answer the same 404; provider messages never reach the client.
export const connectRouteRules = [
  authenticationRule,
  staleSessionRule,
  routeErrorRule(OrganisationAccessError, (error) =>
    error.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(error.message)
  ),
  routeErrorRule(OrganisationScopeError, (error) => badRequest(error.message, [{ path: ["organisationId"], message: error.message }])),
  routeErrorRule(OrganisationStripeConnectNotFoundError, (error) => notFound(error.message)),
  routeErrorRule(OrganisationStripeConnectValidationError, (error) => badRequest(error.message, error.details)),
  routeErrorRule(StripeDisconnectBlockedError, (error) => conflict(error.message)),
  routeErrorRule(MfaRequiredError, (error) => forbidden(error.message)),
  routeErrorRule(MfaInputError, (error) => badRequest(error.message, [{ path: ["mfaCode"], message: error.message }])),
  routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
  // Names no server setting to the browser (API-002), as the other Stripe routes.
  routeErrorRule(StripeConfigurationError, () => serviceUnavailable("Stripe is not configured.")),
  routeErrorRule(StripeDisconnectUnavailableError, (error) => serviceUnavailable(error.message)),
  routeErrorRule(StripeConnectPlatformNotReadyError, (error) =>
    NextResponse.json(
      { state: error.state, message: error.message, actionRequired: error.actionRequired, actionUrl: error.actionUrl },
      { status: 409 }
    )
  )
];
