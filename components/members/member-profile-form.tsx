"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { ClientApiError, fetchJson } from "@/lib/client/api";

type Profile = {
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
  studentNumber: string;
};

export function MemberProfileForm({
  initialProfile
}: {
  initialProfile: Profile;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      await fetchJson("/api/me/profile", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(profile)
      });

      setMessage("Profile saved.");
      window.location.reload();
    } catch (profileError) {
      setError(
        profileError instanceof ClientApiError
          ? profileError.message
          : "Unable to save profile."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid max-w-2xl gap-4" onSubmit={onSubmit}>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="First name"
          maxLength={80}
          onChange={(event) =>
            setProfile({ ...profile, firstName: event.target.value })
          }
          required
          value={profile.firstName}
        />
        <TextInput
          label="Last name"
          maxLength={80}
          onChange={(event) =>
            setProfile({ ...profile, lastName: event.target.value })
          }
          required
          value={profile.lastName}
        />
      </div>
      <TextInput
        label="Display name"
        maxLength={120}
        onChange={(event) =>
          setProfile({ ...profile, displayName: event.target.value })
        }
        value={profile.displayName}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Phone"
          maxLength={40}
          onChange={(event) =>
            setProfile({ ...profile, phone: event.target.value })
          }
          value={profile.phone}
        />
        <TextInput
          label="Student number"
          maxLength={80}
          onChange={(event) =>
            setProfile({ ...profile, studentNumber: event.target.value })
          }
          value={profile.studentNumber}
        />
      </div>
      <div>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving..." : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
