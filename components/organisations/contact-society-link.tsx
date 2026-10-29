import Link from "next/link";

// Where "Contact {society}" goes: the form that emails the society (DEBT-002).
export function contactSocietyHref(slug: string, eventId?: string) {
  return `/societies/${slug}/contact${eventId ? `?event=${encodeURIComponent(eventId)}` : ""}`;
}

// The one way buyers reach a society, on event, society and order pages, as
// Humanitix's "Contact host"; the society's own addresses are never shown by it.
export function ContactSocietyLink({ society, slug, eventId }: { society: string; slug: string; eventId?: string }) {
  return (
    <Link className="inline-flex min-h-11 w-fit items-center font-semibold text-brand underline underline-offset-4 [overflow-wrap:anywhere]" href={contactSocietyHref(slug, eventId)}>
      Contact {society}
    </Link>
  );
}
