"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientApiError, fetchJson } from "@/lib/client/api";
import {
  fetchOrganisationBySlug,
  type Organisation
} from "@/lib/client/orgs";

type ConnectStatus = {
  connected: boolean;
  ready?: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  warning?: string;
};

export function StripeConnectSettings({ orgSlug }: { orgSlug: string }) {
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
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

        if (data.warning) {
          setMessage(data.warning);
        }

        if (showMessage) {
          setMessage(
            data.warning ??
              (data.ready
                ? "Stripe connected and ready for ticket sales."
                : data.connected
                  ? "Complete onboarding in Stripe before selling tickets."
                  : "Stripe is not connected yet.")
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

  async function startOnboarding() {
    if (!organisation) {
      return;
    }

    setIsStartingOnboarding(true);
    setMessage(null);

    try {
      const data = await fetchJson<{ url: string }>(
        "/api/stripe/connect/onboard",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ organisationId: organisation.id })
        }
      );

      window.location.href = data.url;
    } catch (error) {
      setMessage(
        error instanceof ClientApiError
          ? error.message
          : "Unable to start Stripe onboarding."
      );
      setIsStartingOnboarding(false);
    }
  }

  async function disconnectStripe() {
    if (!organisation) {
      return;
    }

    setIsDisconnecting(true);
    setMessage(null);

    try {
      await fetchJson<{ disconnected: boolean }>(
        "/api/stripe/connect/onboard",
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ organisationId: organisation.id })
        }
      );

      setStatus({
        connected: false,
        ready: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false
      });
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

  return (
    <Card>
      <div className="grid gap-5">
        <div>
          <h2 className="text-xl font-semibold text-neutral-950">
            Stripe Connect
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Connect an Express account for this organisation.
          </p>
        </div>

        {status ? (
          <div
            className={
              status.ready
                ? "rounded-md border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800"
                : "rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
            }
          >
            <p className="font-medium">
              {status.ready ? "Stripe connected" : "Complete onboarding"}
            </p>
            <p className="mt-1">
              {status.ready
                ? "This organisation can accept ticket payments."
                : "You must connect Stripe before selling tickets."}
            </p>
          </div>
        ) : null}

        {message ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            {message}
          </div>
        ) : null}

        {status ? (
          <dl className="grid gap-2 text-sm text-neutral-700">
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
          {!status?.connected ? (
            <Button
              disabled={isStartingOnboarding}
              onClick={startOnboarding}
              type="button"
            >
              {isStartingOnboarding ? "Redirecting..." : "Connect Stripe Account"}
            </Button>
          ) : null}
          <Button
            disabled={isCheckingStatus}
            onClick={() => organisation && void checkStatus(organisation, true)}
            type="button"
            variant="secondary"
          >
            {isCheckingStatus ? "Refreshing..." : "Refresh Status"}
          </Button>
          {status?.connected ? (
            <Button
              disabled={isDisconnecting}
              onClick={disconnectStripe}
              type="button"
              variant="secondary"
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect Stripe Account"}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
