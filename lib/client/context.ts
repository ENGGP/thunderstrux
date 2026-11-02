import { fetchJson } from "@/lib/client/api";

// Records which workspace this sign-in uses: a society the person staffs, or
// their personal area. A preference only; every page and API re-checks live
// authority, and a new sign-in starts personal again.
export function switchContext(target: string) {
  return fetchJson("/api/me/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target === "personal" ? { mode: "personal" } : { mode: "staff", organisationId: target })
  });
}
