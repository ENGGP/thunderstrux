import type { Session } from "next-auth";

declare global {
  // eslint-disable-next-line no-var
  var __THUNDERSTRUX_TEST_SESSION__: Session | null | undefined;
}

export {};
