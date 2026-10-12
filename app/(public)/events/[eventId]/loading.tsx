export default function PublicEventLoading() {
  return (
    <main className="min-h-screen bg-surface-subtle px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-3xl gap-6">
        <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
          <div className="h-4 w-32 rounded bg-brand-200" />
          <div className="mt-3 h-10 w-3/4 rounded bg-brand-200" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="h-16 rounded bg-surface-subtle" />
            <div className="h-16 rounded bg-surface-subtle" />
            <div className="h-16 rounded bg-surface-subtle sm:col-span-2" />
          </div>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <div className="h-5 w-24 rounded bg-brand-200" />
          <div className="mt-5 h-20 rounded bg-surface-subtle" />
        </section>
      </div>
    </main>
  );
}
