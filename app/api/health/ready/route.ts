import { NextResponse } from "next/server";
import { checkApplicationReadiness } from "@/lib/ops/readiness";

const headers = {
  "Cache-Control": "no-store"
};

export async function GET() {
  try {
    await checkApplicationReadiness();

    return NextResponse.json(
      { status: "ready", service: "thunderstrux" },
      { status: 200, headers }
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", service: "thunderstrux" },
      { status: 503, headers }
    );
  }
}
