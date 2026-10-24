import { signOut } from "next-auth/react";

// Auth.js makes a sign-out redirect absolute with AUTH_URL, which moves someone on a
// second trusted address (a local port beside the public domain) to the public one.
// Signing out without its redirect, then going to a same-site path, stays on this host.
export async function signOutTo(path: string) {
  await signOut({ redirect: false });
  window.location.assign(path);
}
