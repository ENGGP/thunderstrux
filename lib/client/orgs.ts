import { fetchJson } from "@/lib/client/api";

export type Organisation = {
  id: string;
  name: string;
  slug: string;
};

export async function fetchOrganisationBySlug(
  orgSlug: string
): Promise<Organisation> {
  const data = await fetchJson<{ organisation: Organisation }>(
    `/api/orgs/${orgSlug}`
  );

  return data.organisation;
}
