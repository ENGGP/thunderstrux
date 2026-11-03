"use server";

import { recordPlatformSearch } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { findRecoveryCandidate, previewRecipients } from "@/lib/platform/recovery";

// The ownership wizard's first step (board H8): an existing account by exact
// email, posted, so the address never reaches a URL. Logged as a search (a digest only).
export async function lookupRecoveryCandidate(organisationId: string, email: string) {
  const actor = await requirePlatformPage("platform:recovery", `/admin/societies/${encodeURIComponent(organisationId)}`);
  const query = email.trim().slice(0, 320);
  const candidate = query.includes("@") ? await findRecoveryCandidate(query) : null;
  await recordPlatformSearch(actor, query, candidate ? 1 : 0);
  if (!candidate) return null;
  return { candidate, recipients: candidate.problem ? [] : await previewRecipients("ownership", candidate.id, organisationId) };
}
