import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth/live-session";
import { unauthorized } from "@/lib/api/errors";
import { createCsrfTokenForRequest } from "@/lib/security/csrf";

export async function GET(request: Request) {
  const session = await getLiveSession();
  if (!session?.user?.id) return unauthorized();
  const token = createCsrfTokenForRequest(request);
  if (!token) return unauthorized();
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
