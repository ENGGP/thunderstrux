"use server";

import { redirect } from "next/navigation";
import { recordPlatformSearch } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { searchPlatform } from "@/lib/platform/search";

// The omnibox posts here, so a pasted email never lands in a URL or the
// browser's history: an email matches at most one person. One match opens its
// record and none opens an empty result; only a name or id with several
// matches goes to the results page, which logs that search itself.
export async function adminSearch(formData: FormData) {
  const query = String(formData.get("q") ?? "").trim().slice(0, 200);
  const actor = await requirePlatformPage("platform:read", "/admin/search");
  if (!query) redirect("/admin/search");
  const hits = await searchPlatform(query);
  if (hits.length > 1) redirect(`/admin/search?q=${encodeURIComponent(query)}`);
  await recordPlatformSearch(actor, query, hits.length);
  redirect(hits.length === 1 ? hits[0].href : "/admin/search?none=1");
}
