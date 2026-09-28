"use client";

export default function MfaError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">Staff verification is temporarily unavailable</h1>
      <p className="mt-3 text-sm text-slate-600">
        The verification service could not be loaded. Try again after the service has recovered.
      </p>
      <div className="mt-6 flex gap-3">
        <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white" onClick={reset}>
          Try again
        </button>
        <a className="rounded border border-slate-300 px-4 py-2 text-sm" href="/dashboard">
          Return to dashboard
        </a>
      </div>
    </main>
  );
}
