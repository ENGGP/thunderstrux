import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  createEvent,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { GET as getPublicEvents } from "@/app/api/public/events/route";
import { GET as getPublicEvent } from "@/app/api/public/events/[eventId]/route";
import OrganisationDetailsPage from "@/app/(public)/organisations/[orgSlug]/page";

describe("public-safe pages and APIs", () => {
  test("public events APIs return published events only", async () => {
    const { organisation } = await createOrganisationAccount();
    const published = await createEvent({
      organisationId: organisation.id,
      title: "Published Public Event",
      status: "published"
    });
    const draft = await createEvent({
      organisationId: organisation.id,
      title: "Draft Private Event",
      status: "draft"
    });

    const list = await getPublicEvents();
    expect(list.status).toBe(200);
    const listBody = await parseJsonResponse(list);
    expect(listBody.events).toEqual([
      expect.objectContaining({
        id: published.id,
        title: published.title,
        organisation: expect.objectContaining({ name: organisation.name })
      })
    ]);
    expect(JSON.stringify(listBody)).not.toContain(draft.title);

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${published.id}`),
      routeContext({ eventId: published.id })
    );
    expect(detail.status).toBe(200);
    const detailBody = await parseJsonResponse(detail);
    expect(detailBody.event).toMatchObject({
      id: published.id,
      title: published.title,
      organisation: {
        name: organisation.name,
        slug: organisation.slug
      },
      ticketTypes: expect.any(Array)
    });
    expect(detailBody.event).not.toHaveProperty("organisationId");

    const draftDetail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${draft.id}`),
      routeContext({ eventId: draft.id })
    );
    expect(draftDetail.status).toBe(404);
  });

  test("organisation details page renders only public-safe data", async () => {
    const { organisation } = await createOrganisationAccount({
      stripeReady: true,
      name: "Public Safe Org",
      slug: "public-safe-org"
    });
    await createEvent({
      organisationId: organisation.id,
      title: "Upcoming Public Event",
      status: "published"
    });

    const element = await OrganisationDetailsPage({
      params: Promise.resolve({ orgSlug: organisation.slug })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Public Safe Org");
    expect(html).toContain("Upcoming Public Event");
    expect(html).not.toContain("stripeAccountId");
    expect(html).not.toContain("acct_");
    expect(html).not.toContain("members");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Orders");
  });
});
