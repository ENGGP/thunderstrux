import type { Session } from "next-auth";

declare global {
  // eslint-disable-next-line no-var
  var __THUNDERSTRUX_TEST_CONTEXT__: string | undefined;
  var __THUNDERSTRUX_TEST_SESSION__: Session | null | undefined;
  var __THUNDERSTRUX_TEST_GUEST__: string | undefined;
}

export {};
