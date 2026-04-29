"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
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

      setSuccessMessage("Organisation created. Redirecting...");
      router.push("/dashboard");
      router.refresh();
    } catch (createError) {
      setError(
        getClientErrorMessage(
          createError,
          "Unable to create organisation. Please try again."
        )
      );

      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {successMessage ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </div>
      ) : null}

      <TextInput
        label="Organisation name"
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        required
        value={name}
      />

      <Button disabled={isSubmitting || name.trim().length === 0} type="submit">
        {isSubmitting ? "Creating..." : "Create organisation"}
      </Button>
    </form>
  );
}
