import { Prisma } from "@prisma/client";

export type PaginationDirection = "next" | "prev";

export type TimestampCursor<Field extends string> = {
  id: string;
} & Record<Field, Date>;

export type ParsedPaginationOptions = {
  limit: number;
  cursor?: string;
  direction: PaginationDirection;
};

export type PageInfo = {
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextCursor: string | null;
  previousCursor: string | null;
};

export type PaginationSearchParams = {
  get(name: string): string | null;
};

export const defaultPageLimit = 25;
export const maxPageLimit = 100;

export class PaginationError extends Error {
  constructor(message = "Invalid pagination parameters") {
    super(message);
    this.name = "PaginationError";
  }
}

export function encodeTimestampCursor<Field extends string>(
  timestampField: Field,
  record: TimestampCursor<Field>
) {
  return Buffer.from(
    JSON.stringify({
      [timestampField]: record[timestampField].toISOString(),
      id: record.id
    })
  ).toString("base64url");
}

export function decodeTimestampCursor<Field extends string>(
  timestampField: Field,
  cursor: string
): TimestampCursor<Field> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as
      | Record<string, unknown>
      | null;

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid cursor shape");
    }

    const timestamp = parsed[timestampField];
    const id = parsed.id;

    if (typeof timestamp !== "string" || typeof id !== "string") {
      throw new Error("Invalid cursor shape");
    }

    const decodedDate = new Date(timestamp);

    if (Number.isNaN(decodedDate.getTime()) || id.trim().length === 0) {
      throw new Error("Invalid cursor values");
    }

    return {
      [timestampField]: decodedDate,
      id
    } as TimestampCursor<Field>;
  } catch {
    throw new PaginationError("Invalid pagination cursor");
  }
}

export function parsePaginationOptions(
  searchParams: PaginationSearchParams,
  {
    defaultLimit = defaultPageLimit,
    maxLimit = maxPageLimit
  }: { defaultLimit?: number; maxLimit?: number } = {}
): ParsedPaginationOptions {
  const limitParam = searchParams.get("limit");
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const directionParam = searchParams.get("direction") ?? "next";

  if (directionParam !== "next" && directionParam !== "prev") {
    throw new PaginationError("Invalid pagination direction");
  }

  if (!limitParam) {
    return {
      limit: defaultLimit,
      cursor,
      direction: directionParam
    };
  }

  if (!/^\d+$/.test(limitParam)) {
    throw new PaginationError("Invalid pagination limit");
  }

  const limit = Number(limitParam);

  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new PaginationError("Invalid pagination limit");
  }

  return {
    limit,
    cursor,
    direction: directionParam
  };
}

export function parsePaginationOptionsOrDefault(
  searchParams: PaginationSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): ParsedPaginationOptions & { invalid: boolean } {
  try {
    return {
      ...parsePaginationOptions(searchParams, options),
      invalid: false
    };
  } catch {
    return {
      limit: options.defaultLimit ?? defaultPageLimit,
      direction: "next",
      invalid: true
    };
  }
}

export function descendingCursorWhere<Field extends string>(
  timestampField: Field,
  cursor: TimestampCursor<Field>,
  direction: PaginationDirection
) {
  const timestamp = cursor[timestampField];

  return direction === "prev"
    ? {
        OR: [
          { [timestampField]: { gt: timestamp } },
          {
            [timestampField]: timestamp,
            id: { gt: cursor.id }
          }
        ]
      }
    : {
        OR: [
          { [timestampField]: { lt: timestamp } },
          {
            [timestampField]: timestamp,
            id: { lt: cursor.id }
          }
        ]
      };
}

export function ascendingCursorWhere<Field extends string>(
  timestampField: Field,
  cursor: TimestampCursor<Field>,
  direction: PaginationDirection
) {
  const timestamp = cursor[timestampField];

  return direction === "prev"
    ? {
        OR: [
          { [timestampField]: { lt: timestamp } },
          {
            [timestampField]: timestamp,
            id: { lt: cursor.id }
          }
        ]
      }
    : {
        OR: [
          { [timestampField]: { gt: timestamp } },
          {
            [timestampField]: timestamp,
            id: { gt: cursor.id }
          }
        ]
      };
}

export function pageInfoForPage<
  Field extends string,
  Item extends TimestampCursor<Field>
>({
  items,
  limit,
  direction,
  cursor,
  timestampField
}: {
  items: Item[];
  limit: number;
  direction: PaginationDirection;
  cursor?: string;
  timestampField: Field;
}) {
  const hasExtraItem = items.length > limit;
  const pageItems = items.slice(0, limit);
  const visibleItems = direction === "prev" ? [...pageItems].reverse() : pageItems;
  const firstItem = visibleItems[0] ?? null;
  const lastItem = visibleItems[visibleItems.length - 1] ?? null;
  const hasPreviousPage = direction === "prev" ? hasExtraItem : Boolean(cursor);
  const hasNextPage = direction === "prev" ? Boolean(cursor) : hasExtraItem;

  return {
    items: visibleItems,
    pageInfo: {
      limit,
      hasNextPage,
      hasPreviousPage,
      nextCursor:
        lastItem && hasNextPage
          ? encodeTimestampCursor(timestampField, lastItem)
          : null,
      previousCursor:
        firstItem && hasPreviousPage
          ? encodeTimestampCursor(timestampField, firstItem)
          : null
    } satisfies PageInfo
  };
}

export function orderByForDirection<Field extends string>(
  timestampField: Field,
  direction: PaginationDirection,
  baseOrder: "asc" | "desc"
) {
  const order = direction === "prev" ? invertOrder(baseOrder) : baseOrder;

  return [
    { [timestampField]: order },
    { id: order }
  ] as Prisma.Enumerable<Record<Field | "id", typeof order>>;
}

function invertOrder(order: "asc" | "desc") {
  return order === "asc" ? "desc" : "asc";
}
