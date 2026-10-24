"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PayoutFailedNotice, PayoutsCard, type PayoutSummaryView } from "@/components/settings/payouts-card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney } from "@/lib/format";
import { calculatePlatformFee } from "@/lib/stripe/fees";
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
  dashboard_available: boolean;
  actionUrl?: string;
  actionRequired?: string;
  error?: string;
  openObligations?: number;
  payouts?: PayoutSummaryView;
};

function stateContent(status: ConnectStatus | null): {
  title: string;
  description: string;
  badge: [Status, string];
  tone: "info" | "success" | "warning" | "danger";
} | null {
  if (!status || status.state === "NOT_CONNECTED") {
    return { title: "Connect Stripe to sell paid tickets", description: "Free tickets already work without it.", badge: ["draft", "Not connected"], tone: "info" };
  }
  if (status.state === "PLATFORM_NOT_READY") {
    return {
      title: "Stripe platform setup required",
      description: "The Thunderstrux Stripe platform profile must be completed before societies can connect.",
      badge: ["pending", "Setup incomplete"],
      tone: "warning"
    };
  }
  if (status.state === "CONNECTED_INCOMPLETE") {
    return { title: "You can't sell paid tickets yet", description: "Finish setting up your account in Stripe.", badge: ["pending", "Setup incomplete"], tone: "warning" };
  }
  if (status.state === "RESTRICTED") {
    return {
      title: "Paid tickets are off sale",
      description: "Stripe paused card payments for this account. Free tickets still work. Fix it in Stripe, then refresh.",
      badge: ["failed", "Needs attention"],
      tone: "danger"
    };
  }
  if (status.state === "ERROR") {
    return {
      title: "Status may be out of date",
      description: "Thunderstrux couldn't reach Stripe. Showing the last known status; sales follow it until a refresh succeeds.",
      badge: ["pending", "Out of date"],
      tone: "warning"
    };
  }
  // Ready: the rows below say what still needs doing.
  return null;
}

function readinessBadge(status: ConnectStatus | null): [Status, string] {
  if (status?.state === "READY") return status.payouts_enabled ? ["active", "Ready"] : ["pending", "Payouts not set up"];
  return stateContent(status)?.badge ?? ["draft", "Not connected"];
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
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

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
          dashboard_available: false,
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

  // Stripe signs the society in to its own Express Dashboard with a single-use link made now.
  async function openDashboard() {
    setIsOpeningDashboard(true);
    setMessage(null);

    try {
      await redirectToOnboarding("/api/stripe/connect/dashboard");
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ClientApiError ? error.message : "Unable to open the Stripe dashboard."
      });
      setIsOpeningDashboard(false);
    }
  }

  async function openDisconnect() {
    setMfaCode("");
    setDisconnectError(null);
    // The server decides; this only chooses whether to show the code field.
    const mfa = await fetchJson<{ mode: string }>("/api/me/mfa/status").catch(() => ({ mode: "enforce" }));
    setNeedsCode(mfa.mode !== "off");
    setConfirmingDisconnect(true);
  }

  async function disconnectStripe() {
    if (!organisation) {
      return;
    }

    setIsDisconnecting(true);
    setDisconnectError(null);

    try {
      const data = await fetchJson<{ disconnected: boolean; status: ConnectStatus }>("/api/stripe/connect/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: organisation.id, ...(needsCode ? { mfaCode } : {}) })
      });

      setStatus(data.status);
      setConfirmingDisconnect(false);
      setMessage({ ok: true, text: "Stripe account disconnected." });
    } catch (error) {
      setDisconnectError(getClientErrorMessage(error, "Unable to disconnect the Stripe account."));
      // A 409 means orders still depend on the account; show the current count.
      if (error instanceof ClientApiError && error.status === 409) void checkStatus(organisation);
    } finally {
      setIsDisconnecting(false);
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
  const badge = readinessBadge(status);
  const requirements = status?.currently_due ?? [];
  const isConnected = Boolean(status?.connected);
  const isPlatformNotReady = status?.state === "PLATFORM_NOT_READY";
  const openObligations = status?.openObligations ?? 0;
  const exampleFee = calculatePlatformFee(2000);
  const rows = [
    {
      label: "Can take payments",
      ok: Boolean(status?.charges_enabled),
      text: status?.charges_enabled ? "Buyers can pay for tickets by card. Paid tickets are on sale." : "Not yet. Paid tickets go on sale once Stripe enables card payments.",
      action: null
    },
    {
      label: "Can receive payouts",
      ok: Boolean(status?.payouts_enabled),
      text: status?.payouts_enabled
        ? "Yes. Thunderstrux sends your money to your bank once each event is over; see Payouts below."
        : "Not yet. Ticket money is held in Stripe until you add a bank account. Sales keep working meanwhile.",
      action:
        status?.state === "READY" && !status.payouts_enabled ? (
          <Button disabled={isContinuingOnboarding} onClick={continueOnboarding} size="sm" type="button">
            {isContinuingOnboarding ? "Redirecting..." : "Add a bank account in Stripe"}
          </Button>
        ) : null
    }
  ];

  const dashboardButton = (label: string, variant: "primary" | "secondary") => (
    <Button disabled={isOpeningDashboard || !status?.dashboard_available} onClick={openDashboard} type="button" variant={variant}>
      {isOpeningDashboard ? "Opening Stripe..." : label}
    </Button>
  );
  const waiting = status?.payouts?.held.total ?? 0;

  return (
    <>
      {isConnected && status?.payouts?.failed ? (
        <PayoutFailedNotice action={dashboardButton("Check bank details in Stripe", "primary")} failed={status.payouts.failed} />
      ) : null}

      <Card>
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-ink">Stripe account</h2>
            <StatusBadge label={badge[1]} status={badge[0]} />
          </div>

          {content ? (
            <Notice title={content.title} tone={content.tone}>
              <p>{content.description}</p>
              {status?.disabled_reason ? <p className="mt-1">Stripe reason: {formatRequirement(status.disabled_reason)}</p> : null}
              {requirements.length > 0 ? (
                <p className="mt-1">Stripe still needs: {requirements.map(formatRequirement).join("; ")}.</p>
              ) : null}
            </Notice>
          ) : null}

          {message ? (
            <Notice role={message.ok ? "status" : "alert"} tone={message.ok ? "success" : "danger"}>
              {message.text}
            </Notice>
          ) : null}

          {isConnected ? (
            <ul aria-label="What your Stripe account can do" className="grid">
              {rows.map((row) => (
                <li className="flex flex-wrap items-start gap-x-4 gap-y-3 border-t border-line py-4" key={row.label}>
                  <Icon className={row.ok ? "mt-0.5 text-success" : "mt-0.5 text-warning"} name={row.ok ? "success" : "warning"} size={22} />
                  <div className="grid min-w-0 flex-1 basis-72 gap-0.5">
                    <span className="font-semibold text-ink">
                      <span className="sr-only">{row.ok ? "Ready: " : "Needs attention: "}</span>
                      {row.label}
                    </span>
                    <span className="text-sm text-ink-soft">{row.text}</span>
                  </div>
                  {row.action}
                </li>
              ))}
            </ul>
          ) : null}

          {status?.accountId ? (
            <dl className="grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-ink-soft">Stripe account</dt>
              <dd className="font-mono text-ink [overflow-wrap:anywhere]">{status.accountId}</dd>
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
                {isStartingOnboarding ? "Redirecting..." : "Connect Stripe"}
              </Button>
            ) : null}

            {status?.state === "CONNECTED_INCOMPLETE" || status?.state === "RESTRICTED" ? (
              <Button disabled={isContinuingOnboarding} onClick={continueOnboarding} type="button">
                {isContinuingOnboarding ? "Redirecting..." : status.state === "RESTRICTED" ? "Fix in Stripe" : "Continue Stripe setup"}
              </Button>
            ) : null}

            {isConnected ? (
              <Button
                disabled={isCheckingStatus}
                onClick={() => organisation && void checkStatus(organisation, true)}
                type="button"
                variant="secondary"
              >
                {isCheckingStatus ? "Refreshing..." : status?.state === "ERROR" ? "Try again" : "Refresh status"}
              </Button>
            ) : null}

            {status?.dashboard_available ? (
              <Button disabled={isOpeningDashboard} onClick={openDashboard} type="button" variant="secondary">
                {isOpeningDashboard ? "Opening Stripe..." : "Open Stripe dashboard"}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {isConnected && status?.payouts ? (
        <PayoutsCard
          payouts={status.payouts}
          payoutsEnabled={status.payouts_enabled}
          seeAll={status.dashboard_available ? <div>{dashboardButton("See every payout in Stripe", "secondary")}</div> : null}
        />
      ) : null}

      <Card>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold text-ink">Fees</h2>
            <p className="text-[15px] text-ink-soft">
              Thunderstrux keeps 3.75% of each paid order plus $0.89 for each ticket, membership or merchandise order,
              rounded to the cent once per order. Buyers pay the price you set, with nothing added. Free sales have no fee.
            </p>
          </div>
          <div className="grid gap-2 rounded-control bg-surface-subtle px-5 py-4">
            <p className="text-sm font-semibold text-ink-soft">Example: one $20.00 ticket</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px] tabular-nums">
              <dt>The buyer pays</dt>
              <dd className="text-right font-semibold">{formatMoney(2000)}</dd>
              <dt>Thunderstrux keeps</dt>
              <dd className="text-right">{formatMoney(exampleFee)}</dd>
              <dt className="border-t border-line pt-1.5 font-semibold">Your society receives</dt>
              <dd className="border-t border-line pt-1.5 text-right font-semibold">{formatMoney(2000 - exampleFee)}</dd>
            </dl>
            <p className="text-[13px] text-ink-muted">
              Card processing is included: Stripe charges its processing fee to Thunderstrux, not to your society.
            </p>
          </div>
          <p className="text-sm text-ink-soft">Each order keeps the fee it was sold under, so a later change never alters past sales.</p>
        </div>
      </Card>

      {isConnected || isPlatformNotReady ? (
        <div className="grid gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
          <div className="grid max-w-xl gap-1">
            <h2 className="text-lg font-semibold text-ink">Disconnect Stripe</h2>
            <p className="text-sm text-ink-soft">
              Unlinks the account from Thunderstrux only. Your Stripe account and its money are not touched, and Stripe
              pays out what&apos;s left on its usual schedule. Paid sales stop until you connect again.
            </p>
          </div>
          {openObligations > 0 ? (
            <Notice title="You can't disconnect right now" tone="info">
              <p>
                {openObligations} {openObligations === 1 ? "order is" : "orders are"} still being paid or reviewed,
                and {openObligations === 1 ? "it needs" : "they need"} this account. Try again once they finish.
              </p>
              <Link className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href="/dashboard/orders">
                View orders
              </Link>
            </Notice>
          ) : null}
          <div>
            <Button
              disabled={isDisconnecting || openObligations > 0}
              onClick={openDisconnect}
              type="button"
              variant="danger"
            >
              Disconnect Stripe account
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        busy={isDisconnecting}
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={disconnectStripe}
        open={confirmingDisconnect}
        title="Disconnect Stripe?"
      >
        <div className="grid gap-4">
          <p>
            Paid tickets go off sale for every event until you connect again. Your Stripe account and its balance are not
            touched: Stripe pays {waiting > 0 ? `the ${formatMoney(waiting)} still waiting` : "anything left"} into your bank on its
            usual schedule. Past orders keep the account they were paid to.
          </p>
          {needsCode ? (
            <TextInput
              autoComplete="one-time-code"
              hint="6 digits from your authenticator app"
              inputMode="numeric"
              label="Authenticator code"
              onChange={(event) => setMfaCode(event.target.value)}
              value={mfaCode}
            />
          ) : null}
          {disconnectError ? (
            <p className="text-sm text-danger" role="alert">
              {disconnectError}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
