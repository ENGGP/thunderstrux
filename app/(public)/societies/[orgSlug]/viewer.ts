import type { JoinState } from "@/components/organisations/society-join";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { joinedOrganisationIds } from "@/lib/organisations/join";

// Who is looking at a society page: their join state and, for a member
// account, the id their memberships are read with. Anonymous is fine.
export async function societyViewer(organisationId: string): Promise<{ joinState: JoinState; memberId: string | null; verified: boolean }> {
  try {
    const user = await requireAuthenticatedUser();
    if (user.accountRole === "organisation") return { joinState: "organisation", memberId: null, verified: false };
    const joined = (await joinedOrganisationIds(user.id, [organisationId])).has(organisationId);
    const verified = Boolean(user.emailVerifiedAt);
    return { joinState: joined ? "joined" : verified ? "available" : "verify", memberId: user.id, verified };
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
    return { joinState: "anonymous", memberId: null, verified: false };
  }
}
