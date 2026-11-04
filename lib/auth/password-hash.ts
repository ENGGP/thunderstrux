import { compare, hash } from "bcryptjs";

// SEC-019 (N2): bcryptjs runs cost-12 hashing on the one event loop, about 0.25 s
// each. Past this many at once a flood of sign-ins would stall every other
// request, so the next one is refused with 503 and a short Retry-After instead.
// shortcut: per process, not per host; enough for one app container, revisit with more replicas.
export const maxPasswordWork = 8;
export const passwordBusyRetrySeconds = 5;
let active = 0;

export class PasswordBusyError extends Error {
  constructor() {
    super("Too many sign-ins at once. Try again in a few seconds.");
    this.name = "PasswordBusyError";
  }
}

export function passwordWorkBusy() {
  return active >= maxPasswordWork;
}

async function gated<T>(work: () => Promise<T>) {
  if (passwordWorkBusy()) throw new PasswordBusyError();
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
  }
}

export const comparePassword = (password: string, digest: string) => gated(() => compare(password, digest));
export const hashPassword = (password: string) => gated(() => hash(password, 12));
