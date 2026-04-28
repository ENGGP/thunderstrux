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
    accountRole: "member" | "organisation";
    firstName: string | null;
    lastName: string | null;
    onboardingCompletedAt: string | null;
    createdAt: string;
  };
};

export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountRole, setAccountRole] = useState<"member" | "organisation">(
    "member"
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
        body: JSON.stringify({
          email,
          password,
          accountRole,
          firstName: accountRole === "member" ? firstName : undefined,
          lastName: accountRole === "member" ? lastName : undefined
        })
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

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-neutral-900">
          Account type
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800">
            <input
              checked={accountRole === "member"}
              name="accountRole"
              onChange={() => setAccountRole("member")}
              type="radio"
              value="member"
            />
            Member
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800">
            <input
              checked={accountRole === "organisation"}
              name="accountRole"
              onChange={() => setAccountRole("organisation")}
              type="radio"
              value="organisation"
            />
            Organisation
          </label>
        </div>
      </fieldset>

      {accountRole === "member" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="First name"
            maxLength={80}
            onChange={(event) => setFirstName(event.target.value)}
            value={firstName}
          />
          <TextInput
            label="Last name"
            maxLength={80}
            onChange={(event) => setLastName(event.target.value)}
            value={lastName}
          />
        </div>
      ) : null}

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
