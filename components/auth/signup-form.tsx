"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type SignupResponse = { accepted: boolean };

export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountRole, setAccountRole] = useState<"member" | "organisation">(
    "member"
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      await fetchJson<SignupResponse>("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callbackUrl,
          password,
          accountRole,
          firstName: accountRole === "member" ? firstName : undefined,
          lastName: accountRole === "member" ? lastName : undefined
        })
      });

      setSuccessMessage("If this address is eligible, a verification email has been sent. Check your inbox, or sign in and request a new link.");
      setIsSubmitting(false);
    } catch (signupError) {
      setError(
        getClientErrorMessage(
          signupError,
          "Could not create account. Please try again."
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
        <legend className="text-sm font-semibold text-ink">Account type</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["member", "Member", "For you. Buy tickets and join societies."],
              ["organisation", "Organisation", "For a society. Create its page and run its events."]
            ] as const
          ).map(([value, label, help]) => (
            <label
              className="flex cursor-pointer items-start gap-2 rounded-control border border-line-strong px-3 py-2.5 text-sm text-ink has-[:checked]:border-brand has-[:checked]:bg-brand-tint"
              key={value}
            >
              <input
                aria-describedby={`account-type-${value}`}
                checked={accountRole === value}
                className="mt-1"
                name="accountRole"
                onChange={() => setAccountRole(value)}
                type="radio"
                value={value}
              />
              <span>
                <span className="font-semibold">{label}</span>
                <span className="block text-ink-soft" id={`account-type-${value}`}>
                  {help}
                </span>
              </span>
            </label>
          ))}
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
          className="text-sm font-medium text-brand underline"
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          Sign in
        </Link>
      </div>
    </form>
  );
}
