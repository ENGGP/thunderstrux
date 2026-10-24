"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, TextInput, TextArea } from "@/components/ui/input";
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
}: {
  initialProfile: Profile;
  checklist: Checklist;
  timeZones: string[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [saved, setSaved] = useState(initialProfile);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmingReload, setConfirmingReload] = useState(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved);
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
    } catch (failure) {
      setConflict(failure instanceof ClientApiError && failure.status === 409);
      setError(getClientErrorMessage(failure, "Unable to save profile."));
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
      <nav aria-label="Profile setup steps" className="flex flex-wrap gap-2">
        {steps.map((label, index) => (
          <Button
            key={label}
            type="button"
            variant={index === step ? "primary" : "secondary"}
            onClick={() => setStep(index)}
            aria-current={index === step ? "step" : undefined}
            disabled={busy}
          >
            {index + 1}. {label}
          </Button>
        ))}
      </nav>
      <form onSubmit={save} className="grid gap-5">
        {error && (
          <Notice role="alert" tone="danger">
            {error}
          </Notice>
        )}
        {message && (
          <Notice role="status" tone="success">
            {message}
          </Notice>
        )}
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
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    <span>{kind === "logo" ? "Logo image" : "Cover image"}</span>
                    <input
                      className="font-normal"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        void upload(kind, event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {profile[`${kind}AssetId`] && (
                    <>
                      <img
                        alt={`${kind} preview`}
                        className={
                          kind === "logo"
                            ? "h-24 w-24 rounded-control border border-line object-contain"
                            : "max-h-48 w-full rounded-control object-cover"
                        }
                        src={`/api/orgs/${profile.slug}/assets/${profile[`${kind}AssetId`]}`}
                      />
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setProfile((current) => ({
                              ...current,
                              [`${kind}AssetId`]: null,
                            }))
                          }
                        >
                          Remove {kind}
                        </Button>
                      </div>
                    </>
                  )}
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
                onChange={(event) => field("timeZone", event.target.value)}
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
              <TextArea
                label="Public refund policy"
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
          <Button type="submit" disabled={busy || conflict}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
          {step < 3 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </Button>
          )}
          <span className="text-sm text-ink-muted" role="status">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>
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
