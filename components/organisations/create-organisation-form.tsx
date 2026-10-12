"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type CreateOrganisationResponse = {
  organisation: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
  };
};

export function CreateOrganisationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      await fetchJson<CreateOrganisationResponse>("/api/orgs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
      });

      setSuccessMessage("Society created. Redirecting...");
      router.push("/dashboard/settings/profile");
      router.refresh();
    } catch (createError) {
      setError(
        getClientErrorMessage(
          createError,
          "Unable to create society. Please try again."
        )
      );

      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      {successMessage ? (
        <Notice role="status" tone="success">
          {successMessage}
        </Notice>
      ) : null}

      <TextInput
        hint="Your public address is made from the name and does not change later."
        label="Society name"
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        required
        value={name}
      />

      <Button disabled={isSubmitting || name.trim().length === 0} type="submit">
        {isSubmitting ? "Creating..." : "Create society"}
      </Button>
    </form>
  );
}
