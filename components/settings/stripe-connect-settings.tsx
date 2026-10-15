"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
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

function stateContent(status: ConnectStatus | null): {
  title: string;
  description: string;
  badge: [Status, string];
  tone: "info" | "success" | "warning" | "danger";
} {
  if (!status || status.state === "NOT_CONNECTED") {
    return {
      title: "Connect Stripe to sell tickets",
      description:
        "Create a Stripe Express account for this organisation before accepting payments.",
      badge: ["draft", "Not connected"],
      tone: "info"
    };
  }

  if (status.state === "PLATFORM_NOT_READY") {
    return {
      title: "Stripe platform setup required",
      description:
        "You must complete your Stripe platform profile before connecting accounts.",
      badge: ["pending", "Setup incomplete"],
      tone: "warning"
    };
  }

  if (status.state === "CONNECTED_INCOMPLETE") {
    return {
      title: "Complete onboarding to accept payments",
      description:
        "Stripe still needs account details before ticket payments can be enabled.",
      badge: ["pending", "Setup incomplete"],
      tone: "warning"
    };
  }

  if (status.state === "RESTRICTED") {
    return {
      title: "Stripe requires additional information",
      description:
        "The account exists, but Stripe has not enabled charges yet. Fix the account requirements in Stripe.",
      badge: ["pending", "Action needed"],
      tone: "warning"
    };
  }

  if (status.state === "READY") {
    return {
      title: "Stripe is ready",
      description: "This organisation can accept ticket payments.",
      badge: ["active", "Ready"],
      tone: "success"
    };
  }

  return {
    title: "Stripe status needs attention",
    description:
      status.error ??
      "Thunderstrux could not refresh this Stripe account. Retry or disconnect and reconnect.",
    badge: ["failed", "Needs attention"],
    tone: "danger"
  };
}

function formatRequirement(requirement: string) {
  return requirement.replaceAll("_", " ").replaceAll(".", " / ");
}

export function StripeConnectSettings({ orgSlug }: { orgSlug: string }) {
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
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
          setMessage({
            ok: true,
            text:
              data.state === "READY"
                ? "Stripe connected and ready for ticket sales."
                : "Stripe status refreshed."
          });
        }
      } catch (error) {
        if (showMessage) {
          setMessage({
            ok: false,
            text: error instanceof ClientApiError ? error.message : "Unable to check Stripe status."
          });
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
          setMessage({ ok: false, text: "Unable to load organisation." });
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

      setMessage({
        ok: false,
        text: error instanceof ClientApiError ? error.message : "Unable to start Stripe onboarding."
      });
      setIsStartingOnboarding(false);
    }
  }

  async function continueOnboarding() {
    setIsContinuingOnboarding(true);
    setMessage(null);

    try {
      await redirectToOnboarding("/api/stripe/connect/continue");
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ClientApiError ? error.message : "Unable to continue Stripe onboarding."
      });
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
      setMessage({ ok: true, text: "Stripe account disconnected." });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ClientApiError ? error.message : "Unable to disconnect Stripe account."
      });
    } finally {
      setIsDisconnecting(false);
      setConfirmingDisconnect(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <p className="sr-only">Loading payment settings</p>
        <div className="grid gap-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-20" />
          <Skeleton className="h-28" />
        </div>
      </Card>
    );
  }

  if (!organisation) {
    return (
      <Notice role="alert" tone="danger">
        {message?.text ?? "Organisation not found."}
      </Notice>
    );
  }

  const content = stateContent(status);
  const requirements = status?.currently_due ?? [];
  const isConnected = Boolean(status?.connected);
  const isPlatformNotReady = status?.state === "PLATFORM_NOT_READY";
  const link = "inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-brand underline underline-offset-4";
  const enabled = (value: boolean) => (value ? "Enabled" : "Not enabled yet");

  return (
    <>
      <Card>
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-ink">Stripe account</h2>
            <StatusBadge label={content.badge[1]} status={content.badge[0]} />
          </div>

          <Notice title={content.title} tone={content.tone}>
            <p>{content.description}</p>
            {status?.disabled_reason ? <p className="mt-1">Stripe reason: {status.disabled_reason}</p> : null}
            {requirements.length > 0 ? (
              <>
                <p className="mt-2 font-semibold text-ink">Required by Stripe</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {requirements.map((requirement) => (
                    <li key={requirement}>{formatRequirement(requirement)}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </Notice>

          {message ? (
            <Notice role={message.ok ? "status" : "alert"} tone={message.ok ? "success" : "danger"}>
              {message.text}
            </Notice>
          ) : null}

          {status ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-ink-soft">Stripe account</dt>
              <dd className="font-medium text-ink [overflow-wrap:anywhere]">{status.accountId ?? "Not connected"}</dd>
              <dt className="text-ink-soft">Card payments</dt>
              <dd className="font-medium text-ink">{enabled(status.charges_enabled)}</dd>
              <dt className="text-ink-soft">Payouts</dt>
              <dd className="font-medium text-ink">{enabled(status.payouts_enabled)}</dd>
              <dt className="text-ink-soft">Details submitted</dt>
              <dd className="font-medium text-ink">{status.details_submitted ? "Yes" : "No"}</dd>
            </dl>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {isPlatformNotReady && status?.actionUrl ? (
              <a className={buttonClasses({ variant: "secondary" })} href={status.actionUrl} rel="noreferrer" target="_blank">
                Open Stripe Platform Settings
              </a>
            ) : null}

            {isPlatformNotReady ? (
              <Button disabled={isStartingOnboarding} onClick={startOnboarding} type="button" variant="secondary">
                {isStartingOnboarding ? "Retrying..." : "Retry after completion"}
              </Button>
            ) : null}

            {!isConnected && !isPlatformNotReady ? (
              <Button disabled={isStartingOnboarding} onClick={startOnboarding} type="button">
                {isStartingOnboarding ? "Redirecting..." : "Connect Stripe Account"}
              </Button>
            ) : null}

            {status?.state === "CONNECTED_INCOMPLETE" ? (
              <Button disabled={isContinuingOnboarding} onClick={continueOnboarding} type="button">
                {isContinuingOnboarding ? "Redirecting..." : "Continue onboarding"}
              </Button>
            ) : null}

            {status?.state === "RESTRICTED" ? (
              <Button disabled={isContinuingOnboarding} onClick={continueOnboarding} type="button">
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
              <a className={link} href={status.dashboard_url} rel="noreferrer" target="_blank">
                Open in Stripe dashboard
              </a>
            ) : null}
          </div>
        </div>
      </Card>

      {isConnected || isPlatformNotReady ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-danger-border bg-surface p-5 sm:p-6">
          <div className="grid max-w-xl gap-1">
            <h2 className="text-lg font-semibold text-ink">Disconnect Stripe</h2>
            <p className="text-sm text-ink-soft">
              Unlinks the account from Thunderstrux only. Your Stripe account and
              its money are not touched. Paid sales stop until you connect again.
            </p>
          </div>
          <Button
            disabled={isDisconnecting}
            onClick={() => setConfirmingDisconnect(true)}
            type="button"
            variant="danger"
          >
            Disconnect Stripe account
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        busy={isDisconnecting}
        confirmLabel="Disconnect Stripe account"
        destructive
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={disconnectStripe}
        open={confirmingDisconnect}
        title="Disconnect Stripe?"
      >
        Paid ticket sales stop until you connect Stripe again. Your Stripe account
        and the money in it are not touched. Connecting again creates a new Stripe
        account.
      </ConfirmDialog>
    </>
  );
}
