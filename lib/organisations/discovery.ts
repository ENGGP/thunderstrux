import { z } from "zod";
import { prisma } from "@/lib/db";
import { AssetError } from "@/lib/assets/image";
const cursorSchema = z
  .object({
    name: z
      .string()
      .max(1000)
      .refine((value) => !value.includes("\0")),
    id: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => !value.includes("\0")),
    q: z.string().max(120),
  })
  .strict();
export function discoveryInput(params: URLSearchParams) {
  const q = params.get("q")?.trim() ?? "";
  const limit = params.get("limit") ?? "25";
  if (
    q.length > 120 ||
    q.includes("\0") ||
    !/^[1-9]\d?$/.test(limit) ||
    Number(limit) > 50
  )
    throw new AssetError(
      400,
      "Search must be at most 120 characters and limit between 1 and 50",
    );
  const raw = params.get("cursor");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (raw) {
    try {
      if (raw.length > 2500 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.toString("base64url") !== raw) throw new Error();
      cursor = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (cursor.q !== q) throw new Error();
    } catch {
      throw new AssetError(
        400,
        "Search cursor is invalid. Start a new search.",
      );
    }
  }
  return { q, limit: Number(limit), cursor };
}
export async function discoverOrganisations(
  input: ReturnType<typeof discoveryInput>,
) {
  const { q, limit, cursor } = input;
  const literal = q.replace(/[\\%_]/g, "\\$&");
  const rows = await prisma.organisation.findMany({
    where: {
      AND: [
        ...(q
          ? [
              {
                OR: [
                  { name: { contains: literal, mode: "insensitive" as const } },
                  { slug: { contains: literal, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
        ...(cursor
          ? [
              {
                OR: [
                  { name: { gt: cursor.name } },
                  { name: cursor.name, id: { gt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoAssetId: true,
      events: {
        where: { status: "published", visibility: "public", startTime: { gte: new Date() } },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        take: 1,
        select: { id: true, title: true, startTime: true },
      },
    },
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    organisations: visible.map(({ description, events, ...row }) => ({
      ...row,
      description: description.slice(0, 240),
      nextEvent: events[0] ?? null,
    })),
    pageInfo: {
      limit,
      hasNextPage: hasMore,
      hasPreviousPage: !!cursor,
      previousCursor: null,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ name: last.name, id: last.id, q }),
            ).toString("base64url")
          : null,
    },
  };
}
