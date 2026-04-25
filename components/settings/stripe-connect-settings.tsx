"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientApiError, fetchJson } from "@/lib/client/api";
import {
  fetchOrganisationBySlug,
  type Organisation
} from "@/lib/client/orgs";

type StripeConnectState =
  | "NOT_CONNECTED"
  | "PLATFORM_NOT_READY"
  | "CONNECTED_INCOMPLETE"
  | "RESTRICTED"
  | "READY"
  | "ERROR";

type ConnectStatus = {
  accountId: string | null;
  connected: boolean;
  state: StripeConnectState;
  ready: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  currently_due: string[];
  eventually_due: string[];
  disabled_reason: string | null;
  dashboard_url: string | null;
  actionUrl?: string;
  actionRequired?: string;
  error?: string;
};

function stateContent(status: ConnectStatus | null) {
  if (!status || status.state === "NOT_CONNECTED") {
    return {
      title: "Connect Stripe to sell tickets",
      description:
        "Create a Stripe Express account for this organisation before accepting payments.",
      tone: "neutral"
    };
  }

  if (status.state === "PLATFORM_NOT_READY") {
    return {
      title: "Stripe platform setup required",
      description:
        "You must complete your Stripe platform profile before connecting accounts.",
      tone: "amber"
    };
  }

  if (status.state === "CONNECTED_INCOMPLETE") {
    return {
      title: "Complete onboarding to accept payments",
      description:
        "Stripe still needs account details before ticket payments can be enabled.",
      tone: "amber"
    };
  }

  if (status.state === "RESTRICTED") {
    return {
      title: "Stripe requires additional information",
      description:
        "The account exists, but Stripe has not enabled charges yet. Fix the account requirements in Stripe.",
      tone: "amber"
    };
  }

  if (status.state === "READY") {
    return {
      title: "Stripe is ready",
      description: "This organisation can accept ticket payments.",
      tone: "green"
    };
  }

  return {
    title: "Stripe status needs attention",
    description:
      status.error ??
      "Thunderstrux could not refresh this Stripe account. Retry or disconnect and reconnect.",
    tone: "red"
  };
}

function statusBadgeClasses(tone: string) {
  if (tone === "green") {
    return "border-green-200 bg-green-50 text-green-800";
  }

  if (tone === "red") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-800";
}

function formatRequirement(requirement: string) {
  return requirement.replaceAll("_", " ").replaceAll(".", " / ");
}

export function StripeConnectSettings({ orgSlug }: { orgSlug: string }) {
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
  const [isContinuingOnboarding, setIsContinuingOnboarding] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const checkStatus = useCallback(
    async (targetOrganisation: Organisation, showMessage = false) => {
      setIsCheckingStatus(true);

      if (showMessage) {
        setMessage(null);
      }

      try {
        const data = await fetchJson<ConnectStatus>(
          `/api/stripe/connect/status?organisationId=${targetOrganisation.id}`
        );

        setStatus(data);

        if (showMessage) {
          setMessage(
            data.state === "READY"
              ? "Stripe connected and ready for ticket sales."
              : "Stripe status refreshed."
          );
        }
      } catch (error) {
        if (showMessage) {
          setMessage(
            error instanceof ClientApiError
              ? error.message
              : "Unable to check Stripe status."
          );
        }
      } finally {
        setIsCheckingStatus(false);
      }
    },
    []
  );

  useEffect(() => {
    let isActive = true;

    async function loadOrganisationAndStatus() {
      try {
        const loadedOrganisation = await fetchOrganisationBySlug(orgSlug);

        if (isActive) {
          setOrganisation(loadedOrganisation);
        }

        await checkStatus(loadedOrganisation);
      } catch {
        if (isActive) {
          setMessage("Unable to load organisation.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadOrganisationAndStatus();

    return () => {
      isActive = false;
    };
  }, [checkStatus, orgSlug]);

  useEffect(() => {
    if (!organisation) {
      return;
    }

    const refreshStatus = () => {
      void checkStatus(organisation);
    };

    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", refreshStatus);

    return () => {
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", refreshStatus);
    };
  }, [checkStatus, organisation]);

  async function redirectToOnboarding(endpoint: string) {
    if (!organisation) {
      return;
    }

    const data = await fetchJson<{ url: string }>(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ organisationId: organisation.id })
    });

    window.location.href = data.url;
  }

  async function startOnboarding() {
    setIsStartingOnboarding(true);
    setMessage(null);

    try {
      await redirectToOnboarding("/api/stripe/connect/onboard");
    } catch (error) {
      if (
        error instanceof ClientApiError &&
        error.payload?.state === "PLATFORM_NOT_READY"
      ) {
        setStatus({
          accountId: null,
          connected: false,
          state: "PLATFORM_NOT_READY",
          ready: false,
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          currently_due: [],
          eventually_due: [],
          disabled_reason: null,
          dashboard_url: null,
          actionUrl: error.payload.actionUrl,
          actionRequired: error.payload.actionRequired,
          error: error.payload.message
        });
        setMessage(null);
        setIsStartingOnboarding(false);
        return;
      }

      setMessage(
        error instanceof ClientApiError
          ? error.message
          : "Unable to start Stripe onboarding."
      );
      setIsStartingOnboarding(false);
    }
  }

  async function continueOnboarding() {
    setIsContinuingOnboarding(true);
    setMessage(null);

    try {
      await redirectToOnboarding("/api/stripe/connect/continue");
    } catch (error) {
      setMessage(
        error instanceof ClientApiError
          ? error.message
          : "Unable to continue Stripe onboarding."
      );
      setIsContinuingOnboarding(false);
    }
  }

  async function disconnectStripe() {
    if (!organisation) {
      return;
    }

    setIsDisconnecting(true);
    setMessage(null);

    try {
      const data = await fetchJson<{
        disconnected: boolean;
        status: ConnectStatus;
      }>("/api/stripe/connect/disconnect", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ organisationId: organisation.id })
      });

      setStatus(data.status);
      setMessage("Stripe account disconnected.");
    } catch (error) {
      setMessage(
        error instanceof ClientApiError
          ? error.message
          : "Unable to disconnect Stripe account."
      );
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (isLoading) {
    return <Card>Loading settings...</Card>;
  }

  if (!organisation) {
    return <Card>{message ?? "Organisation not found."}</Card>;
  }

  const content = stateContent(status);
  const requirements = status?.currently_due ?? [];
  const isConnected = Boolean(status?.connected);
  const isPlatformNotReady = status?.state === "PLATFORM_NOT_READY";

  return (
    <Card>
      <div className="grid gap-6">
        <div>
          <h2 className="text-xl font-semibold text-neutral-950">
            Stripe Connect
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Thunderstrux guides the setup. Stripe handles compliance, identity
            checks and payout requirements.
          </p>
        </div>

        <div
          className={`rounded-lg border px-4 py-4 text-sm ${statusBadgeClasses(
            content.tone
          )}`}
        >
          <p className="font-semibold">{content.title}</p>
          <p className="mt-1">{content.description}</p>
          {status?.disabled_reason ? (
            <p className="mt-2">Stripe reason: {status.disabled_reason}</p>
          ) : null}
        </div>

        {message ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            {message}
          </div>
        ) : null}

        {requirements.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Required by Stripe</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {requirements.map((requirement) => (
                <li key={requirement}>{formatRequirement(requirement)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {status ? (
          <dl className="grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
            <div className="flex justify-between gap-4">
              <dt>Lifecycle state</dt>
              <dd className="font-medium text-neutral-950">{status.state}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Stripe account</dt>
              <dd>{status.connected ? "Connected" : "Not connected"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Charges enabled</dt>
              <dd>{status.charges_enabled ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Payouts enabled</dt>
              <dd>{status.payouts_enabled ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Details submitted</dt>
              <dd>{status.details_submitted ? "Yes" : "No"}</dd>
            </div>
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {isPlatformNotReady && status?.actionUrl ? (
            <a
              className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
              href={status.actionUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open Stripe Platform Settings
            </a>
          ) : null}

          {isPlatformNotReady ? (
            <Button
              disabled={isStartingOnboarding}
              onClick={startOnboarding}
              type="button"
              variant="secondary"
            >
              {isStartingOnboarding ? "Retrying..." : "Retry after completion"}
            </Button>
          ) : null}

          {!isConnected && !isPlatformNotReady ? (
            <Button
              disabled={isStartingOnboarding}
              onClick={startOnboarding}
              type="button"
            >
              {isStartingOnboarding ? "Redirecting..." : "Connect Stripe Account"}
            </Button>
          ) : null}

          {status?.state === "CONNECTED_INCOMPLETE" ? (
            <Button
              disabled={isContinuingOnboarding}
              onClick={continueOnboarding}
              type="button"
            >
              {isContinuingOnboarding
                ? "Redirecting..."
                : "Continue onboarding"}
            </Button>
          ) : null}

          {status?.state === "RESTRICTED" ? (
            <Button
              disabled={isContinuingOnboarding}
              onClick={continueOnboarding}
              type="button"
            >
              {isContinuingOnboarding ? "Redirecting..." : "Fix account"}
            </Button>
          ) : null}

          {status?.state === "ERROR" ? (
            <Button
              disabled={isCheckingStatus}
              onClick={() => organisation && void checkStatus(organisation, true)}
              type="button"
            >
              {isCheckingStatus ? "Retrying..." : "Retry status check"}
            </Button>
          ) : null}

          <Button
            disabled={isCheckingStatus}
            onClick={() => organisation && void checkStatus(organisation, true)}
            type="button"
            variant="secondary"
          >
            {isCheckingStatus ? "Refreshing..." : "Refresh status"}
          </Button>

          {status?.dashboard_url ? (
            <a
              className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
              href={status.dashboard_url}
              rel="noreferrer"
              target="_blank"
            >
              Open in Stripe dashboard
            </a>
          ) : null}

          {isConnected || isPlatformNotReady ? (
            <Button
              disabled={isDisconnecting}
              onClick={disconnectStripe}
              type="button"
              variant="secondary"
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect Stripe account"}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
