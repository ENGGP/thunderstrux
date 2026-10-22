import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PublicEventView } from "@/components/events/public-event-view";
import { requireManagementPage } from "@/lib/auth/page-access";
import { getEventPreviewDetail } from "@/lib/events/public-events";

// The public event page as buyers will see it, for a draft only staff can open.
// Buying is off; a published event shows its real public page instead.
export default async function EventPreviewPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const organisation = await requireManagementPage("events:manage", `/dashboard/events/${eventId}/preview`);
  const event = await getEventPreviewDetail(organisation.id, eventId);

  if (!event) notFound();
  if (event.status === "published") redirect(`/events/${eventId}`);

  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-brand-ink px-4 py-3.5 text-white md:px-8" role="region" aria-label="Draft preview">
        <div className="grid min-w-0 flex-1 basis-80">
          <strong className="text-base">Draft preview</strong>
          <span className="text-sm text-white/85">
            This is how buyers will see the page once you publish. Only your society&apos;s staff can open it now, and nothing can be bought here.
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-white/60 px-4 text-sm font-semibold text-white"
            href={`/dashboard/events/${eventId}`}
          >
            Back to Summary
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-control bg-white px-4 text-sm font-semibold text-brand-ink"
            href={`/dashboard/events/${eventId}/edit`}
          >
            Edit event
          </Link>
        </div>
      </div>
      <PublicEventView event={event} preview viewer="member" />
    </main>
  );
}
