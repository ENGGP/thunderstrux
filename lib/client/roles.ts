import type { OrganisationRole } from "@/lib/permissions";

export function getCurrentUserRole(): OrganisationRole {
  return "event_manager";
}
