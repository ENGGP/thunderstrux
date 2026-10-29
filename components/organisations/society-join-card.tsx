import { ContactSocietyLink } from "@/components/organisations/contact-society-link";
import Link from "next/link";
import { SocietyJoin, type JoinState } from "@/components/organisations/society-join";

// The society page's side card, the same on every tab: one heading, one line on
// what joining means, the action, then contact (artboard SocietyPage).
export function SocietyJoinCard({
  organisation,
  joinState
}: {
  organisation: { name: string; slug: string; supportEmail: string | null };
  joinState: JoinState;
}) {
  return (
    <aside className="grid content-start gap-3.5 self-start rounded-card border border-line bg-surface p-5 sm:p-6">
      {joinState === "joined" ? (
        <>
          {/* A live region, so joining is announced after the page refreshes. */}
          <div role="status">
            <h2 className="text-xl font-semibold text-ink [overflow-wrap:anywhere]">You&apos;ve joined {organisation.name}</h2>
          </div>
          <p className="text-sm text-ink-soft">You follow its events from your dashboard. A paid membership is separate, and leaving doesn&apos;t cancel one.</p>
          <Link className="w-fit text-sm font-semibold text-brand underline underline-offset-4" href="/dashboard/organisations">
            Manage in My societies
          </Link>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-ink [overflow-wrap:anywhere]">Join {organisation.name}</h2>
          <p className="text-sm text-ink-soft">Free to join. Follow the society from your dashboard. Memberships with member prices are sold separately.</p>
          <SocietyJoin slug={organisation.slug} state={joinState} />
        </>
      )}
      <div className="grid gap-1 border-t border-line pt-3.5 text-sm">
        <span className="font-semibold text-ink">Contact</span>
        <ContactSocietyLink slug={organisation.slug} society={organisation.name} />
        {organisation.supportEmail ? (
          <a className="w-fit text-brand underline underline-offset-4 [overflow-wrap:anywhere]" href={`mailto:${organisation.supportEmail}`}>
            {organisation.supportEmail}
          </a>
        ) : null}
      </div>
    </aside>
  );
}
