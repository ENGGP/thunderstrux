"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { ClientApiError, fetchJson } from "@/lib/client/api";

type SignupResponse = {
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
};

export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await fetchJson<SignupResponse>("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false
      });

      if (result?.error) {
        setError("Account created, but sign in failed. Please sign in.");
        setIsSubmitting(false);
        return;
      }

      window.location.href = callbackUrl;
    } catch (signupError) {
      if (signupError instanceof ClientApiError) {
        setError(signupError.message);
      } else {
        setError("Could not create account. Please try again.");
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
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        value={email}
      />
      <TextInput
        label="Password"
        minLength={8}
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Creating account..." : "Create account"}
        </Button>
        <Link
          className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          Sign in
        </Link>
      </div>
    </form>
  );
}
