export default function CancelPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 px-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-950">
          Payment cancelled
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          No payment was taken.
        </p>
      </section>
    </main>
  );
}
