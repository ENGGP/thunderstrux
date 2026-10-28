"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

export function CredentialsLoginForm({
  callbackUrl
}: {
  callbackUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
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

      setSuccessMessage("Signed in. Redirecting...");
      window.location.href = callbackUrl;
    } catch {
      setError("Unable to sign in. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <TextInput
        autoComplete="username"
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        value={email}
      />
      <TextInput
        autoComplete="current-password"
        label="Password"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />

      <Button busy={isSubmitting} busyLabel="Signing in…" className="w-full" size="lg" type="submit">
        Sign in
      </Button>
      {error ? (
        <Notice reveal role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      {successMessage ? (
        <Notice reveal role="status" tone="success">
          {successMessage}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm font-medium text-brand underline" href={`/forgot-password?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Forgot password?</Link>
        <Link
          className="text-sm font-medium text-brand underline"
          href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          Don&apos;t have an account? Sign up
        </Link>
      </div>
    </form>
  );
}
