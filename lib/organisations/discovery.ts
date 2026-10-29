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
  const direction = params.get("direction") ?? "next";
  if (
    q.length > 120 ||
    q.includes("\0") ||
    !/^[1-9]\d?$/.test(limit) ||
    Number(limit) > 50 ||
    (direction !== "next" && direction !== "prev")
  )
    throw new AssetError(
      400,
      "Search must be at most 120 characters, limit between 1 and 50 and direction next or prev",
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
  // Back from a page needs the cursor of its first row; without one it is the first page.
  return { q, limit: Number(limit), cursor, direction: cursor ? (direction as "next" | "prev") : ("next" as const) };
}
export async function discoverOrganisations(
  input: ReturnType<typeof discoveryInput>,
) {
  const { q, limit, cursor, direction } = input;
  // Pages run both ways by name (UI-025): back reads names before the cursor, nearest first.
  const back = direction === "prev";
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
                OR: back
                  ? [
                      { name: { lt: cursor.name } },
                      { name: cursor.name, id: { lt: cursor.id } },
                    ]
                  : [
                      { name: { gt: cursor.name } },
                      { name: cursor.name, id: { gt: cursor.id } },
                    ],
              },
            ]
          : []),
      ],
    },
    orderBy: back ? [{ name: "desc" }, { id: "desc" }] : [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoAssetId: true,
      events: {
        where: { status: "published", visibility: "public", cancelledAt: null, startTime: { gte: new Date() } },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        take: 1,
        select: { id: true, title: true, startTime: true },
      },
    },
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  if (back) visible.reverse();
  const first = visible[0];
  const last = visible.at(-1);
  const hasNextPage = back ? true : hasMore;
  const hasPreviousPage = back ? hasMore : !!cursor;
  const encode = (row: { name: string; id: string }) =>
    Buffer.from(JSON.stringify({ name: row.name, id: row.id, q })).toString("base64url");
  return {
    organisations: visible.map(({ description, events, ...row }) => ({
      ...row,
      description: description.slice(0, 240),
      nextEvent: events[0] ?? null,
    })),
    pageInfo: {
      limit,
      hasNextPage,
      hasPreviousPage,
      previousCursor: hasPreviousPage && first ? encode(first) : null,
      nextCursor: hasNextPage && last ? encode(last) : null,
    },
  };
}
