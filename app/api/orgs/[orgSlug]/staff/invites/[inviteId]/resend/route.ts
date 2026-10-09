import { manageStaffInviteRequest } from "@/lib/staff/invite-http";
export async function POST(request: Request, context: { params: Promise<{ orgSlug: string; inviteId: string }> }) {
  return manageStaffInviteRequest(request, context, "resend");
}
