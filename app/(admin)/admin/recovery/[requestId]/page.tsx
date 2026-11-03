import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminActions } from "@/components/admin/action-dialog";
import { AdminShell, adminEnvironment } from "@/components/admin/admin-shell";
import { IdChip } from "@/components/admin/id-chip";
import { AdminTime, Breadcrumbs, Facts, Panel, RecordHeader, rowLink } from "@/components/admin/record";
import { Icon, type IconName } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { recordPlatformView } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { readRecoveryRequest } from "@/lib/platform/recovery";
import { personLabel } from "@/lib/platform/records";
import { recoverySpecs } from "@/lib/platform/specs";

export const metadata: Metadata = { title: "Admin recovery request" };

const delivery = (row: { status: string; acceptedAt: Date | null }) =>
  row.acceptedAt ? "accepted by the email provider" : row.status === "failed" ? "failed: check Email delivery" : row.status === "cancelled" ? "not sent" : "waiting to send";

const left = (until: Date, now: Date) => {
  const minutes = Math.max(0, Math.round((until.getTime() - now.getTime()) / 60_000));
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

function Step({ icon, state, title, children }: { icon: IconName; state: "done" | "now" | "later"; title: string; children?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
      <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${state === "done" ? "border-ink bg-ink text-white" : state === "now" ? "border-warning-border bg-warning-bg text-warning" : "border-line bg-surface text-ink-muted"}`}>
        <Icon name={icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-col gap-1 pt-1">
        <strong className={state === "later" ? "text-ink-muted" : ""}>{title}</strong>
        {children}
      </div>
    </li>
  );
}

// T55 (board H8): one recovery request as a timeline: requested, who was told
// and whether each notice went out, when it becomes completable, and the outcome.
// Cancel is always one click away while it's pending; Complete unlocks at executeAfter.
export default async function AdminRecoveryPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const path = `/admin/recovery/${encodeURIComponent(requestId)}`;
  const actor = await requirePlatformPage("platform:read", path);
  const record = await readRecoveryRequest(requestId);
  if (!record) notFound();
  const { request, people, checks } = record;
  await recordPlatformView(actor, { type: "Recovery", id: request.id, organisationId: request.organisation?.id });
  const now = new Date();
  const target = personLabel(request.target);
  const title = request.kind === "mfa_reset" ? `Reset ${target}'s authenticator` : `${target} → owner of ${request.organisation?.name ?? "a deleted society"}`;
  const ready = request.executeAfter <= now;
  const specs = recoverySpecs({
    role: actor.role, title, checks, now, completeLabel: request.kind === "mfa_reset" ? "Reset authenticator" : `Make ${target} an owner`,
    request: { id: request.id, kind: request.kind, executeAfter: request.executeAfter, pending: request.status === "pending" }
  });
  const env = adminEnvironment().label;
  return (
    <AdminShell actor={actor} current={request.organisation ? "societies" : "users"}>
      <Breadcrumbs items={request.organisation
        ? [{ label: "Societies", href: "/admin/societies" }, { label: request.organisation.name, href: `/admin/societies/${request.organisation.id}` }, { label: "Ownership recovery" }]
        : [{ label: "Users", href: "/admin/users" }, { label: target, href: `/admin/users/${request.target.id}` }, { label: "Authenticator reset" }]} />
      <RecordHeader
        badges={request.status === "completed" ? <StatusBadge label="Completed" status="ready" /> : request.status === "cancelled" ? <StatusBadge label="Cancelled" status="revoked" />
          : ready ? <StatusBadge label="Ready to complete" status="under-review" /> : <StatusBadge label="Waiting" status="on-hold" />}
        ids={<IdChip label="request id" value={request.id} />}
        title={title}
        type={request.kind === "mfa_reset" ? "Authenticator reset" : "Ownership recovery"}
      />
      {/* The outcome stays on the page, so it survives the refresh that ends the dialog (board H8, state 5). */}
      {request.status === "completed" ? (
        <Notice role="status" title={request.kind === "mfa_reset" ? `${target}'s authenticator was reset` : `${target} is an owner of ${request.organisation?.name ?? "the society"}`} tone="success">
          Completed <AdminTime value={request.completedAt} />. {request.kind === "ownership" ? "Payouts are held for 7 days. " : "They set up a new authenticator at their next sign-in. "}Everyone told was emailed again.
        </Notice>
      ) : request.status === "cancelled" ? <Notice role="status" title="Request cancelled">Nothing was changed. Everyone told was emailed.</Notice> : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-[18px]">
        <Panel title="Timeline">
          <div className="grid gap-4 px-4 py-4">
            <ol>
              <Step icon="success" state="done" title={`Requested by ${request.requestedBy ? personLabel(request.requestedBy) : "an operator"}`}>
                <span className="text-[13px] text-ink-muted"><AdminTime value={request.createdAt} /> · {request.reason}</span>
              </Step>
              <Step icon="mail" state="done" title={`${people.length} ${people.length === 1 ? "person" : "people"} told`}>
                <ul className="grid gap-1 text-[13px]">
                  {people.map((row) => <li className="flex flex-wrap justify-between gap-x-3" key={row.recipient}><span>{row.recipient}</span><span className="text-ink-muted">{delivery(row)}</span></li>)}
                </ul>
              </Step>
              <Step icon="clock" state={ready || request.status !== "pending" ? "done" : "now"} title="Ready">
                <span className="text-[13px] text-ink-muted"><AdminTime value={request.executeAfter} />{request.status === "pending" && !ready ? ` · ${left(request.executeAfter, now)}` : ""}</span>
              </Step>
              {request.status === "cancelled" ? (
                <Step icon="close" state="done" title={`Cancelled by ${request.cancelledBy ? personLabel(request.cancelledBy) : "an operator"}`}><span className="text-[13px] text-ink-muted"><AdminTime value={request.cancelledAt} /></span></Step>
              ) : (
                <Step icon="shield" state={request.status === "completed" ? "done" : ready ? "now" : "later"} title={request.status === "completed" ? "Completed" : "Complete"}>
                  {request.completedAt ? <span className="text-[13px] text-ink-muted"><AdminTime value={request.completedAt} /></span> : null}
                </Step>
              )}
            </ol>
            {specs ? (
              <div className="flex flex-wrap items-start justify-between gap-3 border-t border-[#efedf3] pt-3.5">
                <AdminActions env={env} specs={[specs.complete]} />
                <AdminActions env={env} specs={[specs.cancel]} />
              </div>
            ) : null}
          </div>
        </Panel>
        <Panel note="What the operator checked, as written" title="Evidence">
          <Facts rows={[
            ["Person", <Link className={rowLink} href={`/admin/users/${request.target.id}`} key="p">{target}</Link>],
            ...(request.organisation ? [["Society", <Link className={rowLink} href={`/admin/societies/${request.organisation.id}`} key="s">{request.organisation.name}</Link>] as [string, React.ReactNode]] : []),
            ["Checked", <span className="whitespace-pre-wrap" key="e">{request.evidence}</span>],
            ["Now", <ul className="grid gap-1" key="c">{checks.map((check) => <li className={check.ok ? "" : "font-semibold text-warning"} key={check.text}>{check.ok ? "✓" : "✗"} {check.text}</li>)}</ul>]
          ]} />
        </Panel>
      </div>
    </AdminShell>
  );
}
