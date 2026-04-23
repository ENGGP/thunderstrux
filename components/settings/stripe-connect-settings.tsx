"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientApiError, fetchJson } from "@/lib/client/api";
import {
  fetchOrganisationBySlug,
  type Organisation
} from "@/lib/client/orgs";

type ConnectStatus = {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

export function StripeConnectSettings({ orgSlug }: { orgSlug: string }) {
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadOrganisation() {
      try {
        const loadedOrganisation = await fetchOrganisationBySlug(orgSlug);

        if (isActive) {
          setOrganisation(loadedOrganisation);
        }
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

    loadOrganisation();

    return () => {
      isActive = false;
    };
  }, [orgSlug]);

  async function checkStatus() {
    if (!organisation) {
      return;
    }

    setIsCheckingStatus(true);
    setMessage(null);

    try {
      const data = await fetchJson<ConnectStatus>(
        `/api/stripe/connect/status?organisationId=${organisation.id}`
      );

      setStatus(data);
      setMessage(data.details_submitted ? "Onboarding complete." : "Onboarding is not complete yet.");
    } catch (error) {
      setMessage(
        error instanceof ClientApiError
          ? error.message
          : "Unable to check Stripe status."
      );
    } finally {
      setIsCheckingStatus(false);
    }
  }

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

        {message ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            {message}
          </div>
        ) : null}

        {status ? (
          <dl className="grid gap-2 text-sm text-neutral-700">
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
          <Button
            disabled={isStartingOnboarding}
            onClick={startOnboarding}
            type="button"
          >
            {isStartingOnboarding ? "Redirecting..." : "Connect Stripe Account"}
          </Button>
          <Button
            disabled={isCheckingStatus}
            onClick={checkStatus}
            type="button"
            variant="secondary"
          >
            {isCheckingStatus ? "Checking..." : "Check Status"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
