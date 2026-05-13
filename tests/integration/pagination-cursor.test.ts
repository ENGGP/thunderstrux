import { describe, expect, test } from "vitest";
import {
  PaginationError,
  decodeTimestampCursor,
  encodeTimestampCursor,
  pageInfoForPage,
  parsePaginationOptions
} from "@/lib/pagination/cursor";

describe("pagination cursor helpers", () => {
  test("encodes and decodes timestamp cursors", () => {
    const createdAt = new Date("2026-05-13T00:00:00.000Z");
    const cursor = encodeTimestampCursor("createdAt", {
      createdAt,
      id: "order_1"
    });

    expect(decodeTimestampCursor("createdAt", cursor)).toEqual({
      createdAt,
      id: "order_1"
    });
  });

  test("rejects malformed cursors and invalid values", () => {
    expect(() => decodeTimestampCursor("createdAt", "not-json")).toThrow(
      PaginationError
    );
    expect(() => decodeTimestampCursor("createdAt", "%%%")).toThrow(
      PaginationError
    );

    const invalidObjectShape = Buffer.from(JSON.stringify(["createdAt", "id"])).toString(
      "base64url"
    );
    expect(() => decodeTimestampCursor("createdAt", invalidObjectShape)).toThrow(
      PaginationError
    );

    const missingTimestamp = Buffer.from(
      JSON.stringify({ id: "order_1" })
    ).toString("base64url");
    expect(() => decodeTimestampCursor("createdAt", missingTimestamp)).toThrow(
      PaginationError
    );

    const missingId = Buffer.from(
      JSON.stringify({ createdAt: "2026-05-13T00:00:00.000Z" })
    ).toString("base64url");
    expect(() => decodeTimestampCursor("createdAt", missingId)).toThrow(
      PaginationError
    );

    const invalidDate = Buffer.from(
      JSON.stringify({ createdAt: "not-a-date", id: "order_1" })
    ).toString("base64url");
    expect(() => decodeTimestampCursor("createdAt", invalidDate)).toThrow(
      PaginationError
    );

    const emptyId = Buffer.from(
      JSON.stringify({ createdAt: "2026-05-13T00:00:00.000Z", id: "" })
    ).toString("base64url");
    expect(() => decodeTimestampCursor("createdAt", emptyId)).toThrow(
      PaginationError
    );
  });

  test("parses bounded limits and directions", () => {
    expect(parsePaginationOptions(new URLSearchParams())).toEqual({
      limit: 25,
      cursor: undefined,
      direction: "next"
    });
    expect(
      parsePaginationOptions(
        new URLSearchParams({ limit: "3", direction: "prev", cursor: "abc" })
      )
    ).toEqual({
      limit: 3,
      cursor: "abc",
      direction: "prev"
    });
    expect(() =>
      parsePaginationOptions(new URLSearchParams({ limit: "0" }))
    ).toThrow(PaginationError);
    expect(() =>
      parsePaginationOptions(new URLSearchParams({ limit: "101" }))
    ).toThrow(PaginationError);
    expect(() =>
      parsePaginationOptions(new URLSearchParams({ direction: "back" }))
    ).toThrow(PaginationError);
  });

  test("generates pageInfo from visible page boundaries after reversal", () => {
    const first = {
      createdAt: new Date("2026-05-13T00:00:00.000Z"),
      id: "a"
    };
    const second = {
      createdAt: new Date("2026-05-14T00:00:00.000Z"),
      id: "b"
    };
    const extra = {
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
      id: "c"
    };

    const { items, pageInfo } = pageInfoForPage({
      items: [extra, second, first],
      limit: 2,
      direction: "prev",
      cursor: "existing",
      timestampField: "createdAt"
    });

    expect(items).toEqual([second, extra]);
    expect(pageInfo.limit).toBe(2);
    expect(pageInfo.hasNextPage).toBe(true);
    expect(pageInfo.hasPreviousPage).toBe(true);
    expect(decodeTimestampCursor("createdAt", pageInfo.previousCursor ?? "")).toEqual(
      second
    );
    expect(decodeTimestampCursor("createdAt", pageInfo.nextCursor ?? "")).toEqual(
      extra
    );
  });
});
