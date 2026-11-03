import type { PlatformOperatorRole } from "@prisma/client";
import { roleLabels } from "@/lib/audit/history";
import { formatDateTime } from "@/lib/format";
import { hasPlatformPermission } from "@/lib/permissions/platform";

// T55 (board H7): what each change's dialog says, built from facts already on
// the page. Only actions the role allows are listed; one that doesn't apply now
// is listed disabled, with why.

export type ActionSpec = {
  key: string;
  // The menu or button text, e.g. "Disable account…".
  label: string;
  // Visible but unavailable, with why, so the rules are learnt without trying them.
  disabledReason?: string;
  title: string;
  subtitle?: string;
  does: string[];
  doesNot?: string[];
  warn?: string[];
  reasons: string[];
  // Undo fills the reason in.
  defaultReason?: string;
  confirm: string;
  danger?: boolean;
  request: { action: string; targetId: string; userId?: string; evidence?: string };
  // An optional end date (payout hold).
  untilField?: boolean;
  done: { title: string; body: string };
  undo?: ActionSpec;
};

type Person = { id: string; name: string; email: string };

export function userActionSpecs(input: {
  role: PlatformOperatorRole; self: boolean; user: Person & { verified: boolean; disabled: boolean; closed: boolean; operator: boolean };
  staff: Array<{ society: string; role: string; soleOwner: boolean }>;
}): ActionSpec[] {
  const { user, role } = input;
  const subtitle = `${user.name} · ${user.id}`;
  const blocked = input.self ? "This is your own account" : user.operator ? "Operator accounts change with pnpm ops:operator" : user.closed ? "Account is closed" : undefined;
  const request = (action: string) => ({ action, targetId: user.id });
  const roles = input.staff.map((row) => `${row.society} (${(roleLabels[row.role] ?? row.role).toLowerCase()})`).join(", ");
  const enable: ActionSpec = {
    key: "enable", label: "Re-enable account…", title: "Re-enable account", subtitle, confirm: "Re-enable account", request: request("enable_account"),
    does: [`${user.name} can sign in again${input.staff.length ? `; their ${input.staff.length === 1 ? "staff role works" : `${input.staff.length} staff roles work`} again` : ""}`,
      `Emails ${user.email}${input.staff.length ? `; adds a line to ${input.staff.length === 1 ? "the society's" : "each society's"} History` : ""}`],
    reasons: ["Disabled by mistake", "Cleared after investigation", "Asked by the account holder"],
    done: { title: "Account enabled again", body: `${user.name} was emailed and can sign in.` },
    disabledReason: blocked ?? (!user.disabled ? "Account isn't disabled" : undefined)
  };
  const disable: ActionSpec = {
    key: "disable", label: "Disable account…", title: "Disable account", subtitle, confirm: "Disable account", danger: true, request: request("disable_account"),
    does: [`Signs ${user.name} out on every device, now`, ...(roles ? [`Ends their access to ${roles} until re-enabled`] : []),
      `Emails ${user.email} that Thunderstrux support disabled the account`, ...(input.staff.length ? [`Adds a line to ${input.staff.length === 1 ? "the society's" : "each society's"} History, as Thunderstrux support`] : [])],
    warn: input.staff.filter((row) => row.soleOwner).map((row) => `${row.society} will have no live owner. Ownership recovery is the way back.`),
    doesNot: ["Tickets and orders stay valid; nothing is refunded"],
    reasons: ["Account reported compromised", "Abuse reported by a society", "Asked by the account holder"],
    done: { title: "Account disabled", body: `${user.name} is signed out everywhere and was emailed. The audit row is first in Activity.` },
    undo: { ...enable, disabledReason: undefined },
    disabledReason: blocked ?? (user.disabled ? "Account is already disabled" : undefined)
  };
  const specs: ActionSpec[] = [
    { key: "verify", label: "Resend verification…", title: "Resend verification email", subtitle, confirm: "Send verification", request: request("resend_verification"),
      does: [`Emails ${user.email} a new verification link, valid for 24 hours`, "Earlier links stop working"], reasons: ["Asked by the account holder", "Verification email didn't arrive"],
      done: { title: "Verification sent", body: `A new link is on its way to ${user.email}.` },
      disabledReason: blocked ?? (user.disabled ? "Account is disabled" : user.verified ? "Email is already verified" : undefined) },
    { key: "reset", label: "Send password reset…", title: "Send password reset", subtitle, confirm: "Send reset link", request: request("send_password_reset"),
      does: [`Emails ${user.email} a reset link, valid for 30 minutes`], doesNot: ["Doesn't change the password or sign anyone out until the link is used"],
      reasons: ["Asked by the account holder", "Can't sign in"], done: { title: "Reset link sent", body: `It's on its way to ${user.email}.` },
      disabledReason: blocked ?? (user.disabled ? "Account is disabled" : undefined) },
    { key: "signout", label: "Sign out everywhere…", title: "Sign out everywhere", subtitle, confirm: "Sign out everywhere", request: request("sign_out_everywhere"),
      does: [`Ends every session ${user.name} has, now`, "Their next sign-in asks for their authenticator again", `Emails ${user.email}`],
      doesNot: ["Doesn't change the password; send a reset too if it may be known"], reasons: ["Account reported compromised", "Asked by the account holder", "Lost a device"],
      done: { title: "Signed out everywhere", body: `${user.name} was emailed.` }, disabledReason: blocked }
  ];
  if (!hasPlatformPermission(role, "platform:account_assist")) specs.length = 0;
  if (hasPlatformPermission(role, "platform:account_disable")) specs.push(user.disabled ? enable : disable);
  return specs;
}

export function societyActionSpecs(input: {
  role: PlatformOperatorRole; society: { id: string; name: string; restricted: boolean; held: boolean; heldUntil: Date | null; timeZone: string }; owners: string[];
}): ActionSpec[] {
  if (!hasPlatformPermission(input.role, "platform:society_control")) return [];
  const { society } = input;
  const subtitle = `${society.name} · ${society.id}`;
  const request = (action: string) => ({ action, targetId: society.id });
  const emails = input.owners.length ? `Emails the owners (${input.owners.join(", ")})` : "No active owner to email";
  const lift: ActionSpec = {
    key: "lift", label: "Lift restriction…", title: "Lift restriction", subtitle, confirm: "Lift restriction", request: request("lift_restriction"),
    does: ["Sales, publishing and Stripe changes work again", "Payouts resume, unless they're held too", emails, "Adds a line to the society's History"],
    reasons: ["Cleared after investigation", "Restricted by mistake"], done: { title: "Restriction lifted", body: `${society.name} can sell again.` },
    disabledReason: society.restricted ? undefined : "Society isn't restricted"
  };
  const restrict: ActionSpec = {
    key: "restrict", label: "Restrict society…", title: "Restrict society", subtitle, confirm: "Restrict society", danger: true, request: request("restrict_society"),
    does: ["Refuses new checkouts: tickets, memberships, merchandise and free registration", "Refuses publishing and reopening sales", "Refuses the Stripe dashboard link and disconnect",
      "Holds payouts", "Takes its events out of Explore, the home page and its society page; event pages say tickets aren't on sale", emails, "Adds a line to the society's History"],
    doesNot: ["Tickets already sold stay valid; check-in and refunds work", "A payment Stripe already took is still fulfilled"],
    reasons: ["Suspected scam event", "Terms of use broken", "Payment fraud under review"],
    done: { title: "Society restricted", body: "Sales and payouts are paused. The owners were emailed." },
    undo: { ...lift, disabledReason: undefined },
    disabledReason: society.restricted ? "Society is already restricted" : undefined
  };
  const release: ActionSpec = {
    key: "release", label: "Release payouts…", title: "Release payouts", subtitle, confirm: "Release payouts", request: request("release_payouts"),
    does: ["The payouts worker pays out on its next hourly check, unless the society is restricted", "Adds a line to the society's History"],
    reasons: ["Cleared after investigation", "Held by mistake"], done: { title: "Payouts released", body: "They go out on the next hourly check." },
    disabledReason: society.held ? undefined : "Payouts aren't held"
  };
  const hold: ActionSpec = {
    key: "hold", label: "Hold payouts…", title: "Hold payouts", subtitle, confirm: "Hold payouts", danger: true, request: request("hold_payouts"), untilField: true,
    does: ["The payouts worker skips this society until the end date, or until released", "Shows a notice on the society's Payments page", "Adds a line to the society's History"],
    warn: ["Stripe pays out money held on manual payouts after 90 days anyway (PAY-022)."], doesNot: ["Sales carry on; nothing is refunded"],
    reasons: ["Dispute or fraud under review", "Bank details changed suddenly", "Ownership changing"],
    done: { title: "Payouts held", body: "The payouts worker skips this society." }, undo: { ...release, disabledReason: undefined },
    disabledReason: society.held ? `Payouts are already held${society.heldUntil ? ` until ${formatDateTime(society.heldUntil, { timeZone: society.timeZone })}` : ""}` : undefined
  };
  return [society.restricted ? lift : restrict, society.held ? release : hold];
}

export function recoverySpecs(input: {
  role: PlatformOperatorRole; request: { id: string; kind: string; executeAfter: Date; pending: boolean }; title: string; checks: Array<{ ok: boolean; text: string }>; completeLabel: string; now: Date;
}): { complete: ActionSpec; cancel: ActionSpec } | null {
  if (!hasPlatformPermission(input.role, "platform:recovery") || !input.request.pending) return null;
  const subtitle = `${input.title} · ${input.request.id}`;
  const ready = input.request.executeAfter <= input.now;
  return {
    complete: {
      key: "complete", label: "Complete…", title: input.request.kind === "mfa_reset" ? "Complete authenticator reset" : "Complete ownership recovery", subtitle, confirm: input.completeLabel,
      request: { action: "complete_recovery", targetId: input.request.id },
      does: [ready ? "72 hours have passed; nobody cancelled" : "Not ready yet", ...input.checks.filter((check) => check.ok).map((check) => check.text)],
      warn: input.checks.filter((check) => !check.ok).map((check) => `Not true now: ${check.text}. Completing will be refused.`),
      doesNot: input.request.kind === "ownership" ? ["Nobody else's role changes", "Payouts are held for 7 days"] : ["Tickets, orders and society roles stay as they are"],
      reasons: ["72 hours passed with no objection"], done: { title: "Recovery completed", body: "Everyone told was emailed again." },
      disabledReason: ready ? undefined : `Unlocks ${formatDateTime(input.request.executeAfter)}`
    },
    cancel: {
      key: "cancel", label: "Cancel request…", title: "Cancel request", subtitle, confirm: "Cancel request", danger: true, request: { action: "cancel_recovery", targetId: input.request.id },
      does: ["Stops the request; it can't be completed", "Emails everyone it told"], reasons: ["Someone objected", "Requested by mistake", "Resolved another way"],
      done: { title: "Request cancelled", body: "Everyone it told was emailed." }
    }
  };
}

export function revokeSpec(input: { role: PlatformOperatorRole; self: boolean; lastAdmin: boolean; operator: Person & { role: string; active: boolean } }): ActionSpec | null {
  if (!hasPlatformPermission(input.role, "platform:operators")) return null;
  const { operator } = input;
  return {
    key: `revoke-${operator.id}`, label: "Revoke…", title: "Revoke operator", subtitle: `${operator.name} · ${operator.id}`, confirm: "Revoke operator", danger: true,
    request: { action: "revoke_operator", targetId: operator.id },
    does: [`${operator.name} loses ${operator.role} access to this portal at their next page`, "Raises the platform_operator_changed alert"],
    doesNot: ["Doesn't sign them out of anything else; their account stays a member account", "Granting again needs pnpm ops:operator on the host"],
    reasons: ["Left the team", "Access no longer needed", "Account may be compromised"], done: { title: "Operator revoked", body: `${operator.name} has no portal access now.` },
    disabledReason: !operator.active ? "Already revoked" : input.self ? "You can't revoke yourself" : input.lastAdmin ? "The last active admin; grant another from the CLI first" : undefined
  };
}

export function workerSpec(input: { role: PlatformOperatorRole; worker: string; paused: boolean }): ActionSpec | null {
  if (!hasPlatformPermission(input.role, "platform:operations")) return null;
  const all = input.worker === "all";
  const name = all ? "every job" : input.worker;
  const resume: ActionSpec = {
    key: `resume-${input.worker}`, label: all ? "Resume all…" : "Resume…", title: `Resume ${name}`, confirm: "Resume", request: { action: "resume_worker", targetId: input.worker },
    does: [`${all ? "Jobs" : "The job"} run again on their next schedule`, ...(all ? ["A job paused on its own stays paused"] : [])], reasons: ["Deploy finished", "Restore finished", "Incident over"],
    done: { title: `${all ? "Jobs" : input.worker} resumed`, body: "Its next scheduled run does work again." }
  };
  const pause: ActionSpec = {
    key: `pause-${input.worker}`, label: all ? "Pause all…" : "Pause…", title: `Pause ${name}`, confirm: "Pause", request: { action: "pause_worker", targetId: input.worker },
    does: [`Each run of ${name} exits at once without work, until resumed`, "The reason shows in this table"], doesNot: ["Doesn't stop a run in progress: wait until Running says no"],
    reasons: ["Deploying", "Restoring a backup", "Rolling back across a migration"],
    done: { title: `${all ? "Jobs" : input.worker} paused`, body: "Wait until Running says no before a restore or rollback." }, undo: resume
  };
  return input.paused ? resume : pause;
}

export function integrityAuditSpec(role: PlatformOperatorRole): ActionSpec | null {
  if (!hasPlatformPermission(role, "platform:operations")) return null;
  return {
    key: "audit", label: "Run now…", title: "Run the integrity audit", confirm: "Run audit", request: { action: "run_integrity_audit", targetId: "database" },
    does: ["Runs every read-only check of the database, as pnpm db:integrity:audit does", "Keeps each check's count and up to 5 sample ids in the trail, shown here"],
    doesNot: ["Changes no data and repairs nothing"], reasons: ["Routine check", "After a deploy", "After a restore", "Investigating an incident"],
    done: { title: "Audit finished", body: "The results below are this run's." }
  };
}
