"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { tabBarClasses, tabClasses } from "@/components/ui/link-tabs";
import { useLeaveGuard } from "@/lib/client/leave-guard";
import { profileSteps } from "./profile-steps";
import { TextInput, TextArea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Notice } from "@/components/ui/notice";
import {
  ClientApiError,
  fetchJson,
  getClientErrorMessage,
} from "@/lib/client/api";
type Profile = {
  id: string;
  slug: string;
  name: string;
  description: string;
  supportEmail: string;
  refundPolicy: string;
  pickupPolicy: string;
  timeZone: string;
  logoAssetId: string | null;
  coverAssetId: string | null;
  profileVersion: number;
  onboardingCompletedAt: string | null;
};
const steps = ["Identity", "Branding", "Operations", "Finish"];
// null means the caller may not see that fact; the row is then omitted.
type Checklist = {
  activeStaff: number | null;
  pendingInvites: number | null;
  chargesReady: boolean | null;
};
export function SocietyProfile({
  initialProfile,
  checklist,
  timeZones,
  initialStep = 0,
}: {
  initialProfile: Profile;
  checklist: Checklist;
  timeZones: string[];
  initialStep?: number;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [saved, setSaved] = useState(initialProfile);
  const [step, setStep] = useState(initialStep);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmingReload, setConfirmingReload] = useState(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved);
  const fileInputs = useRef<Partial<Record<"logo" | "cover", HTMLInputElement | null>>>({});
  // Links in the app and closing the tab both ask before unsaved edits are lost.
  useLeaveGuard(dirty);
  // Changing step stays on the client; the address follows so a reload keeps it.
  function go(index: number) {
    setStep(index);
    window.history.replaceState(null, "", index === 0 ? window.location.pathname : `?step=${profileSteps[index]}`);
  }
  // Which steps are done, from what is saved: shown as a tick and read out.
  const done = [
    Boolean(saved.name.trim() && saved.description.trim() && saved.supportEmail.trim()),
    Boolean(saved.logoAssetId || saved.coverAssetId),
    Boolean(saved.refundPolicy.trim() && saved.pickupPolicy.trim()),
    Boolean(saved.onboardingCompletedAt),
  ];
  const endpoint = `/api/orgs/${profile.slug}/profile`;
  function field(
    key:
      | "name"
      | "description"
      | "supportEmail"
      | "refundPolicy"
      | "pickupPolicy"
      | "timeZone",
    value: string,
  ) {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await persist();
  }
  // Continue saves first when there are changes, so moving on never drops them.
  async function saveAndContinue() {
    if (!dirty || (await persist())) go(step + 1);
  }
  async function persist() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const {
        id: _id,
        slug: _slug,
        profileVersion,
        onboardingCompletedAt: _completed,
        ...values
      } = profile;
      const response = await fetchJson<{ profile: Profile }>(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          expectedProfileVersion: profileVersion,
        }),
      });
      setProfile(response.profile);
      setSaved(response.profile);
      setConflict(false);
      setMessage("Profile saved.");
      return true;
    } catch (failure) {
      setConflict(failure instanceof ClientApiError && failure.status === 409);
      setError(getClientErrorMessage(failure, "Unable to save profile."));
      return false;
    } finally {
      setBusy(false);
    }
  }
  // Keeps what the user typed and saves it over the newer version, by choice.
  async function saveOverLatest() {
    setBusy(true);
    setError("");
    try {
      const latest = await fetchJson<{ profile: Profile }>(endpoint, {
        cache: "no-store",
      });
      const {
        id: _id,
        slug: _slug,
        profileVersion: _stale,
        onboardingCompletedAt: _completed,
        ...values
      } = profile;
      const response = await fetchJson<{ profile: Profile }>(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          expectedProfileVersion: latest.profile.profileVersion,
        }),
      });
      setProfile(response.profile);
      setSaved(response.profile);
      setConflict(false);
      setMessage("Profile saved.");
    } catch (failure) {
      setError(getClientErrorMessage(failure, "Unable to save profile."));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setConfirmingReload(false);
    setBusy(true);
    setError("");
    try {
      const response = await fetchJson<{ profile: Profile }>(endpoint, {
        cache: "no-store",
      });
      setProfile(response.profile);
      setSaved(response.profile);
      setConflict(false);
      setMessage("Latest profile loaded.");
    } catch (failure) {
      setError(getClientErrorMessage(failure, "Unable to reload profile."));
    } finally {
      setBusy(false);
    }
  }
  async function upload(kind: "logo" | "cover", file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetchJson<{ asset: { id: string } }>(
        `/api/orgs/${profile.slug}/assets?kind=${kind}`,
        { method: "POST", body: form },
      );
      setProfile((current) => ({
        ...current,
        [`${kind}AssetId`]: response.asset.id,
      }));
      setMessage("Image uploaded. Save the profile to publish it.");
    } catch (failure) {
      setError(getClientErrorMessage(failure, "Unable to upload image."));
    } finally {
      setBusy(false);
    }
  }
  const facts = [
    {
      done: !!saved.onboardingCompletedAt,
      text: saved.onboardingCompletedAt
        ? "Profile complete."
        : "Profile incomplete: save a name, description and public contact email.",
    },
    ...(checklist.chargesReady === null
      ? []
      : [
          {
            done: checklist.chargesReady,
            text: checklist.chargesReady
              ? "Payments ready: Stripe can accept charges for this society."
              : "Payments not ready: paid tickets cannot be sold until Stripe setup is finished.",
            href: "/dashboard/settings",
            link: "Open Payments",
          },
        ]),
    ...(checklist.activeStaff === null
      ? []
      : [
          {
            done: checklist.activeStaff > 1,
            text:
              checklist.activeStaff > 1
                ? `Team: ${checklist.activeStaff} people have staff access.`
                : `Team: one person has staff access${checklist.pendingInvites ? ` and ${checklist.pendingInvites} invitation${checklist.pendingInvites === 1 ? " is" : "s are"} pending` : ""}. Invite a second committee member so access survives a handover.`,
            href: "/dashboard/settings/staff",
            link: "Manage staff",
          },
        ]),
  ];
  return (
    <section className="grid gap-6 rounded-card border border-line bg-surface p-5 sm:p-6">
      {/* Steps read as tabs, not a row of actions; each stays a button with aria-current. */}
      {/* min-w-0: a grid item, so the bar scrolls instead of widening the page. */}
      <nav aria-label="Profile setup steps" className={`min-w-0 ${tabBarClasses}`}>
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`relative ${tabClasses(index === step)} disabled:cursor-not-allowed`}
            onClick={() => go(index)}
            aria-current={index === step ? "step" : undefined}
            disabled={busy}
          >
            {index + 1}. {label}
            {done[index] ? (
              <>
                <Icon className="text-success" name="success" size={16} />
                <span className="sr-only">, done</span>
              </>
            ) : null}
          </button>
        ))}
      </nav>
      <form onSubmit={save} className="grid gap-5">
        {conflict && (
          <Notice title="Someone else saved this profile" tone="warning">
            <p>
              Your edits are still in the form. Choose which version to keep.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={saveOverLatest}
              >
                Save my version
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => (dirty ? setConfirmingReload(true) : reload())}
              >
                Reload latest profile
              </Button>
            </div>
          </Notice>
        )}
        <fieldset disabled={busy} className="grid gap-5">
          <legend className="mb-4 text-lg font-semibold text-ink">
            {steps[step]}
          </legend>
          {step === 0 && (
            <>
              <TextInput
                label="Society name"
                value={profile.name}
                required
                maxLength={120}
                onChange={(event) => field("name", event.target.value)}
              />
              <TextArea
                label="Description"
                value={profile.description}
                maxLength={5000}
                onChange={(event) => field("description", event.target.value)}
              />
              <TextInput
                hint="These details are public. Use a society contact address. Completion requires all three."
                label="Public contact email"
                type="email"
                value={profile.supportEmail}
                maxLength={254}
                onChange={(event) => field("supportEmail", event.target.value)}
              />
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-sm text-ink-soft">
                Optional JPEG, PNG or WebP, up to 5 MB and 4096 × 4096 pixels.
                Removing an image takes effect when you save.
              </p>
              {(["logo", "cover"] as const).map((kind) => (
                <div className="grid gap-3" key={kind}>
                  <span className="text-sm font-semibold text-ink" id={`${kind}-label`}>
                    {kind === "logo" ? "Logo image" : "Cover image"}
                  </span>
                  {/* The button opens it, as on the event and product forms; hidden, so it
                      isn't a second, unstyled control. */}
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={kind === "logo" ? "Logo image" : "Cover image"}
                    className="hidden"
                    onChange={(event) => {
                      void upload(kind, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    ref={(element) => {
                      fileInputs.current[kind] = element;
                    }}
                    type="file"
                  />
                  {/* The image first, then what you can do with it, as on the event form. */}
                  {profile[`${kind}AssetId`] && (
                    <img
                      alt={`${kind} preview`}
                      className={
                        kind === "logo"
                          ? "h-24 w-24 rounded-control border border-line object-contain"
                          : "max-h-48 w-full rounded-control object-cover"
                      }
                      src={`/api/orgs/${profile.slug}/assets/${profile[`${kind}AssetId`]}`}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button aria-describedby={`${kind}-label`} onClick={() => fileInputs.current[kind]?.click()} type="button" variant="secondary">
                      {profile[`${kind}AssetId`] ? `Replace ${kind}` : `Upload ${kind}`}
                    </Button>
                    {profile[`${kind}AssetId`] && (
                      <Button
                        type="button"
                        variant="tertiary"
                        onClick={() =>
                          setProfile((current) => ({
                            ...current,
                            [`${kind}AssetId`]: null,
                          }))
                        }
                      >
                        Remove {kind}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          {step === 2 && (
            <>
              <Select
                hint="Event dates on your public pages are shown in this timezone."
                label="Society timezone"
                value={profile.timeZone}
                required
                onChange={(value) => field("timeZone", value)}
              >
                {/* Societies are Australian first: their zones lead, the rest follow. */}
                <optgroup label="Australia">
                  {timeZones.filter((zone) => zone.startsWith("Australia/")).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.slice("Australia/".length).replace(/_/g, " ")}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other time zones">
                  {timeZones.filter((zone) => !zone.startsWith("Australia/")).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace(/_/g, " ")}
                    </option>
                  ))}
                </optgroup>
              </Select>
              {/* UI-009: one policy is shown at every checkout, so it should cover each kind of sale. */}
              <TextArea
                hint="Shown when people buy tickets, memberships or merchandise, so cover each. For example: tickets refunded up to 48 hours before the event; memberships and uncollected merchandise within 14 days."
                label="Refund policy for tickets, memberships and merchandise"
                value={profile.refundPolicy}
                maxLength={5000}
                onChange={(event) => field("refundPolicy", event.target.value)}
              />
              <TextArea
                hint="Policies are optional and displayed publicly. These settings do not change existing sales or refunds."
                label="Public pickup policy"
                value={profile.pickupPolicy}
                maxLength={5000}
                onChange={(event) => field("pickupPolicy", event.target.value)}
              />
            </>
          )}
          {step === 3 && (
            <>
              <ul className="grid gap-3">
                {facts.map((fact) => (
                  <li key={fact.text}>
                    {/* Amber only where sales are blocked; other gaps are information. */}
                    <Notice
                      action={
                        "href" in fact && fact.href ? (
                          <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={fact.href}>
                            {fact.link}
                          </Link>
                        ) : null
                      }
                      tone={fact.done ? "success" : "href" in fact && fact.href === "/dashboard/settings" ? "warning" : "info"}
                    >
                      {fact.text}
                    </Notice>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                <Link
                  className={buttonClasses({ variant: "secondary" })}
                  href={`/societies/${profile.slug}`}
                >
                  View public profile
                </Link>
                <Link
                  className={buttonClasses({ variant: "tertiary" })}
                  href="/mfa?callbackUrl=/dashboard/settings/profile"
                >
                  Staff authenticator settings
                </Link>
              </div>
            </>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button busy={busy} busyLabel="Saving…" type="submit" disabled={conflict}>
            Save profile
          </Button>
          {step < 3 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || (dirty && conflict)}
              onClick={() => void saveAndContinue()}
            >
              {dirty ? "Save and continue" : "Continue"}
            </Button>
          )}
          <span className="text-sm text-ink-muted">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>
        {error && (
          <Notice reveal role="alert" tone="danger">
            {error}
          </Notice>
        )}
        {message && (
          <Notice reveal role="status" tone="success">
            {message}
          </Notice>
        )}
      </form>
      <ConfirmDialog
        confirmLabel="Discard my edits"
        destructive
        onCancel={() => setConfirmingReload(false)}
        onConfirm={reload}
        open={confirmingReload}
        title="Discard your unsaved edits?"
      >
        The form will show the latest saved profile. What you typed since your
        last save is lost.
      </ConfirmDialog>
    </section>
  );
}
