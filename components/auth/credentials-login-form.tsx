"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";

export function CredentialsLoginForm({
  callbackUrl
}: {
  callbackUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false
    });

    if (result?.error) {
      setError("Invalid email or password.");
      setIsSubmitting(false);
      return;
    }

    window.location.href = callbackUrl;
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <TextInput
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        value={email}
      />
      <TextInput
        label="Password"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
        <Link
          className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
          href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          Don&apos;t have an account? Sign up
        </Link>
      </div>
    </form>
  );
}
