"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type SignupResponse = { accepted: boolean };

export function SignupForm({
  callbackUrl,
  initialRole = "member"
}: {
  callbackUrl: string;
  // "Create a society" links preselect the society option.
  initialRole?: "member" | "organisation";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountRole, setAccountRole] = useState(initialRole);
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

  // Sent: the form makes way for what to do next. The wording is the same for every
  // address, so it never says whether one already has an account.
  if (successMessage) {
    return (
      <div className="grid gap-3">
        <h2 className="font-display text-2xl font-semibold text-ink">Check your email</h2>
        <p className="text-ink" role="status">{successMessage}</p>
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          Address: <strong className="text-ink">{email.trim()}</strong>. Open the link to verify your email and sign in. Nothing arrived? Check spam or junk.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <button className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" onClick={() => setSuccessMessage(null)} type="button">
            Use a different email
          </button>
          <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink">This account is for</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["member", "Me", "Get tickets, memberships and merch, and join societies."],
              // An organisation account can't hold tickets and can't become a member account later.
              ["organisation", "A society", "A shared committee login for running events and sales. It can't get tickets, and can't become a personal account later. Committee members use their own accounts for themselves."]
            ] as const
          ).map(([value, label, help]) => (
            <label
              className="flex cursor-pointer items-start gap-2 rounded-control border border-line-strong px-3 py-2.5 text-sm text-ink has-[:checked]:border-brand has-[:checked]:bg-brand-tint"
              key={value}
            >
              <input
                aria-describedby={`account-type-${value}`}
                checked={accountRole === value}
                className="mt-1 accent-brand"
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
          {/* Door staff find tickets by the buyer's name, so a member gives one. */}
          <TextInput
            autoComplete="given-name"
            label="First name"
            maxLength={80}
            onChange={(event) => setFirstName(event.target.value)}
            required
            value={firstName}
          />
          <TextInput
            autoComplete="family-name"
            label="Last name"
            maxLength={80}
            onChange={(event) => setLastName(event.target.value)}
            required
            value={lastName}
          />
        </div>
      ) : null}

      <TextInput
        autoComplete="email"
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <TextInput
        autoComplete="new-password"
        hint="At least 8 characters"
        label="Password"
        minLength={8}
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />



      <Button busy={isSubmitting} busyLabel="Creating account…" className="w-full" size="lg" type="submit">
        Create account
      </Button>
      {error ? (
        <Notice reveal role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}

      <p className="text-sm text-ink-soft">
        Already have an account?{" "}
        <Link className="font-medium text-brand underline" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
