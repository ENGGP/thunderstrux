import { NextResponse } from "next/server";
import {
  discoveryInput,
  discoverOrganisations,
} from "@/lib/organisations/discovery";
import { organisationError } from "@/lib/organisations/http";
export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await discoverOrganisations(
        discoveryInput(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (error) {
    return organisationError(error);
  }
}
