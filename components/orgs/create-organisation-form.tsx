"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { ClientApiError, fetchJson } from "@/lib/client/api";

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const data = await fetchJson<CreateOrganisationResponse>("/api/orgs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
      });

      router.push(`/dashboard/${data.organisation.slug}`);
      router.refresh();
    } catch (createError) {
      if (createError instanceof ClientApiError) {
        setError(createError.message);
      } else {
        setError("Unable to create organisation. Please try again.");
      }

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
