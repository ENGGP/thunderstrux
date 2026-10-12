"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput, TextArea } from "@/components/ui/input";
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
export function SocietyProfile({
  initialProfile,
  canManageStaff,
  canManageStripe,
}: {
  initialProfile: Profile;
  canManageStaff: boolean;
  canManageStripe: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [saved, setSaved] = useState(initialProfile);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
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
  async function reload() {
    if (
      dirty &&
      !window.confirm("Discard unsaved edits and reload the latest profile?")
    )
      return;
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
  return (
    <section className="society-surface society-panel space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold">Society profile</h2>
        <p className="mt-2 text-sm">
          Save each step and return whenever you need. Your public URL stays
          /societies/{profile.slug}.
        </p>
      </div>
      <nav aria-label="Profile setup steps" className="flex flex-wrap gap-2">
        {steps.map((label, index) => (
          <Button
            key={label}
            type="button"
            variant={index === step ? "society" : "secondary"}
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
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {conflict && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={reload}
          >
            Reload latest profile
          </Button>
        )}
        <fieldset disabled={busy} className="grid gap-5">
          <legend className="mb-4 font-semibold">{steps[step]}</legend>
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
                label="Public contact email"
                type="email"
                value={profile.supportEmail}
                maxLength={254}
                onChange={(event) => field("supportEmail", event.target.value)}
              />
              <p className="text-sm">
                These details are public. Use a society contact address.
                Completion requires all three.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-sm">
                Optional JPEG, PNG or WebP, up to 5 MiB and 4096 × 4096 pixels.
                Removing an image takes effect when you save.
              </p>
              {(["logo", "cover"] as const).map((kind) => (
                <div className="grid gap-3" key={kind}>
                  <label className="grid gap-2">
                    <span className="capitalize">{kind} image</span>
                    <input
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
                            ? "h-24 w-24 object-contain"
                            : "max-h-48 w-full object-cover"
                        }
                        src={`/api/orgs/${profile.slug}/assets/${profile[`${kind}AssetId`]}`}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          setProfile((current) => ({
                            ...current,
                            [`${kind}AssetId`]: null,
                          }))
                        }
                      >
                        Remove {kind}
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
          {step === 2 && (
            <>
              <TextInput
                label="Society timezone"
                value={profile.timeZone}
                required
                maxLength={64}
                onChange={(event) => field("timeZone", event.target.value)}
              />
              <TextArea
                label="Public refund policy"
                value={profile.refundPolicy}
                maxLength={5000}
                onChange={(event) => field("refundPolicy", event.target.value)}
              />
              <TextArea
                label="Public pickup policy"
                value={profile.pickupPolicy}
                maxLength={5000}
                onChange={(event) => field("pickupPolicy", event.target.value)}
              />
              <p className="text-sm">
                Policies are optional and displayed publicly. These settings do
                not change existing sales or refunds.
              </p>
            </>
          )}
          {step === 3 && (
            <>
              <p>
                {saved.onboardingCompletedAt
                  ? "Profile complete."
                  : "Profile incomplete: save a name, description and public contact email."}
              </p>
              <p className="text-sm">
                Payment readiness is separate. Configure staff security and
                payments through their settings.
              </p>
              <Link href={`/societies/${profile.slug}`}>
                View public profile
              </Link>
              <Link href="/mfa?callbackUrl=/dashboard/settings/profile">
                Staff authenticator settings
              </Link>
              {canManageStaff && (
                <Link href="/dashboard/settings/staff">Manage staff</Link>
              )}
              {canManageStripe && (
                <Link href="/dashboard/settings">Stripe settings</Link>
              )}
            </>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="society" disabled={busy || conflict}>
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
          <span className="text-sm" role="status">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>
      </form>
    </section>
  );
}
